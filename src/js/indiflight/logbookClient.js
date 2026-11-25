/**
 * Client for the log database web UI (tudelft/paparazzi_log_parsing, `webui/`), upload side only.
 * Authenticates with an API key from the account page (`logdb_...`, scope `logs:upload`).
 * Routes: POST /api/logs/check, POST /api/upload (multipart), GET /api/ingest/<id>, GET /api/status.
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

/** @param {Blob|Uint8Array} data */
export async function sha256Hex(data) {
    const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class LogbookClient {
    constructor(baseUrl, token) {
        this.baseUrl = normalizeServerUrl(baseUrl);
        this.token = (token ?? "").trim();
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
     * Upload one log unless this user already has it on the server.
     *
     * @param {string} name   stored name; a leading folder named after a fleet aircraft links the log to it
     * @param {Blob|Uint8Array} bytes
     * @returns {Promise<{status: "accepted"|"skipped", ingestId?: number}>}
     */
    async upload(name, bytes) {
        const blob = new Blob([bytes], { type: "application/octet-stream" });
        const known = await this.known(await sha256Hex(blob));
        if (known?.mine && known.has_log) {
            return { status: "skipped" };
        }
        const form = new FormData();
        form.append("names", name);
        form.append("files", blob, name.split("/").pop());
        const reply = await this.request("/api/upload", { method: "POST", body: form });
        const receipt = reply.results?.[0];
        if (receipt?.status !== "accepted" || !Number.isInteger(receipt.ingest_id)) {
            throw new LogbookError(receipt?.reason ?? "The server did not accept the upload", 0);
        }
        return { status: "accepted", ingestId: receipt.ingest_id };
    }
}
