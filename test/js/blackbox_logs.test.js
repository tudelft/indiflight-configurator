import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/js/injected_methods";
import MSP from "../../src/js/msp";
import MSPCodes from "../../src/js/msp/MSPCodes";
import MspHelper, {
    BLACKBOX_LOG_STATUS,
    decodeDataflashReadReply,
    decodeFatTimestamp,
    decodeBlackboxLogEraseReply,
    decodeBlackboxLogListReply,
    decodeBlackboxLogReadReply,
    encodeBlackboxLogEraseRequest,
    encodeBlackboxLogListRequest,
    encodeBlackboxLogName,
    encodeBlackboxLogReadRequest,
} from "../../src/js/msp/MSPHelper";
import { MspCancelledError, MspCrcError, MspTimeoutError } from "../../src/js/msp/mspErrors";
import { defaultHuffmanTree } from "../../src/js/default_huffman_tree";
import {
    BlackboxLogError,
    eraseAllBlackboxLogs,
    listBlackboxLogs,
    readBlackboxLogFile,
} from "../../src/composables/useBlackboxLogs";

// --- byte builders, written from the protocol spec ---------------------------------------------------------------

const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
const view = (bytes) => new DataView(new Uint8Array(bytes).buffer);
const bytesOf = (dataView) => Array.from(new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength));
const fatDate = (y, m, d) => ((y - 1980) << 9) | (m << 5) | d;
const fatTime = (h, min, s) => (h << 11) | (min << 5) | (s / 2);

function listEntry(nameBytes, size, date, time) {
    const name = [...nameBytes];
    while (name.length < 12) {
        name.push(0);
    }
    return [...name, ...u32(size), ...u16(date), ...u16(time)];
}

// LIST reply: u8 status, u16 startIndex, u8 count, u8 flags (bit0 more, bit1 flash), u8 progress, entries
function listReply({ status = 0, startIndex = 0, more = false, onFlash = false, progress = 0, entries = [] }) {
    const flags = (more ? 1 : 0) | (onFlash ? 2 : 0);
    return [status, ...u16(startIndex), entries.length, flags, progress, ...entries.flat()];
}

// MSP_DATAFLASH_READ (new format) body: u32 offset, u16 dataSize, u8 compressionType, payload
const rawChunk = (offset, data) => [...u32(offset), ...u16(data.length), 0, ...data];

// Independent Huffman encoder over the default tree (MSB first), as the firmware does it.
function huffmanEncode(data) {
    const out = [];
    let byte = 0;
    let bit = 0x80;
    for (const value of data) {
        const leaf = defaultHuffmanTree.find((n) => n.value === value);
        for (let i = leaf.codeLen - 1; i >= 0; i--) {
            if ((leaf.code >> i) & 1) {
                byte |= bit;
            }
            bit >>= 1;
            if (bit === 0) {
                out.push(byte);
                byte = 0;
                bit = 0x80;
            }
        }
    }
    if (bit !== 0x80) {
        out.push(byte);
    }
    return out;
}

function huffmanChunk(offset, data) {
    const compressed = huffmanEncode(data);
    return [...u32(offset), ...u16(compressed.length + 2), 1, ...u16(data.length), ...compressed];
}

// --- request encoding --------------------------------------------------------------------------------------------

