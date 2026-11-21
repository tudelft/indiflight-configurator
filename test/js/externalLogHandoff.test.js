import { describe, expect, it, vi } from "vitest";
import {
    LOG_MESSAGE,
    READY_MESSAGE,
    requestedTarget,
    startExternalLogHandoff,
} from "../../src/js/indiflight/externalLogHandoff";

function fakeWindow(href, { opener = { postMessage: vi.fn() } } = {}) {
    const win = new EventTarget();
    win.location = { href };
    win.opener = opener;
    win.history = {
        state: null,
        replaceState: vi.fn((_state, _title, url) => {
            win.location.href = String(url);
        }),
    };
    return win;
}

function send(win, source, data) {
    win.dispatchEvent(Object.assign(new Event("message"), { source, data }));
}

describe("requestedTarget", () => {
    it.each([
        ["https://app.indiflight.org/?openlog=plotter", "plotter"],
        ["https://app.indiflight.org/?openlog=viewer", "viewer"],
        ["https://app.indiflight.org/?openlog=cli", null],
        ["https://app.indiflight.org/?openlog=", null],
        ["https://app.indiflight.org/", null],
        ["https://app.indiflight.org/#openlog=plotter", null],
    ])("%s -> %s", (href, expected) => {
        expect(requestedTarget(href)).toBe(expected);
    });
});

describe("startExternalLogHandoff", () => {
    it("does nothing without the parameter", () => {
        const win = fakeWindow("https://app.indiflight.org/");
        const open = vi.fn();
        expect(startExternalLogHandoff({ win, open })).toBeNull();
        expect(win.opener.postMessage).not.toHaveBeenCalled();
        expect(win.history.replaceState).not.toHaveBeenCalled();
    });

    it("does nothing without an opener (link opened with noopener, or typed in)", () => {
        const win = fakeWindow("https://app.indiflight.org/?openlog=plotter", { opener: null });
        const open = vi.fn();
        expect(startExternalLogHandoff({ win, open })).toBeNull();
        send(win, null, { type: LOG_MESSAGE, data: new ArrayBuffer(4) });
        expect(open).not.toHaveBeenCalled();
    });

    it("tells the opener it is ready and drops only its own parameter from the URL", () => {
        const win = fakeWindow("https://app.indiflight.org/sub/?lang=de&openlog=viewer#x");
        startExternalLogHandoff({ win, open: vi.fn() });
        expect(win.opener.postMessage).toHaveBeenCalledWith({ type: READY_MESSAGE }, "*");
        expect(win.location.href).toBe("https://app.indiflight.org/sub/?lang=de#x");
    });

    it("opens the log sent by the opener, with the requested target", () => {
        const win = fakeWindow("https://app.indiflight.org/?openlog=viewer");
        const open = vi.fn();
        startExternalLogHandoff({ win, open });
        const data = new Uint8Array([1, 2, 3, 4]).buffer;
        send(win, win.opener, { type: LOG_MESSAGE, name: "LOG00007.BFL", data });

        expect(open).toHaveBeenCalledTimes(1);
        const [target, bytes, name] = open.mock.calls[0];
        expect(target).toBe("viewer");
        expect(name).toBe("LOG00007.BFL");
        expect([...bytes]).toEqual([1, 2, 3, 4]);
    });

    it("takes a typed-array view without the bytes outside it", () => {
        const win = fakeWindow("https://app.indiflight.org/?openlog=plotter");
        const open = vi.fn();
        startExternalLogHandoff({ win, open });
        const view = new Uint8Array([9, 9, 1, 2, 3, 9]).subarray(2, 5);
        send(win, win.opener, { type: LOG_MESSAGE, name: "a.bfl", data: view });
        expect([...open.mock.calls[0][1]]).toEqual([1, 2, 3]);
    });

    it("ignores messages from other windows, of other types, or without binary data", () => {
        const win = fakeWindow("https://app.indiflight.org/?openlog=plotter");
        const open = vi.fn();
        startExternalLogHandoff({ win, open });
        const data = new ArrayBuffer(8);

        send(win, { postMessage() {} }, { type: LOG_MESSAGE, name: "x", data });
        send(win, null, { type: LOG_MESSAGE, name: "x", data });
        send(win, win.opener, { type: READY_MESSAGE, data });
        send(win, win.opener, { type: LOG_MESSAGE, name: "x", data: "not bytes" });
        send(win, win.opener, { type: LOG_MESSAGE, name: "x", data: [1, 2, 3] });
        send(win, win.opener, null);
        send(win, win.opener, "indiflight-log");
        expect(open).not.toHaveBeenCalled();

        // still listening after the rejected ones
        send(win, win.opener, { type: LOG_MESSAGE, name: "x", data });
        expect(open).toHaveBeenCalledTimes(1);
    });

    it("drops the opener once a log is accepted, not before", () => {
        const win = fakeWindow("https://app.indiflight.org/?openlog=plotter");
        const opener = win.opener;
        startExternalLogHandoff({ win, open: vi.fn() });
        send(win, opener, { type: LOG_MESSAGE, name: "x", data: "not bytes" });
        expect(win.opener).toBe(opener);
        send(win, opener, { type: LOG_MESSAGE, name: "x", data: new ArrayBuffer(1) });
        expect(win.opener).toBeNull();
    });

    it("opens only the first log", () => {
        const win = fakeWindow("https://app.indiflight.org/?openlog=plotter");
        const open = vi.fn();
        startExternalLogHandoff({ win, open });
        send(win, win.opener, { type: LOG_MESSAGE, name: "a", data: new ArrayBuffer(1) });
        send(win, win.opener, { type: LOG_MESSAGE, name: "b", data: new ArrayBuffer(1) });
        expect(open).toHaveBeenCalledTimes(1);
        expect(open.mock.calls[0][2]).toBe("a");
    });

    it("stops listening when stopped", () => {
        const win = fakeWindow("https://app.indiflight.org/?openlog=plotter");
        const open = vi.fn();
        const stop = startExternalLogHandoff({ win, open });
        stop();
        send(win, win.opener, { type: LOG_MESSAGE, name: "a", data: new ArrayBuffer(1) });
        expect(open).not.toHaveBeenCalled();
    });

    it.each([
        ["C:\\logs\\LOG00001.BFL", "LOG00001.BFL"],
        ["/srv/flights/2026/LOG00002.BFL", "LOG00002.BFL"],
        ["dir/", "log.bfl"],
        ["", "log.bfl"],
        [undefined, "log.bfl"],
        [{ toString: () => "evil" }, "log.bfl"],
        ["x".repeat(500), "x".repeat(200)],
    ])("shows name %j as %j", (name, expected) => {
        const win = fakeWindow("https://app.indiflight.org/?openlog=plotter");
        const open = vi.fn();
        startExternalLogHandoff({ win, open });
        send(win, win.opener, { type: LOG_MESSAGE, name, data: new ArrayBuffer(1) });
        expect(open.mock.calls[0][2]).toBe(expected);
    });
});
