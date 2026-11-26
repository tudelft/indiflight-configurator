import { ref, watch } from "vue";
import { get as getConfig, set as setConfig } from "../js/ConfigStorage";
import { FLIGHT_PLAN_UNITS } from "../js/utils/flightPlanUnits";

const STORAGE_KEY = "flightPlanUnits";

// Shared across the Flight Plan components and persisted between sessions.
let units = null;

export function useFlightPlanUnits() {
    if (!units) {
        const stored = getConfig(STORAGE_KEY)?.[STORAGE_KEY];
        units = ref(Object.values(FLIGHT_PLAN_UNITS).includes(stored) ? stored : FLIGHT_PLAN_UNITS.METRIC);
        watch(units, (value) => setConfig({ [STORAGE_KEY]: value }));
    }
    return { units };
}