describe("blackbox log request encoding", () => {
    it("uses MSPv2 codes 0x4006-0x4009", () => {
        expect(MSPCodes.MSP2_INDI_BLACKBOX_LOG_LIST).toBe(0x4006);
        expect(MSPCodes.MSP2_INDI_BLACKBOX_LOG_READ).toBe(0x4007);
        expect(MSPCodes.MSP2_INDI_BLACKBOX_LOG_CLOSE).toBe(0x4008);
        expect(MSPCodes.MSP2_INDI_BLACKBOX_LOG_ERASE_ALL).toBe(0x4009);
        // codes above 254 are framed as MSPv2 by msp.js
        const frame = new Uint8Array(MSP.encode_message_v2(MSPCodes.MSP2_INDI_BLACKBOX_LOG_LIST, [0, 0]));
        expect(Array.from(frame.slice(0, 8))).toEqual([0x24, 0x58, 0x3c, 0, 0x06, 0x40, 2, 0]);
    });

    it("encodes the erase request as u8 start", () => {
        expect(encodeBlackboxLogEraseRequest(true)).toEqual([1]);
        expect(encodeBlackboxLogEraseRequest(false)).toEqual([0]);
    });

    it("encodes the list start index as little-endian u16", () => {
        expect(encodeBlackboxLogListRequest(0)).toEqual([0, 0]);
        expect(encodeBlackboxLogListRequest(0x1234)).toEqual([0x34, 0x12]);
    });

    it("pads short names with NUL to 12 bytes and keeps 12-char names unterminated", () => {
        expect(encodeBlackboxLogName("LOG1.BFL")).toEqual([...ascii("LOG1.BFL"), 0, 0, 0, 0]);
        expect(encodeBlackboxLogName("LOG00012.BFL")).toEqual(ascii("LOG00012.BFL"));
    });

    it("rejects names that do not fit the 12-byte field", () => {
        expect(() => encodeBlackboxLogName("LOG000123.BFL")).toThrow();
        expect(() => encodeBlackboxLogName("")).toThrow();
        expect(() => encodeBlackboxLogName("LÖG.BFL")).toThrow();
    });

    it("encodes a read request as name[12], u32 offset, u16 size, u8 allowCompression", () => {
        const request = encodeBlackboxLogReadRequest("LOG00012.BFL", 0x01020304, 4096, true);
        expect(request).toEqual([...ascii("LOG00012.BFL"), 0x04, 0x03, 0x02, 0x01, 0x00, 0x10, 1]);
        expect(request).toHaveLength(19);

        const raw = encodeBlackboxLogReadRequest("A.BFL", 0xfffffff0, 512, false);
        expect(raw).toEqual([...ascii("A.BFL"), 0, 0, 0, 0, 0, 0, 0, 0xf0, 0xff, 0xff, 0xff, 0x00, 0x02, 0]);
    });
});

// --- FAT timestamps ----------------------------------------------------------------------------------------------

describe("decodeFatTimestamp", () => {
    it("splits FAT date and time bit fields", () => {
        expect(decodeFatTimestamp(fatDate(2026, 5, 14), fatTime(10, 32, 8))).toEqual({
            year: 2026,
            month: 5,
            day: 14,
            hours: 10,
            minutes: 32,
            seconds: 8,
        });
        // raw bit check: 2024-12-31 23:59:58
        expect(decodeFatTimestamp((44 << 9) | (12 << 5) | 31, (23 << 11) | (59 << 5) | 29)).toEqual({
            year: 2024,
            month: 12,
            day: 31,
            hours: 23,
            minutes: 59,
            seconds: 58,
        });
    });

    it("returns null for date 0 (unknown)", () => {
        expect(decodeFatTimestamp(0, 0)).toBeNull();
        expect(decodeFatTimestamp(0, fatTime(12, 0, 0))).toBeNull();
    });

    it("returns null for out-of-range fields", () => {
        expect(decodeFatTimestamp(fatDate(2026, 0, 1), 0)).toBeNull();
        expect(decodeFatTimestamp(fatDate(2026, 13, 1), 0)).toBeNull();
        expect(decodeFatTimestamp(fatDate(2026, 1, 0), 0)).toBeNull();
        expect(decodeFatTimestamp(fatDate(2026, 1, 1), (24 << 11) | 0)).toBeNull();
    });

    it("treats the asyncfatfs no-RTC placeholder 2015-12-01 00:00:00 as unknown", () => {
        expect(decodeFatTimestamp(fatDate(2015, 12, 1), 0)).toBeNull();
        expect(decodeFatTimestamp(fatDate(2015, 12, 1), fatTime(0, 0, 2))).not.toBeNull();
    });
});

// --- LIST reply --------------------------------------------------------------------------------------------------

