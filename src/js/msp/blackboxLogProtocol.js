import "../injected_methods";
import huffmanDecodeBuf from "../huffman";
import { defaultHuffmanTree, defaultHuffmanLenIndex } from "../default_huffman_tree";

// Pure encode/decode for MSP_DATAFLASH_READ and the MSP2_INDI_BLACKBOX_LOG_* commands. Kept free of app imports
// (re-exported by MSPHelper.js) so stores/composables can use the constants at module load without an import cycle
// through MSPHelper -> serial_backend -> tab registry.

const DATAFLASH_READ_HEADER_SIZE = 7; // u32 address, u16 dataSize, u8 compressionType
const DATAFLASH_COMPRESSION_NONE = 0;
const DATAFLASH_COMPRESSION_HUFFMAN = 1;

/**
 * Decode the body of an MSP_DATAFLASH_READ (new format) reply. MSP2_INDI_BLACKBOX_LOG_READ embeds the exact same
 * structure after its status byte, hence the `offset` parameter.
 *
 * @param {DataView} view - reply payload
 * @param {number} [offset=0] - byte offset of the u32 address field within `view`
 * @param {number} [expectedAddress] - when given, a mismatching (or truncated) header yields `retry: true` and the
 *   payload is not decoded
 * @returns {{address: number|null, data: DataView|null, bytesCompressed: number|undefined, retry: boolean,
 *   error: Error|null}} `data` holds the (decompressed) bytes; zero length means end of data. `bytesCompressed` is
 *   the on-wire payload size for compressed chunks, undefined for raw ones.
 */
export function decodeDataflashReadReply(view, offset = 0, expectedAddress = undefined) {
    const result = { address: null, data: null, bytesCompressed: undefined, retry: false, error: null };

    if (view.byteLength < offset + DATAFLASH_READ_HEADER_SIZE) {
        result.retry = true;
        return result;
    }

    result.address = view.getUint32(offset, true);
    if (expectedAddress !== undefined && result.address !== expectedAddress) {
        result.retry = true;
        return result;
    }

    const dataSize = view.getUint16(offset + 4, true);
    const compressionType = view.getUint8(offset + 6);
    const payloadStart = offset + DATAFLASH_READ_HEADER_SIZE;

    if (compressionType === DATAFLASH_COMPRESSION_NONE) {
        if (payloadStart + dataSize > view.byteLength) {
            result.error = new Error(`Truncated dataflash read reply (${dataSize} bytes announced)`);
            return result;
        }
        result.data = new DataView(view.buffer, view.byteOffset + payloadStart, dataSize);
    } else if (compressionType === DATAFLASH_COMPRESSION_HUFFMAN) {
        if (dataSize < 2 || payloadStart + dataSize > view.byteLength) {
            result.error = new Error(`Truncated compressed dataflash read reply (${dataSize} bytes announced)`);
            return result;
        }
        // Compressed format uses 2 additional bytes as a pseudo-header to denote the number of uncompressed bytes;
        // decoding stops there to avoid decoding stray bit sequences as bytes
        const decompressedCharCount = view.getUint16(payloadStart, true);
        const compressedArray = new Uint8Array(view.buffer, view.byteOffset + payloadStart + 2, dataSize - 2);
        const decompressedArray = huffmanDecodeBuf(
            compressedArray,
            decompressedCharCount,
            defaultHuffmanTree,
            defaultHuffmanLenIndex,
        );
        result.data = new DataView(decompressedArray.buffer);
        result.bytesCompressed = dataSize;
    } else {
        result.error = new Error(`Unknown dataflash compression type ${compressionType}`);
    }

    return result;
}

/** Status byte at the start of every MSP2_INDI_BLACKBOX_LOG_* reply. */
export const BLACKBOX_LOG_STATUS = Object.freeze({
    OK: 0,
    NOT_READY: 1, // storage (SD card or flash) not present or not ready
    BUSY: 2, // armed, logging, or an erase is running
    IO_ERROR: 3,
    NOT_FOUND: 4,
    BAD_REQUEST: 5,
    IN_PROGRESS: 6, // flash scan or erase still running: ask again
});

