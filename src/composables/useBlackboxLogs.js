import { computed, reactive, ref, shallowRef } from "vue";
import MSP from "../js/msp";
import MSPCodes from "../js/msp/MSPCodes";
import { mspHelper } from "../js/msp/MSPHelper";
import { BLACKBOX_LOG_STATUS } from "../js/msp/blackboxLogProtocol";
import { MspCancelledError, MspCrcError, MspTimeoutError, isMspCancelled } from "../js/msp/mspErrors";
import CONFIGURATOR from "../js/data_storage";
import FC from "../js/fc";
import FileSystem from "../js/FileSystem";
import { i18n } from "../js/localization";
import { useConnectionStore } from "../stores/connection";

// Same request size as the dataflash download; the FC truncates to what fits in its MSP buffer.
export const BLACKBOX_LOG_BLOCK_SIZE = 4096;
// Consecutive failed attempts (CRC error, offset mismatch, I/O error) on one request before giving up.
export const BLACKBOX_LOG_MAX_RETRIES = 10;
const IO_RETRY_DELAY_MS = 200;
// Re-ask interval while the FC reports IN_PROGRESS (flash scan), and how long to keep asking.
const IN_PROGRESS_DELAY_MS = 75;
const MAX_IN_PROGRESS_MS = 120_000;
// The FC abandons an SD card erase when polls stop for ~2 s, so poll well within that.
const ERASE_POLL_INTERVAL_MS = 250;
// Consecutive transient MSP failures (CRC, timeout, queue cleanup on tab switch) tolerated while erasing.
const ERASE_MAX_TRANSIENT_ERRORS = 5;
// Defensive bound on LIST paging in case a firmware never clears the "more" flag.
const MAX_LIST_PAGES = 1000;

/**
 * Failure of a blackbox log operation. `kind` is one of "unsupported", "status" (FC returned `status`), "retries"
 * (too many failed attempts on one request) or "cancelled" (by the user).
 */