describe("decodeBlackboxLogListReply", () => {
    it("decodes entries, NUL-padded and full-length names, sizes and dates", () => {
        const reply = decodeBlackboxLogListReply(
            view(
                listReply({
                    startIndex: 20,
                    more: true,
                    entries: [
                        listEntry(ascii("LOG00012.BFL"), 0x12345678, fatDate(2026, 5, 14), fatTime(10, 32, 8)),
                        // bytes after the terminating NUL must be ignored
                        listEntry([...ascii("LOG1.BFL"), 0, 0x41, 0x42, 0x43], 42, 0, 0),
                    ],
                }),
            ),
        );

        expect(reply.status).toBe(BLACKBOX_LOG_STATUS.OK);
        expect(reply.startIndex).toBe(20);
        expect(reply.more).toBe(true);
        expect(reply.onFlash).toBe(false);
        expect(reply.entries).toHaveLength(2);
        expect(reply.entries[0]).toMatchObject({
            name: "LOG00012.BFL",
            size: 0x12345678,
            timestamp: { year: 2026, month: 5, day: 14, hours: 10, minutes: 32, seconds: 8 },
        });
        expect(reply.entries[1]).toMatchObject({ name: "LOG1.BFL", size: 42, timestamp: null });
    });

    it("reads sizes above 2^31 as unsigned", () => {
        const reply = decodeBlackboxLogListReply(
            view(listReply({ entries: [listEntry(ascii("BIG.BFL"), 0xfffffffe, 0, 0)] })),
        );
        expect(reply.entries[0].size).toBe(0xfffffffe);
    });

    it("decodes an empty last page", () => {
        const reply = decodeBlackboxLogListReply(view(listReply({ startIndex: 40 })));
        expect(reply).toMatchObject({ status: 0, startIndex: 40, more: false, entries: [] });
    });

    it("reads flags bit0 as 'more' and bit1 as 'on flash', ignoring other bits", () => {
        const bytes = listReply({});
        bytes[4] = 0xfc;
        expect(decodeBlackboxLogListReply(view(bytes))).toMatchObject({ more: false, onFlash: false });
        bytes[4] = 0x02;
        expect(decodeBlackboxLogListReply(view(bytes))).toMatchObject({ more: false, onFlash: true });
        bytes[4] = 0x03;
        expect(decodeBlackboxLogListReply(view(bytes))).toMatchObject({ more: true, onFlash: true });
    });

    it("decodes flash logs without dates, entries starting after the 6-byte header", () => {
        const reply = decodeBlackboxLogListReply(
            view(
                listReply({
                    onFlash: true,
                    progress: 100,
                    entries: [listEntry(ascii("LOG00001.BFL"), 1000, 0, 0), listEntry(ascii("LOG00002.BFL"), 7, 0, 0)],
                }),
            ),
        );
        expect(reply.onFlash).toBe(true);
        expect(reply.entries.map((e) => [e.name, e.size, e.timestamp])).toEqual([
            ["LOG00001.BFL", 1000, null],
            ["LOG00002.BFL", 7, null],
        ]);
    });

    it("reports scan progress with status IN_PROGRESS", () => {
        const reply = decodeBlackboxLogListReply(
            view(listReply({ status: BLACKBOX_LOG_STATUS.IN_PROGRESS, onFlash: true, progress: 42 })),
        );
        expect(BLACKBOX_LOG_STATUS.IN_PROGRESS).toBe(6);
        expect(reply).toMatchObject({ status: 6, progress: 42, onFlash: true, entries: [] });
    });

    it("returns the status, storage flag and no entries when status is not OK", () => {
        expect(
            decodeBlackboxLogListReply(view(listReply({ status: BLACKBOX_LOG_STATUS.NOT_READY, onFlash: false }))),
        ).toMatchObject({ status: 1, onFlash: false, entries: [], more: false });
        expect(
            decodeBlackboxLogListReply(view(listReply({ status: BLACKBOX_LOG_STATUS.BUSY, onFlash: true }))),
        ).toMatchObject({ status: 2, onFlash: true, entries: [] });
        // a bare status byte is tolerated for errors
        expect(decodeBlackboxLogListReply(view([BLACKBOX_LOG_STATUS.BUSY])).status).toBe(2);
    });

    it("throws on empty or truncated replies", () => {
        expect(() => decodeBlackboxLogListReply(view([]))).toThrow();
        expect(() => decodeBlackboxLogListReply(view([0, 0, 0]))).toThrow();
        // the old 5-byte header is truncated now
        expect(() => decodeBlackboxLogListReply(view([0, 0, 0, 0, 0]))).toThrow();
        const truncated = listReply({ entries: [listEntry(ascii("A.BFL"), 1, 0, 0)] }).slice(0, -1);
        expect(() => decodeBlackboxLogListReply(view(truncated))).toThrow();
    });
});

// --- ERASE_ALL reply ----------------------------------------------------------------------------------------------

