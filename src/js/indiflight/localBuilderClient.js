/**
 * HTTP client for the local Indiflight build daemon (`python3 start.py` in the firmware repo).
 */

export const DEFAULT_BUILDER_URL = "http://127.0.0.1:8742";

export class BuilderError extends Error {
    /**
     * @param {string} message
     * @param {number} status  HTTP status, 0 for network errors
     */
    constructor(message, status) {
        super(message);
        this.name = "BuilderError";
        this.status = status;
    }
}

export class LocalBuilderClient {
    /**
     * @param {string} baseUrl
     * @param {string} token  empty when the daemon runs with --no-token
     */
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        this.token = token.trim();
    }

    /**
     * @param {string} path
     * @param {RequestInit} [init]
     * @returns {Promise<Response>}
     */
    async request(path, init = {}) {
        const headers = new Headers(init.headers);
        if (this.token) {
            headers.set("Authorization", `Bearer ${this.token}`);
        }
        let response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
        } catch (error) {
            throw new BuilderError(`Cannot reach build daemon at ${this.baseUrl} (${error.message})`, 0);
        }
        if (!response.ok) {
            let message = `${response.status} ${response.statusText}`;
            try {
                message = (await response.json()).error ?? message;
            } catch {
                // non-JSON error body: keep the status line
            }
            throw new BuilderError(message, response.status);
        }
        return response;
    }

    async json(path, init) {
        return (await this.request(path, init)).json();
    }

    ping() {
        return this.json("/api/ping");
    }

    info() {
        return this.json("/api/info");
    }

    /** @returns {Promise<{boards: string[], profiles: string[]}>} */
    configs() {
        return this.json("/api/configs");
    }

    /**
     * @param {"boards" | "profiles"} kind
     * @param {string} name
     */
    async configFile(kind, name) {
        return (await this.request(`/api/configs/${kind}/${encodeURIComponent(name)}`)).text();
    }

    /**
     * @param {{board: string, profile: string | null, boardText?: string, profileText?: string,
     *          debug?: string | null, extraFlags?: string, clean?: boolean}} request
     * @returns {Promise<{id: string}>}
     */
    startBuild(request) {
        return this.json("/api/builds", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
        });
    }

    job(id) {
        return this.json(`/api/builds/${encodeURIComponent(id)}`);
    }

    cancel(id) {
        return this.json(`/api/builds/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    }

    /** @returns {Promise<string>} */
    async artifactText(id, name) {
        return (
            await this.request(`/api/builds/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`)
        ).text();
    }

    /**
     * Subscribe to a job's server-sent events. EventSource cannot send headers, hence the query token.
     * @param {string} id
     * @param {{log?: Function, progress?: Function, state?: Function, end?: Function, error?: Function}} handlers
     * @returns {() => void}  closes the stream
     */
    subscribe(id, handlers) {
        const query = this.token ? `?token=${encodeURIComponent(this.token)}` : "";
        const source = new EventSource(`${this.baseUrl}/api/builds/${encodeURIComponent(id)}/events${query}`);
        for (const type of ["log", "progress", "state"]) {
            source.addEventListener(type, (event) => handlers[type]?.(JSON.parse(event.data)));
        }
        source.addEventListener("end", (event) => {
            source.close();
            handlers.end?.(JSON.parse(event.data));
        });
        // No auto-reconnect: the daemon replays the whole log on connect, which would duplicate lines
        source.onerror = () => {
            source.close();
            handlers.error?.(new BuilderError("Lost connection to build log stream", 0));
        };
        return () => source.close();
    }
}
