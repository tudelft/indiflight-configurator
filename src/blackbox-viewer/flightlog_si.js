import semver from "semver";
import { FlightLogParser } from "./flightlog_parser.js";
import { FlightLogEvent, isBetaflightFamily } from "./flightlog_fielddefs.js";
import { indiflightField } from "./indiflight_fields.js";

/**
 * Numeric SI values of a parsed log, for plotting. Uses the same scalings as the presenter
 * (flightlog_fields_presenter.js), but returns numbers in SI units (rad instead of deg, normalized
 * sticks and motors in [-1, 1] / [0, 1]) instead of display strings.
 */

const DEG = Math.PI / 180;
const STANDARD_GRAVITY = 9.80665;

const GYRO_FIELDS = new Set(["gyroADC", "gyroUnfilt", "gyroSp", "gyroADCafterRpm", "gyroFf"]);

/**
 * Converter from the raw logged value of `fieldName` to SI. Fields without a known unit pass through raw.
 * @param {import("./flightlog.js").FlightLog} flightLog  with the log already opened
 * @param {string} fieldName
 * @returns {function(number): number}
 */
export function fieldToSI(flightLog, fieldName) {
    const sysConfig = flightLog.getSysConfig();
    const highRes = sysConfig.blackbox_high_resolution > 0 ? 10 : 1;
    const [, base, idx] = /^(\w+?)(?:\[(\d+)\])?$/.exec(fieldName) ?? [];
    const index = Number(idx ?? 0);

    if (GYRO_FIELDS.has(base)) {
        const k = flightLog.gyroRawToDegreesPerSecond(1 / highRes) * DEG;
        return (v) => v * k;
    }
    switch (base) {
        case "gyroADCs":
        case "rcCommands":
            return index < 3 ? (v) => v * DEG : (v) => v / 100; // computed: deg/s, throttle %
        case "axisError":
            return (v) => (v / highRes) * DEG;
        case "rcCommand":
            // presenter: [0..2] us around 1500, [3] us; normalized to [-1, 1] and [0, 1]
            return index < 3 ? (v) => v / highRes / 500 : (v) => (v / highRes - 1000) / 1000;
        case "setpoint":
            return index < 3 ? (v) => (v / highRes) * DEG : (v) => v / 1000;
        case "motor":
            return (v) => flightLog.rcMotorRawToPctPhysical(v) / 100;
        case "eRPM": {
            const poles = sysConfig.motor_poles || 14;
            return (v) => ((v * 200) / poles) * ((2 * Math.PI) / 60); // rad/s
        }
        case "axisSum":
        case "axisP":
        case "axisI":
        case "axisD":
        case "axisF":
        case "axisS":
            return (v) => flightLog.getPIDPercentage(v) / 100;
        case "accSmooth":
        case "accADCafterRpm":
            return (v) => flightLog.accRawToGs(v) * STANDARD_GRAVITY;
        case "vbatLatest":
            return vbatToVolts(flightLog);
        case "amperageLatest":
            return (v) => v / 100;
        case "baroAlt":
        case "surfaceRaw":
            return (v) => v / 100;
        case "rssi":
            return (v) => v / 1024;
        case "GPS_coord":
            return (v) => v / 10000000; // degrees
        case "GPS_altitude":
            return (v) => v / 10;
        case "GPS_speed":
        case "GPS_velned":
            return (v) => v / 100;
        case "GPS_ground_course":
            return (v) => (v / 10) * DEG;
        case "gpsHomeAzimuth":
        case "gpsTrajectoryTiltAngle":
            return (v) => v * DEG;
        default:
            break;
    }
    const field = indiflightField(fieldName);
    if (field) {
        return field.deg ? (v) => field.phys(v) * DEG : field.phys;
    }
    return (v) => v;
}

function vbatToVolts(flightLog) {
    const { firmwareType, firmwareVersion } = flightLog.getSysConfig();
    if (isBetaflightFamily(firmwareType) && semver.gte(firmwareVersion, "4.0.0")) {
        return (v) => v / 100;
    }
    if (isBetaflightFamily(firmwareType) && semver.gte(firmwareVersion, "3.1.0")) {
        return (v) => v / 10;
    }
    return (v) => flightLog.vbatADCToMillivolts(v) / 1000;
}

/**
 * The fields the viewer's FlightLog adds to the logged ones (addComputedFieldNames in flightlog.js), by base name.
 * Everything else in getMainFieldNames() is a field of the log.
 */