describe("decodeBlackboxLogEraseReply", () => {
    it("decodes u8 status and u8 progress percent", () => {
        expect(decodeBlackboxLogEraseReply(view([6, 0]))).toEqual({ status: 6, progress: 0 });
        expect(decodeBlackboxLogEraseReply(view([6, 99]))).toEqual({ status: 6, progress: 99 });
        expect(decodeBlackboxLogEraseReply(view([0, 100]))).toEqual({ status: 0, progress: 100 });
        expect(decodeBlackboxLogEraseReply(view([3, 12]))).toEqual({ status: 3, progress: 12 });
    });

    it("maps progress 255 to unknown (null)", () => {
        expect(decodeBlackboxLogEraseReply(view([6, 255]))).toEqual({ status: 6, progress: null });
    });

    it("throws on an empty reply", () => {
        expect(() => decodeBlackboxLogEraseReply(view([]))).toThrow();
    });
});

// --- READ reply --------------------------------------------------------------------------------------------------

describe("decodeBlackboxLogReadReply", () => {
    it("returns only the status when status is not OK", () => {
        for (const status of [1, 2, 3, 4, 5, 6]) {
            const reply = decodeBlackboxLogReadReply(view([status]), 0);
            expect(reply.status).toBe(status);
            expect(reply.data).toBeNull();
            expect(reply.retry).toBe(false);
            expect(reply.error).toBeNull();
        }
    });

    it("decodes an uncompressed chunk", () => {
        const reply = decodeBlackboxLogReadReply(view([0, ...rawChunk(8192, [1, 2, 3, 250])]), 8192);
        expect(reply.status).toBe(0);
        expect(reply.retry).toBe(false);
        expect(reply.address).toBe(8192);
        expect(bytesOf(reply.data)).toEqual([1, 2, 3, 250]);
    });

    it("reports end of file as a zero-length chunk", () => {
        const reply = decodeBlackboxLogReadReply(view([0, ...rawChunk(100, [])]), 100);
        expect(reply.retry).toBe(false);
        expect(reply.data.byteLength).toBe(0);
    });

    it("decodes a huffman-compressed chunk", () => {
        const data = [0, 0, 1, 2, 3, 0x50, 0x10, 0, 0xff, 0x80, 7, 7, 7];
        const reply = decodeBlackboxLogReadReply(view([0, ...huffmanChunk(4096, data)]), 4096);
        expect(reply.error).toBeNull();
        expect(bytesOf(reply.data)).toEqual(data);
        expect(reply.bytesCompressed).toBe(huffmanEncode(data).length + 2);
    });

    it("treats a compressed chunk with zero decompressed bytes as end of file", () => {
        const reply = decodeBlackboxLogReadReply(view([0, ...u32(10), ...u16(2), 1, ...u16(0)]), 10);
        expect(reply.error).toBeNull();
        expect(reply.data.byteLength).toBe(0);
    });

    it("requests a retry when the echoed offset does not match", () => {
        const reply = decodeBlackboxLogReadReply(view([0, ...rawChunk(4096, [1, 2])]), 0);
        expect(reply.retry).toBe(true);
        expect(reply.data).toBeNull();
    });

    it("requests a retry for an empty or header-truncated reply", () => {
        expect(decodeBlackboxLogReadReply(view([]), 0).retry).toBe(true);
        expect(decodeBlackboxLogReadReply(view([0, 0, 0, 0, 0, 0]), 0).retry).toBe(true);
    });

    it("reports unknown compression types and truncated payloads as errors", () => {
        expect(decodeBlackboxLogReadReply(view([0, ...u32(0), ...u16(0), 7]), 0).error).toBeInstanceOf(Error);
        const truncated = [0, ...rawChunk(0, [1, 2, 3, 4])].slice(0, -1);
        expect(decodeBlackboxLogReadReply(view(truncated), 0).error).toBeInstanceOf(Error);
    });

    it("decodes the body exactly like an MSP_DATAFLASH_READ reply", () => {
        const body = huffmanChunk(512, [5, 6, 7, 8, 0, 0]);
        const flash = decodeDataflashReadReply(view(body), 0, 512);
        const sd = decodeBlackboxLogReadReply(view([0, ...body]), 512);
        expect(bytesOf(sd.data)).toEqual(bytesOf(flash.data));
        expect(sd.bytesCompressed).toBe(flash.bytesCompressed);
    });

    it("works on a DataView with a non-zero byteOffset", () => {
        const backing = new Uint8Array([0xaa, 0xbb, 0, ...rawChunk(0, [9, 8, 7])]);
        const reply = decodeBlackboxLogReadReply(new DataView(backing.buffer, 2), 0);
        expect(bytesOf(reply.data)).toEqual([9, 8, 7]);
    });
});

