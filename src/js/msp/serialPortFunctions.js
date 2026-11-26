import semver from "semver";
import { API_VERSION_1_48 } from "../data_storage";

// Bit indices of 'serialPortFunction_e' in 'src/main/io/serial.h' of the firmware.
// Bits 0..17 are the same in every supported firmware.
const COMMON_FUNCTIONS = {
    MSP: 0,
    GPS: 1,
    TELEMETRY_FRSKY: 2,
    TELEMETRY_HOTT: 3,
    TELEMETRY_LTM: 4,
    TELEMETRY_SMARTPORT: 5,
    RX_SERIAL: 6,
    BLACKBOX: 7,
    TELEMETRY_MAVLINK: 9,
    ESC_SENSOR: 10,
    TBS_SMARTAUDIO: 11,
    TELEMETRY_IBUS: 12,
    IRC_TRAMP: 13,
    RUNCAM_DEVICE_CONTROL: 14, // support communitate with RunCam Device
    LIDAR_TF: 15,
    FRSKY_OSD: 16,
    VTX_MSP: 17,
};

// Indiflight 4.4 fork (API 1.45 .. 1.47): bits 18..22 are indiflight functions.
const FORK_44_FUNCTIONS = {
    ...COMMON_FUNCTIONS,
    TELEMETRY_PI: 18,
    HIL: 19,
    ACTUATORS_T4: 20,
    TELEMETRY_UROS: 21,
    SERVOS_FEETECH: 22,
};

// Betaflight 2026.6 based firmware (API 1.48+): upstream took bits 18..20, so
// the indiflight functions moved up. UROS is not ported. Upstream functions are
// listed so their bits survive a read-modify-write of the port config.
const BF2026_FUNCTIONS = {
    ...COMMON_FUNCTIONS,
    GIMBAL: 18,
    LIDAR_NL: 19,
    OSD_CUSTOM_TEXT: 20,
    SERVOS_FEETECH: 22,
    TELEMETRY_PI: 23,
    ACTUATORS_T4: 24,
    HIL: 25,
};

export function getSerialPortFunctions(apiVersion) {
    if (apiVersion && semver.valid(apiVersion) && semver.gte(apiVersion, API_VERSION_1_48)) {
        return BF2026_FUNCTIONS;
    }
    return FORK_44_FUNCTIONS;
}
