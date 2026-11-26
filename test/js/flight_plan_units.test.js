import { describe, expect, it } from "vitest";
import {
    FLIGHT_PLAN_UNITS,
    altitudeFromDisplay,
    altitudeToDisplay,
    formatDistance,
    speedFromDisplay,
    speedToDisplay,
} from "../../src/js/utils/flightPlanUnits";

const { METRIC, IMPERIAL } = FLIGHT_PLAN_UNITS;

describe("flight plan display units", () => {
    it("leaves imperial values unchanged", () => {
        expect(altitudeToDisplay(400, IMPERIAL)).toBe(400);
        expect(altitudeFromDisplay(400, IMPERIAL)).toBe(400);
        expect(speedToDisplay(10, IMPERIAL)).toBe(10);
        expect(speedFromDisplay(10, IMPERIAL)).toBe(10);
    });

    it("converts altitude and speed to metric", () => {
        expect(altitudeToDisplay(400, METRIC)).toBe(121.9);
        expect(speedToDisplay(10, METRIC)).toBe(5.1);
    });

    it("round-trips metric entries to firmware cm and cm/s", () => {
        // the firmware stores cm and cm/s (useFlightPlan.js)
        expect(Math.round(altitudeFromDisplay(120, METRIC) * 30.48)).toBe(12000);
        expect(Math.round(speedFromDisplay(5, METRIC) * 51.4444)).toBe(500);
    });

    it("formats distance per unit system", () => {
        expect(formatDistance(1852, IMPERIAL)).toBe("1.00nm");
        expect(formatDistance(250, METRIC)).toBe("250m");
        expect(formatDistance(1852, METRIC)).toBe("1.85km");
    });
});