// --- MspHelper wrappers ------------------------------------------------------------------------------------------

describe("MspHelper blackbox log / dataflash wrappers", () => {
    const helper = new MspHelper();

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("dataflashRead still delivers (address, data, bytesCompressed) from the shared decoder", async () => {
        vi.spyOn(MSP, "promise").mockResolvedValue({ data: view(rawChunk(64, [1, 2, 3])) });
        const callback = vi.fn();
        helper.dataflashRead(64, 4096, callback);
        await vi.waitFor(() => expect(callback).toHaveBeenCalled());
        expect(MSP.promise).toHaveBeenCalledWith(MSPCodes.MSP_DATAFLASH_READ, [64, 0, 0, 0, 0, 16, 1]);
        const [address, data, compressed] = callback.mock.calls[0];
        expect(address).toBe(64);
        expect(bytesOf(data)).toEqual([1, 2, 3]);
        expect(compressed).toBeUndefined();
    });

    it("dataflashRead passes null (retry) on address mismatch and CRC error, the error on timeout", async () => {
        const callback = vi.fn();
        vi.spyOn(MSP, "promise").mockResolvedValueOnce({ data: view(rawChunk(0, [1])) });
        helper.dataflashRead(64, 4096, callback);
        await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
        expect(callback.mock.calls[0]).toEqual([64, null]);

        MSP.promise.mockRejectedValueOnce(new MspCrcError("crc", MSPCodes.MSP_DATAFLASH_READ));
        helper.dataflashRead(64, 4096, callback);
        await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2));
        expect(callback.mock.calls[1]).toEqual([64, null]);

        const timeout = new MspTimeoutError("timeout", MSPCodes.MSP_DATAFLASH_READ);
        MSP.promise.mockRejectedValueOnce(timeout);
        helper.dataflashRead(64, 4096, callback);
        await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(3));
        expect(callback.mock.calls[2]).toEqual([64, null, null, timeout]);
    });

    it("blackboxLogRead sends the encoded request and decodes the reply", async () => {
        vi.spyOn(MSP, "promise").mockResolvedValue({ data: view([0, ...rawChunk(4096, [4, 5])]) });
        const reply = await helper.blackboxLogRead("LOG00001.BFL", 4096, 4096);
        expect(MSP.promise).toHaveBeenCalledWith(
            MSPCodes.MSP2_INDI_BLACKBOX_LOG_READ,
            encodeBlackboxLogReadRequest("LOG00001.BFL", 4096, 4096, true),
        );
        expect(bytesOf(reply.data)).toEqual([4, 5]);
    });

    it("blackboxLog* report firmware without support (MSP '!' reply) as unsupported", async () => {
        vi.spyOn(MSP, "promise").mockResolvedValue({ data: view([]), unsupported: 1 });
        await expect(helper.blackboxLogList(0)).resolves.toEqual({ unsupported: true });
        await expect(helper.blackboxLogRead("A.BFL", 0, 4096)).resolves.toEqual({ unsupported: true });
        await expect(helper.blackboxLogClose()).resolves.toEqual({ unsupported: true });
        await expect(helper.blackboxLogEraseAll(true)).resolves.toEqual({ unsupported: true });
    });

    it("blackboxLogEraseAll sends u8 start and decodes status + progress", async () => {
        vi.spyOn(MSP, "promise").mockResolvedValue({ data: view([BLACKBOX_LOG_STATUS.IN_PROGRESS, 37]) });
        await expect(helper.blackboxLogEraseAll(true)).resolves.toEqual({ status: 6, progress: 37 });
        expect(MSP.promise).toHaveBeenLastCalledWith(MSPCodes.MSP2_INDI_BLACKBOX_LOG_ERASE_ALL, [1]);
        await helper.blackboxLogEraseAll(false);
        expect(MSP.promise).toHaveBeenLastCalledWith(MSPCodes.MSP2_INDI_BLACKBOX_LOG_ERASE_ALL, [0]);
    });

    it("blackboxLogRead turns a CRC error into a retry and rethrows timeouts", async () => {
        vi.spyOn(MSP, "promise").mockRejectedValueOnce(new MspCrcError("crc", 0x4007));
        await expect(helper.blackboxLogRead("A.BFL", 0, 4096)).resolves.toMatchObject({ retry: true });
        MSP.promise.mockRejectedValueOnce(new MspTimeoutError("timeout", 0x4007));
        await expect(helper.blackboxLogRead("A.BFL", 0, 4096)).rejects.toBeInstanceOf(MspTimeoutError);
    });

    it("blackboxLogClose returns the status byte", async () => {
        vi.spyOn(MSP, "promise").mockResolvedValue({ data: view([BLACKBOX_LOG_STATUS.OK]) });
        await expect(helper.blackboxLogClose()).resolves.toEqual({ status: 0 });
        expect(MSP.promise).toHaveBeenCalledWith(MSPCodes.MSP2_INDI_BLACKBOX_LOG_CLOSE);
    });
});