export const BLACKBOX_LOG_NAME_LENGTH = 12;
const BLACKBOX_LOG_LIST_HEADER_SIZE = 6; // u8 status, u16 startIndex, u8 count, u8 flags, u8 progress
const BLACKBOX_LOG_LIST_ENTRY_SIZE = BLACKBOX_LOG_NAME_LENGTH + 8; // name, u32 size, u16 fatDate, u16 fatTime
const BLACKBOX_LOG_LIST_FLAG_MORE = 0x01;
const BLACKBOX_LOG_LIST_FLAG_ON_FLASH = 0x02;
// ERASE_ALL progress value meaning "no percentage available"
const BLACKBOX_LOG_PROGRESS_UNKNOWN = 255;

// asyncfatfs stamps files with this date/time when the FC had no RTC time (e.g. powered from a battery only)
const AFATFS_DEFAULT_FILE_DATE = (2015 - 1980) * 512 + 12 * 32 + 1;
const AFATFS_DEFAULT_FILE_TIME = 0;

/**
 * Decode a FAT directory entry date/time. The FC writes local time, so the fields are returned as-is rather than as a
 * Date (which would imply a timezone).
 *
 * @param {number} fatDate - bits 15-9 year-1980, 8-5 month, 4-0 day; 0 = unknown
 * @param {number} fatTime - bits 15-11 hours, 10-5 minutes, 4-0 seconds/2
 * @returns {{year: number, month: number, day: number, hours: number, minutes: number, seconds: number}|null}
 *   null when unknown, out of range, or the asyncfatfs "no RTC" placeholder
 */
export function decodeFatTimestamp(fatDate, fatTime) {
    if (!fatDate || (fatDate === AFATFS_DEFAULT_FILE_DATE && fatTime === AFATFS_DEFAULT_FILE_TIME)) {
        return null;
    }

    const timestamp = {
        year: 1980 + (fatDate >> 9),
        month: (fatDate >> 5) & 0x0f,
        day: fatDate & 0x1f,
        hours: (fatTime >> 11) & 0x1f,
        minutes: (fatTime >> 5) & 0x3f,
        seconds: (fatTime & 0x1f) * 2,
    };

    const valid =
        timestamp.month >= 1 &&
        timestamp.month <= 12 &&
        timestamp.day >= 1 &&
        timestamp.hours <= 23 &&
        timestamp.minutes <= 59 &&
        timestamp.seconds <= 59;

    return valid ? timestamp : null;
}

/**
 * Encode an 8.3 filename into the fixed NUL-padded field used by MSP2_INDI_BLACKBOX_LOG_READ.
 *
 * @param {string} name
 * @returns {number[]} exactly BLACKBOX_LOG_NAME_LENGTH bytes
 */
export function encodeBlackboxLogName(name) {
    if (typeof name !== "string" || name.length === 0 || name.length > BLACKBOX_LOG_NAME_LENGTH) {
        throw new Error(`Invalid log file name: ${name}`);
    }
    const bytes = new Array(BLACKBOX_LOG_NAME_LENGTH).fill(0);
    for (let i = 0; i < name.length; i++) {
        const code = name.charCodeAt(i);
        if (code === 0 || code > 0x7f) {
            throw new Error(`Invalid log file name: ${name}`);
        }
        bytes[i] = code;
    }
    return bytes;
}

/**
 * @param {number} startIndex - index of the first entry to return
 * @returns {number[]} MSP2_INDI_BLACKBOX_LOG_LIST request payload
 */
export function encodeBlackboxLogListRequest(startIndex) {
    return [].push16(startIndex);
}

/**
 * @typedef {object} BlackboxLogEntry
 * @property {string} name - 8.3 filename, e.g. "LOG00012.BFL"
 * @property {number} size - file size in bytes
 * @property {number} fatDate
 * @property {number} fatTime
 * @property {ReturnType<typeof decodeFatTimestamp>} timestamp
 */

/**
 * Decode one MSP2_INDI_BLACKBOX_LOG_LIST reply page.
 *
 * @param {DataView} view
 * @returns {{status: number, startIndex: number|null, more: boolean, onFlash: boolean, progress: number|null,
 *   entries: BlackboxLogEntry[]}} `onFlash`: logs come from onboard flash rather than the SD card. `progress`: flash
 *   scan percentage, meaningful with status IN_PROGRESS.
 * @throws {Error} on an empty or truncated reply
 */
