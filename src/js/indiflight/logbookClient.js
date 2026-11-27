/**
 * Client for the log database web UI (tudelft/paparazzi_log_parsing, `webui/`), upload side only.
 * Authenticates with an API key from the account page (`logdb_...`, scope `logs:upload`).
 * Routes: POST /api/logs/check, POST /api/upload (multipart), GET /api/ingest/<id>, GET /api/status,
 * POST /api/attachments (raw body, metadata in the X-Attachment-Metadata header), GET /api/tags (needs scope `read`).
 */

export class LogbookError extends Error {
    /**
     * @param {string} message
     * @param {number} status  HTTP status, 0 for network errors
     */
    constructor(message, status) {
        super(message);
        this.name = "LogbookError";
        this.status = status;
    }
}

/** Origin of what the user typed ("logs.example.org" is accepted as https), without trailing slash. */
export function normalizeServerUrl(input) {
    const trimmed = (input ?? "").trim().replace(/\/+$/, "");
    if (!trimmed) {
        return "";
    }
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// The server's limits (webui/tags.py): a name has 1 to 40 characters and no commas, an entry at most 20 tags.
export const TAG_NAME_MAX = 40;
export const TAGS_PER_ENTRY_MAX = 20;

/**
 * Tag names from what the user typed: split at commas, spaces collapsed, cut to the server's length, and without
 * repeats (the server matches names without case).
 *
 * @param {string[]} values
 * @returns {string[]}
 */
export function cleanTags(values) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        for (const part of String(value ?? "").split(",")) {
            const name = part.split(/\s+/).filter(Boolean).join(" ").slice(0, TAG_NAME_MAX).trim();
            if (name && !seen.has(name.toLowerCase())) {
                seen.add(name.toLowerCase());
                out.push(name);
            }
        }
    }
    return out;
}

/** @param {Blob|Uint8Array} data */
export async function sha256Hex(data) {
    const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** @typedef {{name: string, data: Blob, description?: string}} LogAttachment */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class LogbookClient {
    constructor(baseUrl, token) {
        this.baseUrl = normalizeServerUrl(baseUrl);
        this.token = (token ?? "").trim();
        // How long to wait for the server to store an upload, and how often to ask
        this.ingestTimeoutMs = 120_000;
        this.ingestPollMs = 1000;
    }

    async request(path, init = {}) {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${this.token}`);
        let response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
        } catch (error) {
            // A browser reports a missing CORS header the same way as an unreachable host.
            throw new LogbookError(`Cannot reach ${this.baseUrl} (${error.message})`, 0);
        }
        if (!response.ok) {
            let message = `${response.status} ${response.statusText}`;
            try {
                message = (await response.json()).error ?? message;
            } catch {
                // non-JSON error body: keep the status line
            }
            throw new LogbookError(message, response.status);
        }
        return response.json();
    }

    /** Checks the server and the key. */
    status() {
        return this.request("/api/status");
    }

    /**
     * Every tag on the server.
     *
     * @returns {Promise<{id: number, name: string, hidden: boolean, entries: number}[]>}
     */
    async tags() {
        return (await this.request("/api/tags")).tags ?? [];
    }

    /**
     * @param {string} digest  SHA-256 hex of the log
     * @returns {Promise<{has_log: boolean, mine: boolean}|undefined>} undefined when the server does not have it
     */
    async known(digest) {
        const reply = await this.request("/api/logs/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sha256: [digest] }),
        });
        return reply.known?.[digest];
    }

    /**
     * The id of the log an upload became. The server stores the file in the background, so this polls its receipt.
     *
     * @param {number} ingestId
     * @returns {Promise<number>}
     */
    async waitForLogId(ingestId) {
        const deadline = Date.now() + this.ingestTimeoutMs;
        for (;;) {
            const receipt = await this.request(`/api/ingest/${ingestId}`);
            if (Number.isInteger(receipt.log_id)) {
                return receipt.log_id;
            }
            if (receipt.status === "rejected" || receipt.status === "error") {
                throw new LogbookError(receipt.error ?? "The server could not store the log", 0);
            }
            if (Date.now() >= deadline) {
                throw new LogbookError("The server is still processing the upload", 0);
            }
            await sleep(this.ingestPollMs);
        }
    }

    /**
     * Attach a file to a log. The server links an identical file again instead of storing it twice, and a file with
     * the same name but other content replaces the earlier version.
     *
     * @param {number} logId
     * @param {LogAttachment} file
     */
    attach(logId, { name, data, description }) {
        const metadata = { filename: name, description: description ?? "", targets: [{ kind: "log", id: logId }] };
        return this.request("/api/attachments", {
            method: "POST",
            headers: {
                "Content-Type": "application/octet-stream",
                "X-Attachment-Metadata": encodeURIComponent(JSON.stringify(metadata)),
            },
            body: data,
        });
    }

    /**
     * Upload one log unless this user already has it on the server, then attach files to it.
     *
     * @param {string} name   stored name; a leading folder named after a fleet aircraft links the log to it
     * @param {Blob|Uint8Array} bytes
     * @param {LogAttachment[]} [attachments]  files to attach to the log, also when the server already had it
     * @param {string[]} [tags]  tag names for the log's flights; new names create tags
     * @returns {Promise<{status: "accepted"|"skipped", ingestId?: number, logId?: number, attachError?: string}>}
     *   attachError: the log is on the server, but attaching the files failed
     */
    async upload(name, bytes, attachments = [], tags = []) {
        const blob = new Blob([bytes], { type: "application/octet-stream" });
        const known = await this.known(await sha256Hex(blob));
        let result;
        // With tags the log is sent again: the server then adds the tags to the flights it already has.
        if (known?.mine && known.has_log && !tags.length) {
            result = { status: "skipped", logId: known.id };
        } else {
            const form = new FormData();
            form.append("names", name);
            for (const tag of tags) {
                form.append("tags", tag);
            }
            form.append("files", blob, name.split("/").pop());
            const reply = await this.request("/api/upload", { method: "POST", body: form });
            const receipt = reply.results?.[0];
            if (receipt?.status !== "accepted" || !Number.isInteger(receipt.ingest_id)) {
                throw new LogbookError(receipt?.reason ?? "The server did not accept the upload", 0);
            }
            result = { status: "accepted", ingestId: receipt.ingest_id };
        }
        if (attachments.length) {
            try {
                result.logId ??= await this.waitForLogId(result.ingestId);
                for (const file of attachments) {
                    await this.attach(result.logId, file);
                }
            } catch (error) {
                result.attachError = error.message;
            }
        }
        return result;
    }
}
