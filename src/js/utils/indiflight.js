import semver from "semver";
import { API_VERSION_1_45 } from "../data_storage";

/**
 * Indiflight identifies as "BTFL". The 4.4-based fork reports MSP API 1.45 and firmware
 * version 5.x; the Betaflight 2026-based port reports upstream's version and API (1.48+)
 * and the USE_INDIFLIGHT build option in MSP_BUILD_INFO. Older builds identify as "INFL".
 * @param {{ flightControllerIdentifier?: string, flightControllerVersion?: string, apiVersion?: string }} config
 * @returns {boolean}
 */
export function isIndiflight(config) {
    if (!config) {
        return false;
    }
    if (config.flightControllerIdentifier === "INFL") {
        return true;
    }
    if (
        config.flightControllerIdentifier === "BTFL" &&
        Array.isArray(config.buildOptions) &&
        config.buildOptions.includes("USE_INDIFLIGHT")
    ) {
        return true;
    }
    const version = semver.valid(semver.coerce(config.flightControllerVersion));
    return (
        config.flightControllerIdentifier === "BTFL" &&
        semver.valid(config.apiVersion) !== null &&
        semver.eq(config.apiVersion, API_VERSION_1_45) &&
        version !== null &&
        semver.major(version) >= 5
    );
}