// --- download / list loops ---------------------------------------------------------------------------------------

const ok = (bytes, offset = 0) => ({ status: 0, address: offset, data: view(bytes), retry: false, error: null });

describe("readBlackboxLogFile", () => {
    it("reads sequential chunks until a zero-length chunk and returns the byte count", async () => {
        const chunks = [[1, 2, 3], [4, 5], []];
        const read = vi.fn(async () => ok(chunks.shift()));
        const received = [];
        const total = await readBlackboxLogFile({
            read,
            name: "LOG1.BFL",
            onChunk: (data, offset) => received.push([offset, ...bytesOf(data)]),
        });
        expect(total).toBe(5);
        expect(read.mock.calls.map((c) => c[1])).toEqual([0, 3, 5]);
        expect(received).toEqual([
            [0, 1, 2, 3],
            [3, 4, 5],
        ]);
    });

    it("retries the same offset on retry replies and I/O errors", async () => {
        const replies = [
            ok([1]),
            { status: 0, data: null, retry: true },
            { status: BLACKBOX_LOG_STATUS.IO_ERROR },
            ok([2]),
            ok([]),
        ];
        const read = vi.fn(async () => replies.shift());
        const total = await readBlackboxLogFile({ read, name: "A", onChunk: () => {}, ioRetryDelayMs: 0 });
        expect(total).toBe(2);
        expect(read.mock.calls.map((c) => c[1])).toEqual([0, 1, 1, 1, 2]);
    });

    it("gives up after too many consecutive failures", async () => {
        const read = vi.fn(async () => ({ status: BLACKBOX_LOG_STATUS.IO_ERROR }));
        const error = await readBlackboxLogFile({
            read,
            name: "A",
            onChunk: () => {},
            maxRetries: 2,
            ioRetryDelayMs: 0,
        }).catch((e) => e);
        expect(error).toBeInstanceOf(BlackboxLogError);
        expect(error.status).toBe(BLACKBOX_LOG_STATUS.IO_ERROR);
        expect(read).toHaveBeenCalledTimes(3);

        const retrying = vi.fn(async () => ({ status: 0, data: null, retry: true }));
        await expect(
            readBlackboxLogFile({ read: retrying, name: "A", onChunk: () => {}, maxRetries: 1 }),
        ).rejects.toMatchObject({
            kind: "retries",
        });
    });

    it("aborts immediately on busy, not found and unsupported", async () => {
        for (const status of [BLACKBOX_LOG_STATUS.BUSY, BLACKBOX_LOG_STATUS.NOT_FOUND, BLACKBOX_LOG_STATUS.NOT_READY]) {
            const read = vi.fn(async () => ({ status }));
            await expect(readBlackboxLogFile({ read, name: "A", onChunk: () => {} })).rejects.toMatchObject({ status });
            expect(read).toHaveBeenCalledTimes(1);
        }
        await expect(
            readBlackboxLogFile({ read: async () => ({ unsupported: true }), name: "A", onChunk: () => {} }),
        ).rejects.toMatchObject({ kind: "unsupported" });
    });

    it("waits and re-requests the same offset while the FC reports IN_PROGRESS, without using up retries", async () => {
        const replies = [
            { status: BLACKBOX_LOG_STATUS.IN_PROGRESS },
            { status: BLACKBOX_LOG_STATUS.IN_PROGRESS },
            { status: BLACKBOX_LOG_STATUS.IN_PROGRESS },
            ok([1, 2]),
            { status: BLACKBOX_LOG_STATUS.IN_PROGRESS },
            ok([]),
        ];
        const read = vi.fn(async () => replies.shift());
        const total = await readBlackboxLogFile({
            read,
            name: "A",
            onChunk: () => {},
            maxRetries: 1,
            inProgressDelayMs: 0,
        });
        expect(total).toBe(2);
        expect(read.mock.calls.map((c) => c[1])).toEqual([0, 0, 0, 0, 2, 2]);
    });

    it("gives up when IN_PROGRESS lasts too long", async () => {
        const read = vi.fn(async () => ({ status: BLACKBOX_LOG_STATUS.IN_PROGRESS }));
        await expect(
            readBlackboxLogFile({ read, name: "A", onChunk: () => {}, inProgressDelayMs: 1, maxInProgressMs: 5 }),
        ).rejects.toMatchObject({ kind: "status", status: BLACKBOX_LOG_STATUS.IN_PROGRESS });
    });

    it("stops when cancelled between chunks", async () => {
        let cancelled = false;
        const read = vi.fn(async () => ok([1, 2]));
        const promise = readBlackboxLogFile({
            read,
            name: "A",
            isCancelled: () => cancelled,
            onChunk: () => {
                cancelled = true;
            },
        });
        await expect(promise).rejects.toMatchObject({ kind: "cancelled" });
        expect(read).toHaveBeenCalledTimes(1);
    });

    it("propagates write errors from onChunk", async () => {
        const read = vi.fn(async () => ok([1]));
        await expect(
            readBlackboxLogFile({
                read,
                name: "A",
                onChunk: () => {
                    throw new Error("disk full");
                },
            }),
        ).rejects.toThrow("disk full");
    });
});

