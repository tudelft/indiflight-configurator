import CONFIGURATOR from "../data_storage";
import { serial } from "../serial";
import { reinitializeConnection } from "../serial_backend";
import { isPlausibleCliDump } from "../utils/AutoBackup";

const ENTRY_TIMEOUT_MS = 5000;
const DUMP_TIMEOUT_MS = 30000;
// A prompt-shaped line can also end a chunk in the middle of a dump; the real prompt is followed by silence.
const QUIET_MS = 300;
const POLL_MS = 50;
const PROMPT = /(?:^|\n)# ?$/;

const send = (text) => serial.send(new TextEncoder().encode(text).buffer);

/**
 * Reads the configuration of the connected flight controller through the classic `#` CLI.
 *
 * Indiflight has no MSP-framed CLI, and leaving the CLI reboots the FC: the connection drops and the
 * configurator reconnects, as after a Save and reboot. Nothing else may use the link meanwhile.
 *
 * @param {string} [command]  CLI command to run, `dump all` by default
 * @returns {Promise<string>} the command's output, one `\n` per line
 */
export async function readCliDump(command = "dump all") {
    if (CONFIGURATOR.virtualMode) {
        throw new Error("The virtual flight controller has no CLI");
    }

    let received = "";
    let lastArrival = Date.now();
    const onReceive = (event) => {
        for (const byte of new Uint8Array(event.detail.data)) {
            received += String.fromCharCode(byte);
        }
        lastArrival = Date.now();
    };

    async function untilPrompt(timeoutMs, what) {
        const deadline = Date.now() + timeoutMs;
        while (!(PROMPT.test(received) && Date.now() - lastArrival >= QUIET_MS)) {
            if (Date.now() >= deadline) {
                throw new Error(`The flight controller did not finish ${what}`);
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
    }

    serial.addEventListener("receive", onReceive);
    // With the CLI flag set, serial_backend hands incoming bytes to the CLI tab, which is not open, instead of the
    // MSP parser that would choke on text.
    CONFIGURATOR.cliActive = true;
    let inCli = false;
    try {
        await send("#");
        await untilPrompt(ENTRY_TIMEOUT_MS, "entering the CLI");
        inCli = true;

        received = "";
        await send(`${command}\n`);
        await untilPrompt(DUMP_TIMEOUT_MS, `"${command}"`);

        let lines = received.split(/\r?\n/);
        if (lines[0].includes(command)) {
            lines = lines.slice(1);
        }
        if (/^# ?$/.test(lines.at(-1))) {
            lines.pop();
        }
        while (lines.at(-1) === "") {
            lines.pop();
        }
        const dump = lines.join("\n");
        if (!isPlausibleCliDump(dump)) {
            throw new Error("The flight controller sent no readable configuration");
        }
        return dump;
    } finally {
        serial.removeEventListener("receive", onReceive);
        if (inCli) {
            await send("exit\n");
        }
        CONFIGURATOR.cliActive = false;
        if (inCli) {
            reinitializeConnection();
        }
    }
}