const VIEWER_COMPUTED = {
    heading:
        "roll, pitch, yaw of the attitude estimate in rad, from the logged quaternion or else from fusing gyro and " +
        "accelerometer; pitch has the opposite sign of the NED convention (NWU), yaw runs 0 to 2π",
    axisSum:
        "sum of the logged P, I, D, F and S terms of the axis, limited to the configured PID sum limit, normalized",
    rcCommands:
        "setpoint scaled for display: roll, pitch, yaw in rad/s, throttle in [0, 1] (from setpoint, or for " +
        "old logs from rcCommand and the configured rates)",
    axisError: "rad/s, setpoint minus filtered gyro, per axis",
    gpsCartesianCoords:
        "m, GPS position in a Cartesian frame around the first GPS fix of the log (0 while fewer " +
        "than 5 satellites)",
    gpsDistance: "m, horizontal distance to the first GPS fix of the log (0 while fewer than 5 satellites)",
    gpsHomeAzimuth: "rad, bearing from the aircraft to the first GPS fix (0 while fewer than 5 satellites)",
    gpsTrajectoryTiltAngle: "rad, tilt of the GPS NED velocity vector",
};

/**
 * How a field the viewer computes (rather than the flight controller logging) came about.
 * @param {string} fieldName
 * @returns {string|null}  null for a field of the log
 */
export function computedFieldDescription(fieldName) {
    const [, base] = /^(\w+?)(?:\[\d+\])?$/.exec(fieldName) ?? [];
    const how = VIEWER_COMPUTED[base];
    return how ? `Computed here, not logged: ${how}.` : null;
}

// bit masks and absolute times need more than float32's 24 bit mantissa
const F64_FIELDS = new Set([
    "loopIteration",
    "time",
    "flightModeFlags",
    "stateFlags",
    "GPS_coord[0]",
    "GPS_coord[1]",
    "extTime",
]);

/**
 * All frames of the opened log as SI columns.
 * @param {import("./flightlog.js").FlightLog} flightLog  with the log already opened (openLog)
 * @returns {{time: Float64Array, columns: Object<string, Float32Array|Float64Array>, events: {t: number, name: string, kind: string}[], descriptions: Object<string, string>}}
 *          time in seconds since power-up (the log's time base); descriptions only for the columns the viewer
 *          computed itself, which the others are not
 */
export function flightLogToSI(flightLog) {
    const chunks = flightLog.getChunksInTimeRange(flightLog.getMinTime(), flightLog.getMaxTime());
    let n = 0;
    for (const c of chunks) {
        n += c.frames.length;
    }
    const names = flightLog.getMainFieldNames();
    const iTime = FlightLogParser.prototype.FLIGHT_LOG_FIELD_INDEX_TIME;

    const time = new Float64Array(n);
    const columns = {};
    const arrays = names.map((name) => {
        const a = F64_FIELDS.has(name) ? new Float64Array(n) : new Float32Array(n);
        if (name !== "time") {
            columns[name] = a;
        }
        return a;
    });
    const conv = names.map((name) => fieldToSI(flightLog, name));
    const descriptions = {};
    for (const name of names) {
        const how = computedFieldDescription(name);
        if (how) {
            descriptions[name] = how;
        }
    }

    const events = [];
    let r = 0;
    for (const chunk of chunks) {
        for (const frame of chunk.frames) {
            time[r] = frame[iTime] * 1e-6;
            for (let c = 0; c < names.length; c++) {
                const v = frame[c];
                arrays[c][r] = v == null ? Number.NaN : conv[c](v);
            }
            r++;
        }
        for (const e of chunk.events ?? []) {
            const name = eventName(e);
            if (name && e.time != null) {
                events.push({ t: e.time * 1e-6, name, kind: "event" });
            }
        }
    }
    return { time, columns, events, descriptions };
}

// flight mode changes come from flightModeFlags instead, the viewer shows these too
function eventName(e) {
    switch (e.event) {
        case FlightLogEvent.SYNC_BEEP:
            return "Sync beep";
        case FlightLogEvent.DISARM:
            return "Disarm";
        case FlightLogEvent.LOGGING_RESUME:
            return "Logging resumed";
        case FlightLogEvent.INFLIGHT_ADJUSTMENT:
            return "Adjustment";
        case FlightLogEvent.LOG_END:
            return "Log end";
        default:
            return null;
    }
}