export class BlackboxLogError extends Error {
    constructor(kind, status = null) {
        super(status === null ? `Blackbox log ${kind}` : `Blackbox log status ${status}`);
        this.name = "BlackboxLogError";
        this.kind = kind;
        this.status = status;
    }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read one log file from offset 0 until the FC reports end of file, retrying transient failures like the dataflash
 * download does, and waiting while the FC reports IN_PROGRESS (flash scan not finished).
 *
 * @param {object} options
 * @param {(name: string, offset: number, blockSize: number) => Promise<object>} options.read - resolves like
 *   MspHelper.blackboxLogRead
 * @param {string} options.name
 * @param {(data: DataView, offset: number) => (void|Promise<void>)} options.onChunk - awaited before the next read
 * @param {() => boolean} [options.isCancelled]
 * @param {number} [options.blockSize]
 * @param {number} [options.maxRetries]
 * @param {number} [options.ioRetryDelayMs]
 * @param {number} [options.inProgressDelayMs]
 * @param {number} [options.maxInProgressMs]
 * @returns {Promise<number>} number of bytes received
 * @throws {BlackboxLogError|Error} BlackboxLogError for protocol-level failures; MSP and onChunk errors pass through
 */
export async function readBlackboxLogFile({
    read,
    name,
    onChunk,
    isCancelled = () => false,
    blockSize = BLACKBOX_LOG_BLOCK_SIZE,
    maxRetries = BLACKBOX_LOG_MAX_RETRIES,
    ioRetryDelayMs = IO_RETRY_DELAY_MS,
    inProgressDelayMs = IN_PROGRESS_DELAY_MS,
    maxInProgressMs = MAX_IN_PROGRESS_MS,
}) {
    let offset = 0;
    let failures = 0;
    let inProgressSince = null;

    for (;;) {
        if (isCancelled()) {
            throw new BlackboxLogError("cancelled");
        }

        const reply = await read(name, offset, blockSize);

        if (reply.unsupported) {
            throw new BlackboxLogError("unsupported");
        }

        if (reply.status === BLACKBOX_LOG_STATUS.IN_PROGRESS) {
            inProgressSince ??= Date.now();
            if (Date.now() - inProgressSince > maxInProgressMs) {
                throw new BlackboxLogError("status", reply.status);
            }
            await delay(inProgressDelayMs);
            continue;
        }
        inProgressSince = null;

        const ioError = reply.status === BLACKBOX_LOG_STATUS.IO_ERROR;
        if (ioError || reply.retry) {
            failures++;
            if (failures > maxRetries) {
                throw ioError ? new BlackboxLogError("status", reply.status) : new BlackboxLogError("retries");
            }
            if (ioError) {
                await delay(ioRetryDelayMs);
            }
            continue;
        }

        if (reply.status !== BLACKBOX_LOG_STATUS.OK) {
            throw new BlackboxLogError("status", reply.status);
        }

        failures = 0;
        if (reply.data.byteLength === 0) {
            return offset;
        }

        await onChunk(reply.data, offset);
        offset += reply.data.byteLength;
    }
}

/**
 * Fetch the whole log listing, page by page. While the FC reports IN_PROGRESS (scanning the flash for logs) the same
 * page is requested again.
 *
 * @param {(startIndex: number) => Promise<object>} list - resolves like MspHelper.blackboxLogList
 * @param {object} [options]
 * @param {(reply: object) => void} [options.onReply] - called with every decoded reply (storage flag, scan progress)
 * @param {number} [options.maxRetries]
 * @param {number} [options.ioRetryDelayMs]
 * @param {number} [options.inProgressDelayMs]
 * @param {number} [options.maxInProgressMs]
 * @returns {Promise<{entries: import("../js/msp/blackboxLogProtocol").BlackboxLogEntry[], onFlash: boolean}>}
 * @throws {BlackboxLogError|Error}
 */
export async function listBlackboxLogs(
    list,
    {
        onReply = () => {},
        maxRetries = BLACKBOX_LOG_MAX_RETRIES,
        ioRetryDelayMs = IO_RETRY_DELAY_MS,
        inProgressDelayMs = IN_PROGRESS_DELAY_MS,
        maxInProgressMs = MAX_IN_PROGRESS_MS,
    } = {},
) {
    const entries = [];
    let onFlash = false;
    let startIndex = 0;
    let failures = 0;
    let inProgressSince = null;

    for (let page = 0; page < MAX_LIST_PAGES;) {
        const reply = await list(startIndex);
        if (reply.unsupported) {
            throw new BlackboxLogError("unsupported");
        }
        onReply(reply);

        if (reply.status === BLACKBOX_LOG_STATUS.IN_PROGRESS) {
            inProgressSince ??= Date.now();
            if (Date.now() - inProgressSince > maxInProgressMs) {
                throw new BlackboxLogError("status", reply.status);
            }
            await delay(inProgressDelayMs);
            continue;
        }
        inProgressSince = null;

        if (reply.status === BLACKBOX_LOG_STATUS.IO_ERROR && ++failures <= maxRetries) {
            await delay(ioRetryDelayMs);
            continue;
        }
        if (reply.status !== BLACKBOX_LOG_STATUS.OK) {
            throw new BlackboxLogError("status", reply.status);
        }

        failures = 0;
        page++;
        onFlash = !!reply.onFlash;
        entries.push(...reply.entries);
        if (!reply.more || reply.entries.length === 0) {
            break;
        }
        startIndex += reply.entries.length;
    }

    return { entries, onFlash };
}

function isTransientMspError(error) {
    return (
        error instanceof MspCrcError ||
        error instanceof MspTimeoutError ||
        // queue cleared by a tab switch; a disconnect has reason "disconnected" and ends the erase
        (error instanceof MspCancelledError && error.reason === "cleanup")
    );
}

/**
 * Erase all logs: send start once, then poll until the FC stops reporting IN_PROGRESS. Polling must not pause for
 * long, since the FC abandons an SD card erase when polls stop.
 *
 * @param {(start: boolean) => Promise<object>} erase - resolves like MspHelper.blackboxLogEraseAll
 * @param {object} [options]
 * @param {(progress: number|null) => void} [options.onProgress] - percent, or null when unknown
 * @param {number} [options.pollIntervalMs]
 * @param {number} [options.maxTransientErrors]
 * @returns {Promise<void>} resolves when the FC reports OK
 * @throws {BlackboxLogError|Error}
 */
export async function eraseAllBlackboxLogs(
    erase,
    {
        onProgress = () => {},
        pollIntervalMs = ERASE_POLL_INTERVAL_MS,
        maxTransientErrors = ERASE_MAX_TRANSIENT_ERRORS,
    } = {},
) {
    let reply = await erase(true);
    if (reply.unsupported) {
        throw new BlackboxLogError("unsupported");
    }

    if (reply.status === BLACKBOX_LOG_STATUS.BUSY) {
        // BUSY also means "an erase is running": that is what a re-sent start (MSP retry after a slow reply) gets.
        const poll = await erase(false).catch(() => null);
        if (poll?.status === BLACKBOX_LOG_STATUS.IN_PROGRESS) {
            reply = poll;
        }
    }

    let transientErrors = 0;
    while (reply.status === BLACKBOX_LOG_STATUS.IN_PROGRESS) {
        onProgress(reply.progress ?? null);
        await delay(pollIntervalMs);
        try {
            const next = await erase(false);
            if (next.unsupported) {
                throw new BlackboxLogError("unsupported");
            }
            reply = next;
            transientErrors = 0;
        } catch (error) {
            if (!isTransientMspError(error) || ++transientErrors > maxTransientErrors) {
                throw error;
            }
        }
    }

    if (reply.status !== BLACKBOX_LOG_STATUS.OK) {
        throw new BlackboxLogError("status", reply.status);
    }
    onProgress(100);
}

// Virtual-mode stand-in for the FC: onboard flash with a short scan and a few logs filled with a byte pattern.
const VIRTUAL_LOG_SIZES = [183_476, 1_254_013, 42_123];
const virtualFc = { logs: null, scanPercent: 0, erasePercent: null };

function virtualLogs() {
    virtualFc.logs ??= VIRTUAL_LOG_SIZES.map((size, i) => ({
        name: `LOG${String(i + 1).padStart(5, "0")}.BFL`,
        size,
        fatDate: 0,
        fatTime: 0,
        timestamp: null,
    }));
    return virtualFc.logs;
}

const virtualApi = {
    async list() {
        const header = { startIndex: 0, more: false, onFlash: true };
        if (virtualFc.erasePercent !== null) {
            return { ...header, status: BLACKBOX_LOG_STATUS.BUSY, progress: 0, entries: [] };
        }
        if (virtualFc.scanPercent < 100) {
            await delay(20);
            const progress = virtualFc.scanPercent;
            virtualFc.scanPercent += 50;
            return { ...header, status: BLACKBOX_LOG_STATUS.IN_PROGRESS, progress, entries: [] };
        }
        return { ...header, status: BLACKBOX_LOG_STATUS.OK, progress: 100, entries: virtualLogs() };
    },
    async read(name, offset, blockSize) {
        const log = virtualLogs().find((e) => e.name === name);
        if (!log) {
            return { status: BLACKBOX_LOG_STATUS.NOT_FOUND };
        }
        await delay(5);
        const bytes = new Uint8Array(Math.max(0, Math.min(blockSize, log.size - offset)));
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = (offset + i) & 0xff;
        }
        return { status: BLACKBOX_LOG_STATUS.OK, address: offset, data: new DataView(bytes.buffer), retry: false };
    },
    async close() {
        return { status: BLACKBOX_LOG_STATUS.OK };
    },
    async eraseAll(start) {
        if (start && virtualFc.erasePercent === null) {
            virtualFc.erasePercent = 0;
        }
        if (virtualFc.erasePercent === null) {
            return { status: BLACKBOX_LOG_STATUS.OK, progress: 100 };
        }
        if (virtualFc.erasePercent >= 100) {
            virtualFc.erasePercent = null;
            virtualFc.logs = [];
            return { status: BLACKBOX_LOG_STATUS.OK, progress: 100 };
        }
        const progress = virtualFc.erasePercent;
        virtualFc.erasePercent += 25;
        return { status: BLACKBOX_LOG_STATUS.IN_PROGRESS, progress };
    },
};

