import { get as getConfig, set as setConfig } from "../ConfigStorage.js";

/**
 * Settings that start enabled on a fresh install. Most code reads these with a
 * bare `getConfig(key)` (falsy when unset), so the default is written to storage
 * rather than passed at each call site. A value the user has saved is kept.
 */
export const CONFIG_DEFAULTS = {
    expertMode: true,
    // Manual connection is the only way to enter a ws:// or wss:// URL.
    showManualMode: true,
};

/**
 * Persist each default whose key has never been stored.
 *
 * @param {Record<string, unknown>} [defaults]
 */
export function seedConfigDefaults(defaults = CONFIG_DEFAULTS) {
    for (const [key, value] of Object.entries(defaults)) {
        if (getConfig(key)[key] === undefined) {
            setConfig({ [key]: value });
        }
    }
}

// Runs on import so the defaults are stored before any module reads config at load time.
seedConfigDefaults();
