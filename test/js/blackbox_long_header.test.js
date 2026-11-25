import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { FlightLog } from "../../src/blackbox-viewer/flightlog.js";

// Indiflight writes every main field name into one "H Field I name" header line. That line grew past
// 4096 characters (344 fields, Indiflight bff9b05c), and the parser then dropped it silently, so the
// whole log failed to open with "Log truncated, no data".

function unsignedVB(value) {
    const bytes = [];
    while (value >= 0x80) {
        bytes.push((value & 0x7f) | 0x80);
        value >>>= 7;
    }
    bytes.push(value);
    return bytes;
}

function buildLog(extraFields, { withNames = true } = {}) {
    const names = ["loopIteration", "time"];
    for (let i = 0; i < extraFields; i++) {
        names.push(`indiflightSignal[${i}]`);
    }
    const list = (value) => names.map(() => value).join(",");

    const header = [
        "H Product:Blackbox flight data recorder by Nicholas Sherlock",
        "H Data version:2",
        "H Firmware type:Cleanflight",
        "H Firmware revision:Indiflight 5.0.0 (test) MOCKUP",
        "H I interval:1",
        "H P interval:1/1",
        withNames ? `H Field I name:${names.join(",")}` : null,
        `H Field I signed:${list(0)}`,
        `H Field I predictor:${list(0)}`,
        `H Field I encoding:${list(1)}`,
        `H Field P predictor:${list(0)}`,
        `H Field P encoding:${list(1)}`,
    ]
        .filter((line) => line !== null)
        .join("\n");

    const bytes = [...new TextEncoder().encode(`${header}\n`)];
    for (let iteration = 0; iteration < 3; iteration++) {
        bytes.push("I".charCodeAt(0), ...unsignedVB(iteration), ...unsignedVB(1000 + 1000 * iteration));
        for (let i = 0; i < extraFields; i++) {
            bytes.push(...unsignedVB(i));
        }
    }
    bytes.push("E".charCodeAt(0), 0xff, ...new TextEncoder().encode("End of log\0"));

    return { data: new Uint8Array(bytes), nameLineLength: `Field I name:${names.join(",")}`.length };
}

describe("blackbox header line length", () => {
    beforeEach(() => setActivePinia(createPinia()));

    it("opens a log whose field name header line is longer than 4096 characters", () => {
        const { data, nameLineLength } = buildLog(400);
        expect(nameLineLength).toBeGreaterThan(4096);

        const log = new FlightLog(data);

        expect(log.getLogError(0)).toBe(false);
        expect(log.openLog(0)).toBe(true);
        // FlightLog appends computed fields, so look up the last logged one
        expect(log.getMainFieldIndexByName("indiflightSignal[399]")).toBe(401);
        expect(log.getMinTime()).toBe(1000);
        expect(log.getMaxTime()).toBe(3000);
    });

    it("reports a header error instead of 'Log truncated' when the field names are missing", () => {
        const { data } = buildLog(10, { withNames: false });

        const log = new FlightLog(data);

        expect(String(log.getLogError(0))).toMatch(/missing required definitions for I frames/);
    });
});
