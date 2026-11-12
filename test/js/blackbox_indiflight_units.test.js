import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "../../src/blackbox-viewer/stores/settings.js";
import { FlightLogFieldPresenter } from "../../src/blackbox-viewer/flightlog_fields_presenter.js";
import { FlightLog } from "../../src/blackbox-viewer/flightlog.js";
import { FIRMWARE_TYPE_BETAFLIGHT, FIRMWARE_TYPE_INDIFLIGHT } from "../../src/blackbox-viewer/flightlog_fielddefs.js";

// Raw values are encoded here with the formulas of loadMainState() in Indiflight's blackbox.c, so the expectations
// come from the firmware, not from the presenter.
const UNIT_FLOAT_TO_SIGNED16VB = (127 << 6) - 1;
const UNIT_FLOAT_TO_UNSIGNED16VB = (127 << 7) - 1;

function fakeLog(sysConfig) {
    return {
        getSysConfig: () => ({ firmwareType: FIRMWARE_TYPE_INDIFLIGHT, blackbox_high_resolution: 0, ...sysConfig }),
    };
}

const present = (field, raw, sysConfig = {}) =>
    FlightLogFieldPresenter.decodeFieldToFriendly(fakeLog(sysConfig), field, raw);

describe("Indiflight field units", () => {
    beforeEach(() => setActivePinia(createPinia()));

    it("setpoint[0..2] is deg/s times the high-resolution scale", () => {
        expect(present("setpoint[1]", Math.round(-123.4 * 10), { blackbox_high_resolution: 1 })).toBe("-123.4 °/s");
        expect(present("setpoint[0]", 250)).toBe("250 °/s");
    });

    it("setpoint[3] is mixer throttle times 1000", () => {
        expect(present("setpoint[3]", Math.round(0.425 * 1000))).toBe("42.5 %");
    });

    it("surfaceRaw is cm", () => {
        expect(present("surfaceRaw", 153)).toMatch(/^1\.53 ?m/);
    });

    it("pitot fields are centi-Pa, centi-K and cm/s", () => {
        expect(present("pitot_pressure", Math.round(101325.37 * 100))).toBe("101325.37 Pa");
        expect(present("pitot_pressureZero", Math.round(-1.5 * 100))).toBe("-1.50 Pa");
        expect(present("pitot_temperature", Math.round(293.15 * 100))).toBe("293.15 K");
        expect(present("pitot_airSpeed", 1234)).toBe("12.34 m/s");
    });

    it("servo_feedback is centidegrees", () => {
        expect(present("servo_feedback[2]", Math.round(100 * 45.5))).toBe("45.50 °");
    });

    it("unit-float fields divide by UNIT_FLOAT_TO_SIGNED16VB", () => {
        for (const field of ["hoverAttitude[0]", "quatSpPreFf[3]", "d[7]", "rpmCmd_f[0]"]) {
            expect(present(field, Math.round(-0.5 * UNIT_FLOAT_TO_SIGNED16VB))).toBe("-0.500");
        }
    });

    it("learner_gains is gain times 10", () => {
        expect(present("learner_gains[2]", Math.round(10 * 3.7))).toBe("3.7");
    });

    it("rls lambda and error variance use their own scales", () => {
        expect(present("fx_q_rls_lambda", Math.round(0.995 * UNIT_FLOAT_TO_UNSIGNED16VB))).toBe("0.9950");
        expect(Number(present("motor_3_rls_e_var", Math.round(0.001 * 0xffff * 10)))).toBeCloseTo(10, 1);
    });

    it("leaves unrelated names alone", () => {
        expect(present("dummy_rls_x[0]", 1234)).toBe("1234");
        expect(present("latest_key_pressed", 3)).toBe("3");
    });
});

describe("Indiflight motor percentage", () => {
    const motorPct = (sysConfig, raw) => {
        const log = Object.create(FlightLog.prototype);
        log.getSysConfig = () => ({ fast_pwm_protocol: 5, minthrottle: 1070, maxthrottle: 2000, ...sysConfig });
        return log.rcMotorRawToPctPhysical(raw);
    };

    it("maps the motorOutput header endpoints to 0 % and 100 %", () => {
        const sysConfig = { firmwareType: FIRMWARE_TYPE_INDIFLIGHT, motorOutput: [158, 2047] };
        expect(motorPct(sysConfig, 158)).toBeCloseTo(0);
        expect(motorPct(sysConfig, 2047)).toBeCloseTo(100);
        expect(motorPct(sysConfig, 158 + 0.3 * (2047 - 158))).toBeCloseTo(30);
    });

    it("round-trips through the inverse", () => {
        const log = Object.create(FlightLog.prototype);
        log.getSysConfig = () => ({ firmwareType: FIRMWARE_TYPE_INDIFLIGHT, motorOutput: [300, 1800] });
        expect(log.PctPhysicalTorcMotorRaw(log.rcMotorRawToPctPhysical(1100))).toBeCloseTo(1100);
    });

    it("keeps the DShot constants for Betaflight", () => {
        // DShot 48..2047 regardless of motorOutput
        expect(motorPct({ firmwareType: FIRMWARE_TYPE_BETAFLIGHT, motorOutput: [158, 2047] }, 48)).toBeCloseTo(0);
    });
});

describe("angle units setting", () => {
    beforeEach(() => setActivePinia(createPinia()));

    const RAD = 2;
    const useRadians = () => {
        useSettingsStore().userSettings.angleUnits = RAD;
    };
    // gyroScale as Betaflight writes it in the header: one count per deg/s
    const gyroLog = () => {
        const log = Object.create(FlightLog.prototype);
        log.getSysConfig = () => ({
            firmwareType: FIRMWARE_TYPE_INDIFLIGHT,
            blackbox_high_resolution: 1,
            gyroScale: (Math.PI / 180) * 1e-6,
        });
        return log;
    };

    it("defaults to degrees", () => {
        expect(FlightLogFieldPresenter.decodeFieldToFriendly(gyroLog(), "gyroADC[0]", 1800)).toBe("180.0 °/s");
    });

    it("shows gyro rates in rad/s", () => {
        useRadians();
        expect(FlightLogFieldPresenter.decodeFieldToFriendly(gyroLog(), "gyroADC[0]", 1800)).toBe("3.142 rad/s");
        expect(FlightLogFieldPresenter.decodeFieldToFriendly(gyroLog(), "gyroSp[2]", -900)).toBe("-1.571 rad/s");
    });

    it("converts the setpoint and the Indiflight angular fields", () => {
        useRadians();
        expect(present("setpoint[0]", 1800, { blackbox_high_resolution: 1 })).toBe("3.142 rad/s");
        // alpha is quantised to 10 deg/s^2, so 100 rad/s^2 comes back within that step
        const alpha = present("alpha[1]", Math.round((100 * 180) / Math.PI / 10));
        expect(alpha).toMatch(/ rad\/s\/s$/);
        expect(Number.parseFloat(alpha)).toBeCloseTo(100, 0);
        expect(present("servo_feedback[0]", 9000)).toBe("1.5708 rad");
        expect(present("ekf_gyro_b[2]", 180000)).toBe("3.14159 rad/s");
        // logged in mrad, so radians come back unchanged
        expect(present("ekf_att[0]", 1234)).toBe("1.23400 rad");
    });

    it("leaves rotor speeds and non-angular fields alone", () => {
        useRadians();
        expect(present("omega[0]", 1500)).toBe("1500 rad/s");
        expect(present("pitot_airSpeed", 1234)).toBe("12.34 m/s");
        expect(present("setpoint[3]", 425)).toBe("42.5 %");
    });
});