describe("listBlackboxLogs", () => {
    const entry = (name) => ({ name, size: 1, fatDate: 0, fatTime: 0, timestamp: null });

    it("follows the more flag, advancing startIndex by the page size", async () => {
        const pages = {
            0: { status: 0, startIndex: 0, more: true, entries: [entry("A"), entry("B")] },
            2: { status: 0, startIndex: 2, more: true, entries: [entry("C")] },
            3: { status: 0, startIndex: 3, more: false, entries: [] },
        };
        const list = vi.fn(async (start) => pages[start]);
        const { entries, onFlash } = await listBlackboxLogs(list);
        expect(list.mock.calls.map((c) => c[0])).toEqual([0, 2, 3]);
        expect(entries.map((e) => e.name)).toEqual(["A", "B", "C"]);
        expect(onFlash).toBe(false);
    });

    it("re-sends the same request while the flash scan is IN_PROGRESS and reports its progress", async () => {
        // replies decoded from spec bytes, as the MSP layer would deliver them
        const replies = [
            listReply({ status: 6, onFlash: true, progress: 0 }),
            listReply({ status: 6, onFlash: true, progress: 42 }),
            listReply({
                status: 0,
                onFlash: true,
                progress: 100,
                more: true,
                entries: [listEntry(ascii("LOG1.BFL"), 5, 0, 0)],
            }),
            listReply({ status: 6, onFlash: true, progress: 99, startIndex: 1 }),
            listReply({ status: 0, onFlash: true, startIndex: 1, entries: [listEntry(ascii("LOG2.BFL"), 6, 0, 0)] }),
        ].map((bytes) => decodeBlackboxLogListReply(view(bytes)));
        const list = vi.fn(async () => replies.shift());
        const seen = [];
        const result = await listBlackboxLogs(list, {
            inProgressDelayMs: 0,
            onReply: (reply) => seen.push([reply.status, reply.progress]),
        });
        expect(list.mock.calls.map((c) => c[0])).toEqual([0, 0, 0, 1, 1]);
        expect(seen.slice(0, 2)).toEqual([
            [6, 0],
            [6, 42],
        ]);
        expect(result.onFlash).toBe(true);
        expect(result.entries.map((e) => e.name)).toEqual(["LOG1.BFL", "LOG2.BFL"]);
    });

    it("maps status and unsupported replies to BlackboxLogError", async () => {
        await expect(listBlackboxLogs(async () => ({ unsupported: true }))).rejects.toMatchObject({
            kind: "unsupported",
        });
        await expect(listBlackboxLogs(async () => ({ status: BLACKBOX_LOG_STATUS.BUSY }))).rejects.toMatchObject({
            status: BLACKBOX_LOG_STATUS.BUSY,
        });
    });
});

