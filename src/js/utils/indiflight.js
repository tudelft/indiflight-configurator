import semver from "semver";
import { API_VERSION_1_45 } from "../data_storage";

/**
 * Indiflight identifies as "BTFL" with MSP API 1.45, like Betaflight 4.4, but reports
 * firmware version 5.x. Older builds identify as "INFL".
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
    const version = semver.valid(semver.coerce(config.flightControllerVersion));
    return (
        config.flightControllerIdentifier === "BTFL" &&
        semver.valid(config.apiVersion) !== null &&
        semver.eq(config.apiVersion, API_VERSION_1_45) &&
        version !== null &&
        semver.major(version) >= 5
    );
}
