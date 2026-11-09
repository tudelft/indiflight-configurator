import { describe, expect, it } from "vitest";
import { isIndiflight } from "../../src/js/utils/indiflight";
import Beepers from "../../src/js/Beepers";

const indiflight = { flightControllerIdentifier: "BTFL", flightControllerVersion: "5.0.0", apiVersion: "1.45.0" };
const betaflight44 = { flightControllerIdentifier: "BTFL", flightControllerVersion: "4.4.3", apiVersion: "1.45.0" };

describe("isIndiflight", () => {
    it("detects Indiflight by firmware version 5.x on API 1.45", () => {
        expect(isIndiflight(indiflight)).toBe(true);
    });

    it("detects the legacy INFL identifier", () => {
        expect(isIndiflight({ flightControllerIdentifier: "INFL" })).toBe(true);
    });

    it("does not match Betaflight", () => {
        expect(isIndiflight(betaflight44)).toBe(false);
        expect(
            isIndiflight({
                flightControllerIdentifier: "BTFL",
                flightControllerVersion: "2025.12.1",
                apiVersion: "1.47.0",
            }),
        ).toBe(false);
    });

    it("handles missing or incomplete config", () => {
        expect(isIndiflight(undefined)).toBe(false);
        expect(
            isIndiflight({ flightControllerIdentifier: "BTFL", flightControllerVersion: "", apiVersion: "0.0.0" }),
        ).toBe(false);
    });
});

describe("Indiflight beepers", () => {
    it("adds the Indiflight beepers only for Indiflight", () => {
        expect(new Beepers(indiflight).isEnabled("THROW_TO_ARM")).toBe(true);
        expect(new Beepers(betaflight44).isEnabled("THROW_TO_ARM")).toBe(false);
    });

    it("maps THROW_TO_ARM to bit 24 of the disabled mask", () => {
        const beepers = new Beepers(indiflight);
        beepers.setDisabledMask(1 << 24);
        expect(beepers.isEnabled("THROW_TO_ARM")).toBe(false);
        expect(beepers.isEnabled("ARMING_GPS_NO_FIX")).toBe(true);
    });
});
