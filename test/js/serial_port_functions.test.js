import { describe, expect, it } from "vitest";
import { getSerialPortFunctions } from "../../src/js/msp/serialPortFunctions";

describe("serial port function bits", () => {
    it("uses the 4.4 fork bits before API 1.48", () => {
        const f = getSerialPortFunctions("1.45.0");
        expect(f.TELEMETRY_PI).toBe(18);
        expect(f.HIL).toBe(19);
        expect(f.ACTUATORS_T4).toBe(20);
        expect(f.TELEMETRY_UROS).toBe(21);
        expect(f.SERVOS_FEETECH).toBe(22);
    });

    it("uses the Betaflight 2026 bits from API 1.48", () => {
        const f = getSerialPortFunctions("1.48.0");
        expect(f.GIMBAL).toBe(18);
        expect(f.LIDAR_NL).toBe(19);
        expect(f.OSD_CUSTOM_TEXT).toBe(20);
        expect(f.SERVOS_FEETECH).toBe(22);
        expect(f.TELEMETRY_PI).toBe(23);
        expect(f.ACTUATORS_T4).toBe(24);
        expect(f.HIL).toBe(25);
        expect(f.TELEMETRY_UROS).toBeUndefined();
    });

    it("has no duplicate bits", () => {
        for (const v of ["1.45.0", "1.48.0"]) {
            const bits = Object.values(getSerialPortFunctions(v));
            expect(new Set(bits).size).toBe(bits.length);
        }
    });

    it("falls back to the fork table without an API version", () => {
        expect(getSerialPortFunctions(undefined).TELEMETRY_PI).toBe(18);
    });
});
