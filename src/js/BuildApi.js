/**
 * Indiflight has no firmware build server. This stand-in keeps the firmware flasher's online
 * code paths inert: every lookup resolves to null and no request is made. Firmware is loaded
 * from local files instead.
 */
export default class BuildApi {
    async loadTargets() {
        return null;
    }

    async loadTargetReleases(_target) {
        return null;
    }

    async loadTarget(_target, _release) {
        return null;
    }

    async loadTargetFirmware(_path) {
        return null;
    }

    async loadOptions(_release) {
        return null;
    }

    async loadOptionsByBuildKey(_release, _key) {
        return null;
    }

    async loadCommits(_release) {
        return null;
    }

    async requestBuild(_request) {
        return null;
    }

    async requestBuildStatus(_key) {
        return null;
    }
}
