import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fakeSerial, reinitializeConnection } = vi.hoisted(() => {
    const target = new EventTarget();
    target.send = vi.fn();
    return { fakeSerial: target, reinitializeConnection: vi.fn() };
});
vi.mock("../../src/js/serial", () => ({ serial: fakeSerial }));
vi.mock("../../src/js/serial_backend", () => ({ reinitializeConnection }));

import CONFIGURATOR from "../../src/js/data_storage";
import { readCliDump } from "../../src/js/indiflight/cliDump";

const reply = (text) =>
    fakeSerial.dispatchEvent(new CustomEvent("receive", { detail: { data: new TextEncoder().encode(text).buffer } }));

const DUMP = "# version\r\n# Indiflight / MATEKH743\r\n\r\nset gyro_lpf1_static_hz = 0\r\n";

/** The FC side of the CLI: answers `#`, `dump all` and `exit` the way the firmware does. */
function fcAnswers({ dump = DUMP, silentOnEntry = false } = {}) {
    fakeSerial.send.mockImplementation(async (buffer) => {
        const text = new TextDecoder().decode(buffer);
        if (text === "#" && !silentOnEntry) {
            reply("\r\nEntering CLI Mode, type 'exit' to return, or 'help'\r\n\r\n# ");
        } else if (text === "dump all\n") {
            reply("dump all\r\n");
            reply(dump);
            reply("\r\n# ");
        }
    });
}

describe("readCliDump", () => {
    beforeEach(() => {
        CONFIGURATOR.virtualMode = false;
        CONFIGURATOR.cliActive = false;
        fakeSerial.send.mockReset();
        reinitializeConnection.mockReset();
    });
    afterEach(() => vi.restoreAllMocks());

    it("enters the CLI, returns the dump without echo and prompt, then leaves and reconnects", async () => {
        fcAnswers();
        const text = await readCliDump();

        expect(text).toBe("# version\n# Indiflight / MATEKH743\n\nset gyro_lpf1_static_hz = 0");
        expect(fakeSerial.send.mock.calls.map(([b]) => new TextDecoder().decode(b))).toEqual([
            "#",
            "dump all\n",
            "exit\n",
        ]);
        expect(reinitializeConnection).toHaveBeenCalledTimes(1);
        expect(CONFIGURATOR.cliActive).toBe(false);
    });

    it("is not fooled by a comment line that looks like a prompt in the middle of a dump", async () => {
        fcAnswers({ dump: "# version\r\n# \r\nset a = 1\r\n" });
        expect(await readCliDump()).toBe("# version\n# \nset a = 1");
    });

    it("does not reboot a flight controller that never entered the CLI", async () => {
        fcAnswers({ silentOnEntry: true });
        vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
        const result = readCliDump();
        const failure = expect(result).rejects.toThrow("entering the CLI");
        await vi.advanceTimersByTimeAsync(6000);
        await failure;
        vi.useRealTimers();

        expect(fakeSerial.send).toHaveBeenCalledTimes(1);
        expect(reinitializeConnection).not.toHaveBeenCalled();
        expect(CONFIGURATOR.cliActive).toBe(false);
    });

    it("still leaves the CLI when the output is not a configuration", async () => {
        fcAnswers({ dump: "\u0001\u0002 garbage\r\n" });
        await expect(readCliDump()).rejects.toThrow("no readable configuration");
        expect(fakeSerial.send.mock.calls.at(-1)[0]).toEqual(new TextEncoder().encode("exit\n").buffer);
        expect(reinitializeConnection).toHaveBeenCalledTimes(1);
    });

    it("refuses the virtual flight controller", async () => {
        CONFIGURATOR.virtualMode = true;
        await expect(readCliDump()).rejects.toThrow("no CLI");
        expect(fakeSerial.send).not.toHaveBeenCalled();
    });
});