export function decodeBlackboxLogListReply(view) {
    if (view.byteLength < 1) {
        throw new Error("Empty blackbox log list reply");
    }

    const status = view.getUint8(0);
    if (view.byteLength < BLACKBOX_LOG_LIST_HEADER_SIZE) {
        if (status !== BLACKBOX_LOG_STATUS.OK) {
            // The header is specified to be complete for any status; tolerate a bare status byte anyway.
            return { status, startIndex: null, more: false, onFlash: false, progress: null, entries: [] };
        }
        throw new Error("Truncated blackbox log list reply");
    }

    const startIndex = view.getUint16(1, true);
    const count = view.getUint8(3);
    const flags = view.getUint8(4);
    const progress = view.getUint8(5);
    const header = {
        status,
        startIndex,
        more: (flags & BLACKBOX_LOG_LIST_FLAG_MORE) !== 0,
        onFlash: (flags & BLACKBOX_LOG_LIST_FLAG_ON_FLASH) !== 0,
        progress,
    };
    if (status !== BLACKBOX_LOG_STATUS.OK) {
        return { ...header, more: false, entries: [] };
    }
    if (view.byteLength < BLACKBOX_LOG_LIST_HEADER_SIZE + count * BLACKBOX_LOG_LIST_ENTRY_SIZE) {
        throw new Error(`Truncated blackbox log list reply (${count} entries announced)`);
    }

    const entries = [];
    for (let i = 0; i < count; i++) {
        const base = BLACKBOX_LOG_LIST_HEADER_SIZE + i * BLACKBOX_LOG_LIST_ENTRY_SIZE;
        let name = "";
        for (let j = 0; j < BLACKBOX_LOG_NAME_LENGTH; j++) {
            const code = view.getUint8(base + j);
            if (code === 0) {
                break;
            }
            name += String.fromCharCode(code);
        }
        const size = view.getUint32(base + BLACKBOX_LOG_NAME_LENGTH, true);
        const fatDate = view.getUint16(base + BLACKBOX_LOG_NAME_LENGTH + 4, true);
        const fatTime = view.getUint16(base + BLACKBOX_LOG_NAME_LENGTH + 6, true);
        entries.push({ name, size, fatDate, fatTime, timestamp: decodeFatTimestamp(fatDate, fatTime) });
    }

    return { ...header, entries };
}

/**
 * @param {string} name - filename as returned by the list command
 * @param {number} offset - byte offset in the file
 * @param {number} size - requested max number of uncompressed bytes
 * @param {boolean} [allowCompression=true]
 * @returns {number[]} MSP2_INDI_BLACKBOX_LOG_READ request payload
 */
export function encodeBlackboxLogReadRequest(name, offset, size, allowCompression = true) {
    return encodeBlackboxLogName(name)
        .push32(offset)
        .push16(size)
        .push8(allowCompression ? 1 : 0);
}

/**
 * Decode an MSP2_INDI_BLACKBOX_LOG_READ reply: a status byte followed, on success, by an MSP_DATAFLASH_READ reply.
 *
 * @param {DataView} view
 * @param {number} [expectedOffset] - see decodeDataflashReadReply's `expectedAddress`
 * @returns {{status: number|null} & ReturnType<typeof decodeDataflashReadReply>} `status` is null for an empty
 *   reply, which is flagged `retry`
 */
export function decodeBlackboxLogReadReply(view, expectedOffset = undefined) {
    if (view.byteLength < 1) {
        return { status: null, address: null, data: null, bytesCompressed: undefined, retry: true, error: null };
    }
    const status = view.getUint8(0);
    if (status !== BLACKBOX_LOG_STATUS.OK) {
        return { status, address: null, data: null, bytesCompressed: undefined, retry: false, error: null };
    }
    return { status, ...decodeDataflashReadReply(view, 1, expectedOffset) };
}

/**
 * @param {boolean} start - true to start erasing all logs, false to only poll progress
 * @returns {number[]} MSP2_INDI_BLACKBOX_LOG_ERASE_ALL request payload
 */
export function encodeBlackboxLogEraseRequest(start) {
    return [start ? 1 : 0];
}

/**
 * Decode an MSP2_INDI_BLACKBOX_LOG_ERASE_ALL reply.
 *
 * @param {DataView} view
 * @returns {{status: number, progress: number|null}} `progress` in percent, null when unknown (255 or missing)
 * @throws {Error} on an empty reply
 */
export function decodeBlackboxLogEraseReply(view) {
    if (view.byteLength < 1) {
        throw new Error("Empty blackbox log erase reply");
    }
    const status = view.getUint8(0);
    const raw = view.byteLength >= 2 ? view.getUint8(1) : BLACKBOX_LOG_PROGRESS_UNKNOWN;
    return { status, progress: raw === BLACKBOX_LOG_PROGRESS_UNKNOWN ? null : Math.min(raw, 100) };
}
