import { defineStore } from "pinia";
import { shallowRef } from "vue";

/** Hands a log held in memory (e.g. a simulation's blackbox file) to the Flight Plotter tab. */
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

    return { pendingLog, openLog, takePendingLog };
});
