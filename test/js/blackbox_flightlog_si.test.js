import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { FlightLog } from "../../src/blackbox-viewer/flightlog.js";
import { fieldToSI } from "../../src/blackbox-viewer/flightlog_si.js";
import { FIRMWARE_TYPE_INDIFLIGHT } from "../../src/blackbox-viewer/flightlog_fielddefs.js";

// Raw values are encoded with the formulas of loadMainState() in Indiflight's blackbox.c
const UNIT_FLOAT_TO_SIGNED16VB = (127 << 6) - 1;
const DEG = Math.PI / 180;

function fakeLog(sysConfig = {}) {
    const log = Object.create(FlightLog.prototype);
    log.getSysConfig = () => ({
        firmwareType: FIRMWARE_TYPE_INDIFLIGHT,
        firmwareVersion: "4.4.0",
        blackbox_high_resolution: 0,
        gyroScale: DEG * 1e-6, // one count per deg/s
        acc_1G: 2048,
        motorOutput: [158, 2047],
        ...sysConfig,
    });
    return log;
}

const si = (field, raw, sysConfig) => fieldToSI(fakeLog(sysConfig), field)(raw);

describe("fieldToSI", () => {
    beforeEach(() => setActivePinia(createPinia()));

    it("gives gyro rates in rad/s, honouring high resolution", () => {
        expect(si("gyroADC[0]", 180)).toBeCloseTo(Math.PI);
        expect(si("gyroSp[2]", -900, { blackbox_high_resolution: 1 })).toBeCloseTo(-Math.PI / 2);
    });

    it("gives specific force in m/s² from acc_1G", () => {
        expect(si("accSmooth[2]", -2048)).toBeCloseTo(-9.80665);
    });

    it("normalizes sticks and motors", () => {
        expect(si("rcCommand[0]", 250)).toBeCloseTo(0.5);
        expect(si("rcCommand[3]", 1500)).toBeCloseTo(0.5);
        expect(si("rcCommand[1]", -5000, { blackbox_high_resolution: 1 })).toBeCloseTo(-1);
        expect(si("motor[0]", 158 + 0.25 * (2047 - 158))).toBeCloseTo(0.25);
    });

    it("converts Indiflight angular fields to radians", () => {
        expect(si("alpha[1]", 18)).toBeCloseTo(180 * DEG); // deca-degrees/s²
        expect(si("servo_feedback[0]", 4500)).toBeCloseTo(45 * DEG); // centi-degrees
        expect(si("ekf_gyro_b[0]", 90000)).toBeCloseTo(90 * DEG); // milli-deg/s
    });

    it("scales Indiflight unit floats, positions and velocities", () => {
        expect(si("quat[0]", Math.round(0.5 * UNIT_FLOAT_TO_SIGNED16VB))).toBeCloseTo(0.5, 3);
        expect(si("u_state[3]", -UNIT_FLOAT_TO_SIGNED16VB)).toBeCloseTo(-1);
        expect(si("pos[2]", -1500)).toBeCloseTo(-1.5); // mm
        expect(si("velSp[1]", 250)).toBeCloseTo(2.5); // cm/s
        expect(si("spfSp[2]", -981)).toBeCloseTo(-9.81); // cm/s²
        expect(si("omega[3]", 1234)).toBe(1234); // rad/s
    });

    it("passes unknown fields through", () => {
        expect(si("latest_key_pressed", 3)).toBe(3);
        expect(si("debug[0]", -17)).toBe(-17);
    });
});