const mspApi = {
    list: (startIndex) => mspHelper.blackboxLogList(startIndex),
    read: (name, offset, blockSize) => mspHelper.blackboxLogRead(name, offset, blockSize),
    close: () => mspHelper.blackboxLogClose(),
    eraseAll: (start) => mspHelper.blackboxLogEraseAll(start),
};

const api = () => (CONFIGURATOR.virtualMode ? virtualApi : mspApi);

const STATUS_MESSAGE_KEYS = {
    [BLACKBOX_LOG_STATUS.NOT_READY]: "blackboxLogsStatusNotReady",
    [BLACKBOX_LOG_STATUS.BUSY]: "blackboxLogsStatusBusy",
    [BLACKBOX_LOG_STATUS.IO_ERROR]: "blackboxLogsStatusIoError",
    [BLACKBOX_LOG_STATUS.NOT_FOUND]: "blackboxLogsStatusNotFound",
    [BLACKBOX_LOG_STATUS.BAD_REQUEST]: "blackboxLogsStatusBadRequest",
    [BLACKBOX_LOG_STATUS.IN_PROGRESS]: "blackboxLogsStatusInProgress",
};

/** Map a failure to an i18n message key + params. */
function describeError(error) {
    if (error instanceof BlackboxLogError) {
        switch (error.kind) {
            case "unsupported":
                return { key: "blackboxLogsUnsupported" };
            case "cancelled":
                return { key: "blackboxLogsCancelled" };
            case "retries":
                return { key: "blackboxLogsTooManyRetries" };
            default:
                return STATUS_MESSAGE_KEYS[error.status]
                    ? { key: STATUS_MESSAGE_KEYS[error.status] }
                    : { key: "blackboxLogsStatusUnknown", params: { status: error.status } };
        }
    }
    if (isMspCancelled(error)) {
        return { key: "blackboxLogsInterrupted" };
    }
    return { key: "blackboxLogsError", params: { errorMessage: error?.message ?? String(error) } };
}

