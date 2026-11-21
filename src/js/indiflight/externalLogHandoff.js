/**
 * Lets another website open a log in this app: it opens `<app>/?openlog=plotter` (or `viewer`) with `window.open`,
 * waits for `{ type: "indiflight-ready" }` from that window, and replies with
 * `{ type: "indiflight-log", name, data: ArrayBuffer }`.
 *
 * The bytes travel through the user's browser, so the log may come from a host this app cannot reach (e.g. one behind
 * a VPN), and that host needs no CORS headers. Only messages from the opening window are accepted. Its origin is not
 * checked: any site may hand over a log, so the log and its name are untrusted (see the sanitising in stores/log.js).
 */

export const OPEN_LOG_PARAM = "openlog";
export const READY_MESSAGE = "indiflight-ready";
export const LOG_MESSAGE = "indiflight-log";
const TARGETS = ["plotter", "viewer"];

/** @returns {"plotter"|"viewer"|null} */
export function requestedTarget(href) {
    const target = new URL(href).searchParams.get(OPEN_LOG_PARAM);
    return TARGETS.includes(target) ? target : null;
}

function toBytes(data) {
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    return null;
}

// The name is only shown, but keep it a plain, short file name.
function safeName(name) {
    const base = typeof name === "string" ? name.split(/[\\/]/).pop().trim() : "";
    return base.slice(0, 200) || "log.bfl";
}

/**
 * Start listening when the URL asks for it and the page has an opener. Removes the parameter from the URL so a reload
 * does not wait again.
 *
 * @param {object} options
 * @param {Window} [options.win]
 * @param {(target: "plotter"|"viewer", bytes: Uint8Array, name: string) => void} options.open
 * @returns {(() => void)|null} stop function, or null when no handoff was requested
 */
export function startExternalLogHandoff({ win = window, open }) {
    const target = requestedTarget(win.location.href);
    const opener = win.opener;
    if (!target || !opener) {
        return null;
    }

    const url = new URL(win.location.href);
    url.searchParams.delete(OPEN_LOG_PARAM);
    win.history.replaceState(win.history.state, "", url);

    function onMessage(event) {
        if (event.source !== opener || event.data?.type !== LOG_MESSAGE) {
            return;
        }
        const bytes = toBytes(event.data.data);
        if (!bytes) {
            return;
        }
        stop();
        // Done with the opener. Dropping it keeps anything later running in this page from navigating that tab
        // (e.g. to a phishing page).
        win.opener = null;
        open(target, bytes, safeName(event.data.name));
    }
    function stop() {
        win.removeEventListener("message", onMessage);
    }

    win.addEventListener("message", onMessage);
    // "*": the opener's origin is unknown, and this message carries nothing private.
    opener.postMessage({ type: READY_MESSAGE }, "*");
    return stop;
}
