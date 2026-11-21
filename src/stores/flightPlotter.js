import { defineStore } from "pinia";
import { shallowRef } from "vue";
import { get as getConfig, set as setConfig } from "@/js/ConfigStorage";

const STORAGE_KEY = "flightPlotterLayouts";

/**
 * Hands a log held in memory (e.g. a simulation's blackbox file) to the Flight Plotter tab, and keeps the user's
 * plot layouts (flightplotter's layout file format), one per craft type.
 */
export const useFlightPlotterStore = defineStore("flightPlotter", () => {
    /** @type {import("vue").ShallowRef<{data: Uint8Array, name: string} | null>} */
    const pendingLog = shallowRef(null);

    /** queue a log for the tab; the caller switches to it */
    function openLog(data, name) {
        pendingLog.value = { data, name };
    }

    /** the queued log, once */
    function takePendingLog() {
        const log = pendingLog.value;
        pendingLog.value = null;
        return log;
    }

    // read fresh each time: another browser tab of the app may have saved a layout meanwhile
    const layouts = () => getConfig(STORAGE_KEY)[STORAGE_KEY] ?? {};

    /** the layout last used for this craft type, or null for the built-in one */
    function savedLayout(craftType) {
        return layouts()[craftType] ?? null;
    }

    function saveLayout(craftType, layout) {
        setConfig({ [STORAGE_KEY]: { ...layouts(), [craftType]: layout } });
    }

    /** back to the built-in layout for this craft type */
    function forgetLayout(craftType) {
        const { [craftType]: _, ...rest } = layouts();
        setConfig({ [STORAGE_KEY]: rest });
    }

    return { pendingLog, openLog, takePendingLog, savedLayout, saveLayout, forgetLayout };
});