function describeEraseError(error) {
    if (error instanceof BlackboxLogError && error.kind === "status") {
        if (error.status === BLACKBOX_LOG_STATUS.IO_ERROR) {
            return { key: "blackboxLogsEraseIoError" };
        }
        if (error.status === BLACKBOX_LOG_STATUS.BUSY) {
            return { key: "blackboxLogsEraseBusy" };
        }
    }
    return describeError(error);
}

// Per-file failures after which the remaining selected files are still worth trying.
function isFileLocalError(error) {
    return (
        error instanceof BlackboxLogError &&
        error.kind === "status" &&
        (error.status === BLACKBOX_LOG_STATUS.NOT_FOUND || error.status === BLACKBOX_LOG_STATUS.IO_ERROR)
    );
}

// Module-level so an erase keeps polling after its tab is left (stopping would make the FC abandon an SD card erase)
// and a re-opened tab shows the running erase instead of starting a second one.
const eraseState = reactive({ running: false, progress: null, storage: null, error: null });
let eraseRun = null;

/**
 * List, download and erase blackbox logs over MSP (MSP2_INDI_BLACKBOX_LOG_*). The FC decides whether they come from
 * the SD card or the onboard flash.
 *
 * `message` is `{ type: "info"|"success"|"warning"|"error", key, params }` for an i18n key, or null.
 * `results` maps file name to `{ state: "queued"|"downloading"|"done"|"mismatch"|"failed"|"cancelled", received }`.
 * `storage` is "sdcard" or "flash" once the FC has answered a LIST request, else null.
 */