describe("eraseAllBlackboxLogs", () => {
    // replies decoded from spec bytes [status, progress]
    const reply = (status, progress) => decodeBlackboxLogEraseReply(view([status, progress]));
    const IN_PROGRESS = 6;

    function fakeErase(replies) {
        return vi.fn(async () => {
            const next = replies.shift();
            if (next instanceof Error) {
                throw next;
            }
            return next;
        });
    }

    it("starts once, then polls with start=0 until the status is no longer IN_PROGRESS", async () => {
        const erase = fakeErase([reply(IN_PROGRESS, 0), reply(IN_PROGRESS, 40), reply(IN_PROGRESS, 80), reply(0, 100)]);
        const progress = [];
        await eraseAllBlackboxLogs(erase, { pollIntervalMs: 0, onProgress: (p) => progress.push(p) });
        expect(erase.mock.calls.map((c) => c[0])).toEqual([true, false, false, false]);
        expect(progress).toEqual([0, 40, 80, 100]);
    });

    it("passes progress 255 on as unknown (null)", async () => {
        const erase = fakeErase([reply(IN_PROGRESS, 255), reply(IN_PROGRESS, 255), reply(0, 255)]);
        const progress = [];
        await eraseAllBlackboxLogs(erase, { pollIntervalMs: 0, onProgress: (p) => progress.push(p) });
        expect(progress).toEqual([null, null, 100]);
    });

    it("finishes without polling when the first reply is OK", async () => {
        const erase = fakeErase([reply(0, 100)]);
        await eraseAllBlackboxLogs(erase, { pollIntervalMs: 0 });
        expect(erase).toHaveBeenCalledTimes(1);
    });

    it("polls at the given interval (FC abandons an SD erase when polls stop for ~2 s)", async () => {
        vi.useFakeTimers();
        try {
            const erase = fakeErase([reply(IN_PROGRESS, 0), reply(IN_PROGRESS, 50), reply(0, 100)]);
            const done = eraseAllBlackboxLogs(erase, { pollIntervalMs: 250 });
            await vi.advanceTimersByTimeAsync(249);
            expect(erase).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(erase).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(250);
            await done;
            expect(erase).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it("throws the final status when it is an error", async () => {
        for (const status of [2, 3, 1, 5]) {
            const erase = fakeErase([reply(IN_PROGRESS, 10), reply(status, 10)]);
            await expect(eraseAllBlackboxLogs(erase, { pollIntervalMs: 0 })).rejects.toMatchObject({
                kind: "status",
                status,
            });
        }
        // error on the start request itself
        const erase = fakeErase([reply(3, 0), reply(0, 0)]);
        await expect(eraseAllBlackboxLogs(erase, { pollIntervalMs: 0 })).rejects.toMatchObject({ status: 3 });
    });

    it("reports BUSY on start, unless a poll shows an erase already running", async () => {
        const busy = fakeErase([reply(2, 0), reply(0, 0)]);
        await expect(eraseAllBlackboxLogs(busy, { pollIntervalMs: 0 })).rejects.toMatchObject({ status: 2 });

        const running = fakeErase([reply(2, 0), reply(IN_PROGRESS, 60), reply(0, 100)]);
        await expect(eraseAllBlackboxLogs(running, { pollIntervalMs: 0 })).resolves.toBeUndefined();
        expect(running.mock.calls.map((c) => c[0])).toEqual([true, false, false]);
    });

    it("throws unsupported for firmware without the command", async () => {
        const erase = fakeErase([{ unsupported: true }]);
        await expect(eraseAllBlackboxLogs(erase)).rejects.toMatchObject({ kind: "unsupported" });
    });

    it("keeps polling through a few transient MSP errors but not through a disconnect", async () => {
        const transient = fakeErase([
            reply(IN_PROGRESS, 0),
            new MspCrcError("crc", 0x4009),
            new MspTimeoutError("timeout", 0x4009),
            new MspCancelledError("tab switch", 0x4009, "cleanup"),
            reply(0, 100),
        ]);
        await expect(eraseAllBlackboxLogs(transient, { pollIntervalMs: 0 })).resolves.toBeUndefined();

        const disconnected = fakeErase([
            reply(IN_PROGRESS, 0),
            new MspCancelledError("closed", 0x4009, "disconnected"),
        ]);
        await expect(eraseAllBlackboxLogs(disconnected, { pollIntervalMs: 0 })).rejects.toBeInstanceOf(
            MspCancelledError,
        );

        const flaky = fakeErase([
            reply(IN_PROGRESS, 0),
            ...Array.from({ length: 4 }, () => new MspCrcError("crc", 0x4009)),
        ]);
        await expect(eraseAllBlackboxLogs(flaky, { pollIntervalMs: 0, maxTransientErrors: 3 })).rejects.toBeInstanceOf(
            MspCrcError,
        );
    });
});