export function useBlackboxLogs() {
    const connectionStore = useConnectionStore();

    const files = ref([]);
    const selectedNames = ref([]);
    const listing = ref(false);
    const listed = ref(false);
    const scanProgress = ref(null);
    const downloading = ref(false);
    const unsupported = ref(false);
    const storage = ref(null);
    const message = ref(null);
    const results = ref({});
    const progress = shallowRef(null);
    let cancelRequested = false;
    let disposed = false;

    const erasing = computed(() => eraseState.running);
    const eraseProgress = computed(() => eraseState.progress);
    const busy = computed(() => listing.value || downloading.value || erasing.value);

    const sdcardSupported = computed(() => !!FC.SDCARD?.supported);
    const flashSupported = computed(() => !!FC.DATAFLASH?.supported);
    const storageSupported = computed(() => CONFIGURATOR.virtualMode || sdcardSupported.value || flashSupported.value);
    // The storage the logs (will) come from: as reported by LIST, else the only one the FC has.
    const effectiveStorage = computed(() => {
        if (storage.value) {
            return storage.value;
        }
        if (sdcardSupported.value !== flashSupported.value) {
            return sdcardSupported.value ? "sdcard" : "flash";
        }
        return null;
    });

    // i18n key describing why the logs cannot be read right now; null when ready or unknown.
    const storageIssueKey = computed(() => {
        if (CONFIGURATOR.virtualMode) {
            return null;
        }
        if (!storageSupported.value) {
            return "blackboxLogsNotSupported";
        }
        if (effectiveStorage.value !== "sdcard") {
            return null;
        }
        switch (FC.SDCARD.state) {
            case MSP.SDCARD_STATE_NOT_PRESENT:
                return "sdcardStatusNoCard";
            case MSP.SDCARD_STATE_FATAL:
                return "blackboxLogsCardFatal";
            case MSP.SDCARD_STATE_CARD_INIT:
                return "sdcardStatusStarting";
            case MSP.SDCARD_STATE_FS_INIT:
                return "sdcardStatusFileSystem";
            default:
                return null;
        }
    });

    // {used, total} in bytes for the storage in use, when the FC reported it.
    const storageUsage = computed(() => {
        if (CONFIGURATOR.virtualMode) {
            return null;
        }
        if (effectiveStorage.value === "flash" && FC.DATAFLASH?.totalSize > 0) {
            return { used: FC.DATAFLASH.usedSize, total: FC.DATAFLASH.totalSize };
        }
        if (
            effectiveStorage.value === "sdcard" &&
            FC.SDCARD?.state === MSP.SDCARD_STATE_READY &&
            FC.SDCARD.totalSizeKB > 0
        ) {
            return {
                used: (FC.SDCARD.totalSizeKB - FC.SDCARD.freeSizeKB) * 1024,
                total: FC.SDCARD.totalSizeKB * 1024,
            };
        }
        return null;
    });

    const selectedFiles = computed(() => files.value.filter((f) => selectedNames.value.includes(f.name)));
    const allSelected = computed(() => files.value.length > 0 && selectedFiles.value.length === files.value.length);

    function setSelected(name, value) {
        const others = selectedNames.value.filter((n) => n !== name);
        selectedNames.value = value ? [...others, name] : others;
    }

    function setAllSelected(value) {
        selectedNames.value = value ? files.value.map((f) => f.name) : [];
    }

    async function close() {
        if (unsupported.value || !connectionStore.connectionValid) {
            return;
        }
        try {
            await api().close();
        } catch (error) {
            // Best effort: the FC also releases the storage on its own after a short idle time.
            if (!isMspCancelled(error)) {
                console.warn("Blackbox log close failed", error);
            }
        }
    }

    async function refreshSummary() {
        if (CONFIGURATOR.virtualMode) {
            return;
        }
        try {
            if (sdcardSupported.value || !flashSupported.value) {
                await MSP.promise(MSPCodes.MSP_SDCARD_SUMMARY);
            }
            if (flashSupported.value || !sdcardSupported.value) {
                await MSP.promise(MSPCodes.MSP_DATAFLASH_SUMMARY);
            }
        } catch (error) {
            if (!isMspCancelled(error)) {
                console.warn("Failed to read log storage summary", error);
            }
        }
    }

    async function refresh() {
        if (busy.value) {
            return;
        }
        listing.value = true;
        scanProgress.value = null;
        message.value = null;
        await refreshSummary();
        try {
            const { entries, onFlash } = await listBlackboxLogs(api().list, {
                onReply: (reply) => {
                    if (reply.startIndex !== null && reply.startIndex !== undefined) {
                        storage.value = reply.onFlash ? "flash" : "sdcard";
                    }
                    scanProgress.value =
                        reply.status === BLACKBOX_LOG_STATUS.IN_PROGRESS ? Math.min(reply.progress ?? 0, 100) : null;
                },
            });
            storage.value = onFlash ? "flash" : "sdcard";
            entries.sort((a, b) => a.name.localeCompare(b.name));
            files.value = entries;
            selectedNames.value = selectedNames.value.filter((n) => entries.some((e) => e.name === n));
            results.value = {};
            listed.value = true;
            if (entries.length === 0) {
                message.value = { type: "info", key: "blackboxLogsNoFiles" };
            }
        } catch (error) {
            if (error instanceof BlackboxLogError && error.kind === "unsupported") {
                unsupported.value = true;
            }
            files.value = [];
            selectedNames.value = [];
            if (!isMspCancelled(error)) {
                console.error("Failed to list blackbox logs", error);
            }
            message.value = { type: "error", ...describeError(error) };
        } finally {
            listing.value = false;
            scanProgress.value = null;
        }
        await close();
    }

    /**
     * Ask the user where to save `entries`. One file: a save dialog. Several: one directory when the platform has a
     * directory picker, otherwise a save dialog (or browser download) per file, all up front so the transfer is not
     * interrupted by dialogs.
     *
     * @returns {Promise<{directory: object|null, files: Map<string, object>}>}
     */
    async function pickTargets(entries) {
        if (entries.length > 1 && FileSystem.canPickSaveDirectory()) {
            return { directory: await FileSystem.pickSaveDirectory(), files: new Map() };
        }
        const targets = new Map();
        for (const entry of entries) {
            const ext = entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : ".BFL";
            const file = await FileSystem.pickSaveFile(
                entry.name,
                i18n.getMessage("fileSystemPickerFiles", { typeof: ext.slice(1).toUpperCase() }),
                ext,
            );
            if (!file) {
                const error = new Error("No file selected");
                error.name = "AbortError";
                throw error;
            }
            targets.set(entry.name, file);
        }
        return { directory: null, files: targets };
    }

    function setResult(name, state, received = 0) {
        results.value = { ...results.value, [name]: { state, received } };
    }

    async function downloadOne(entry, target, session) {
        const file = target ?? (await FileSystem.createFileInDirectory(session.directory, entry.name));
        const writable = await FileSystem.openFile(file);
        setResult(entry.name, "downloading");

        let received = 0;
        try {
            received = await readBlackboxLogFile({
                read: api().read,
                name: entry.name,
                isCancelled: () => cancelRequested,
                onChunk: async (data) => {
                    await FileSystem.writeChunck(writable, new Blob([data]));
                    received += data.byteLength;
                    session.doneBytes += data.byteLength;
                    const elapsed = (performance.now() - session.startTime) / 1000;
                    progress.value = {
                        ...progress.value,
                        fileBytes: received,
                        doneBytes: session.doneBytes,
                        rate: elapsed > 0 ? session.doneBytes / elapsed : 0,
                    };
                },
            });
            await FileSystem.closeFile(writable);
        } catch (error) {
            await FileSystem.abortFile(writable, file).catch((abortError) =>
                console.warn("Failed to discard partial file", abortError),
            );
            setResult(
                entry.name,
                error instanceof BlackboxLogError && error.kind === "cancelled" ? "cancelled" : "failed",
                received,
            );
            throw error;
        }

        // A size mismatch keeps the file (it may still be useful) but is reported.
        const ok = received === entry.size;
        setResult(entry.name, ok ? "done" : "mismatch", received);
        return ok;
    }

    async function downloadSelected() {
        const entries = selectedFiles.value;
        if (busy.value || entries.length === 0) {
            return;
        }

        // Set before the (async) save dialogs so a second click cannot start a parallel download.
        downloading.value = true;
        let session;
        try {
            const targets = await pickTargets(entries);
            session = { ...targets, startTime: performance.now(), doneBytes: 0 };
        } catch (error) {
            downloading.value = false;
            if (error?.name !== "AbortError") {
                console.error("Failed to choose a save location", error);
                message.value = {
                    type: "error",
                    key: "blackboxLogsSaveLocationFailed",
                    params: { errorMessage: error?.message },
                };
            }
            return;
        }

        cancelRequested = false;
        message.value = null;
        results.value = Object.fromEntries(entries.map((e) => [e.name, { state: "queued", received: 0 }]));
        const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
        const mismatches = [];
        const failures = [];
        connectionStore.pauseLiveData();

        try {
            for (const [index, entry] of entries.entries()) {
                progress.value = {
                    fileIndex: index,
                    fileCount: entries.length,
                    fileName: entry.name,
                    fileSize: entry.size,
                    fileBytes: 0,
                    doneBytes: session.doneBytes,
                    totalBytes,
                    rate: progress.value?.rate ?? 0,
                };
                try {
                    if (!(await downloadOne(entry, session.files.get(entry.name), session))) {
                        mismatches.push(entry.name);
                    }
                } catch (error) {
                    if (!isFileLocalError(error)) {
                        throw error;
                    }
                    failures.push(entry.name);
                }
            }

            if (mismatches.length || failures.length) {
                message.value = {
                    type: "warning",
                    key: "blackboxLogsDownloadIncomplete",
                    params: { mismatched: mismatches.join(", ") || "-", failed: failures.join(", ") || "-" },
                };
            } else {
                message.value = { type: "success", key: "blackboxLogsDownloadDone", params: { count: entries.length } };
            }
        } catch (error) {
            if (error instanceof BlackboxLogError && error.kind === "unsupported") {
                unsupported.value = true;
            }
            const cancelled = error instanceof BlackboxLogError && error.kind === "cancelled";
            if (!cancelled && !isMspCancelled(error)) {
                console.error("Blackbox log download failed", error);
            }
            for (const entry of entries) {
                if (results.value[entry.name]?.state === "queued") {
                    setResult(entry.name, "cancelled");
                }
            }
            message.value = { type: cancelled ? "info" : "error", ...describeError(error) };
        } finally {
            downloading.value = false;
            progress.value = null;
            connectionStore.resumeLiveData();
            await close();
        }
    }

    /** Erase all logs on the storage in use, then re-list. Keeps polling even if the tab is left meanwhile. */
    async function eraseAll() {
        if (busy.value || eraseRun) {
            return;
        }
        message.value = null;
        Object.assign(eraseState, { running: true, progress: null, storage: effectiveStorage.value, error: null });
        eraseRun = (async () => {
            try {
                await eraseAllBlackboxLogs(api().eraseAll, {
                    onProgress: (value) => {
                        eraseState.progress = value;
                    },
                });
            } catch (error) {
                if (!isMspCancelled(error)) {
                    console.error("Erasing blackbox logs failed", error);
                }
                eraseState.error = error;
            } finally {
                eraseState.running = false;
            }
            if (connectionStore.connectionValid) {
                try {
                    await api().close();
                } catch {
                    // best effort, see close()
                }
            }
        })();
        try {
            await eraseRun;
        } finally {
            eraseRun = null;
        }
        await afterErase();
    }

    async function afterErase() {
        if (disposed) {
            return;
        }
        const error = eraseState.error;
        if (error instanceof BlackboxLogError && error.kind === "unsupported") {
            unsupported.value = true;
        }
        await refresh();
        if (error) {
            message.value = { type: "error", ...describeEraseError(error) };
        } else if (!message.value || message.value.type !== "error") {
            message.value = { type: "success", key: "blackboxLogsEraseDone" };
        }
    }

    /** Initial load for the tab: follow an erase that is still running from an earlier visit, else list the logs. */
    async function load() {
        if (eraseRun) {
            await eraseRun.catch(() => {});
            await afterErase();
        } else if (storageSupported.value) {
            await refresh();
        } else {
            await refreshSummary();
        }
    }

    function cancel() {
        cancelRequested = true;
    }

    /**
     * Call when leaving the tab: stops a running download (which then closes) or releases the storage right away. A
     * running erase keeps polling (and closes when done).
     */
    function dispose() {
        disposed = true;
        if (downloading.value) {
            cancel();
        } else if (!erasing.value) {
            close();
        }
    }

    return {
        files,
        selectedNames,
        selectedFiles,
        allSelected,
        listing,
        listed,
        scanProgress,
        downloading,
        erasing,
        eraseProgress,
        busy,
        unsupported,
        storage: effectiveStorage,
        storageUsage,
        message,
        results,
        progress,
        storageSupported,
        storageIssueKey,
        setSelected,
        setAllSelected,
        refreshSummary,
        refresh,
        downloadSelected,
        eraseAll,
        load,
        cancel,
        dispose,
    };
}
