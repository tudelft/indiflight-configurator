import { beforeAll, describe, expect, it } from "vitest";
import { computedFieldDescription } from "../../src/blackbox-viewer/flightlog_si.js";

// flightplotter pulls in uPlot, which needs matchMedia; jsdom has none
let indiflightPlot, Dataset, datasetToCsv;
beforeAll(async () => {
    window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} });
    ({ indiflightPlot } = await import("../../src/js/indiflight/flightPlotterLayout.js"));
    ({ Dataset, datasetToCsv } = await import("flightplotter"));
});

describe("computedFieldDescription", () => {
    it("flags the fields the viewer adds, and no logged one", () => {
        for (const f of [
            "heading[1]",
            "axisSum[0]",
            "rcCommands[3]",
            "axisError[2]",
            "gpsDistance",
            "gpsHomeAzimuth",
        ]) {
            expect(computedFieldDescription(f), f).toMatch(/^Computed here, not logged/);
        }
        for (const f of ["gyroADC[0]", "rcCommand[0]", "setpoint[3]", "quat[0]", "GPS_coord[0]", "motor[2]"]) {
            expect(computedFieldDescription(f), f).toBeNull();
        }
    });
});

describe("CSV export of an Indiflight log", () => {
    const text = (ds, o) => datasetToCsv(ds, o).join("");

    function plotDataset() {
        const f32 = (...v) => new Float32Array(v);
        const columns = {
            "quat[0]": f32(1, 1, 1),
            "quat[1]": f32(0, 0, 0),
            "quat[2]": f32(0, 0, 0),
            "quat[3]": f32(0, 0, 0),
            "vel[0]": f32(1, 2, 3),
            "vel[1]": f32(0, 0, 0),
            "vel[2]": f32(0, 0, 0),
            "accSmooth[0]": f32(0, 0, 0),
            "accSmooth[1]": f32(0, 0, 0),
            "accSmooth[2]": f32(-9.8, -9.8, -9.8),
            "heading[2]": f32(0.1, 0.2, 0.3), // as the viewer's computed field
            "motor[0]": f32(0.1, 0.2, 0.3),
        };
        const si = {
            time: Float64Array.from([0, 0.5, 1]),
            columns,
            events: [],
            descriptions: { "heading[2]": computedFieldDescription("heading[2]") },
        };
        return new Dataset(indiflightPlot(si, []).data);
    }

    it("marks the viewer's and the app's computed columns, and only those", () => {
        const ds = plotDataset();
        const derived = [...ds.derived];
        expect(derived).toContain("heading[2]");
        expect(derived).toContain("velB[0]");
        expect(derived).toContain("accI[2]");
        expect(derived).not.toContain("vel[0]");
        expect(derived).not.toContain("motor[0]");
        const header = text(ds, { comments: false }).split("\n")[0].split(",");
        expect(header[0]).toBe("time");
        // logged first, computed last
        const firstCalc = header.findIndex((h) => h.startsWith("calc:"));
        expect(header.slice(firstCalc).every((h) => h.startsWith("calc:"))).toBe(true);
        expect(header).toContain("vel[0]");
        expect(header).toContain("calc:velB[0]");
        expect(header).toContain("calc:heading[2]");
        expect(header).not.toContain("velB[0]");
        expect(header).not.toContain("calc:motor[0]");
    });

    it("writes float32 columns in their shortest form and documents the computed ones", () => {
        const csv = text(plotDataset(), { header: ["Source file: x.BFL"] });
        const lines = csv.split("\n");
        expect(lines[0]).toBe("# Source file: x.BFL");
        expect(csv).toMatch(/# {3}calc:velB\[0\]: Computed here: Velocity estimate vel\[0\.\.2\]/);
        const body = lines.filter((l) => !l.startsWith("#") && l);
        const head = body[0].split(",");
        expect(body[1].split(",")[head.indexOf("motor[0]")]).toBe("0.1");
        expect(body[3].split(",")[0]).toBe("1");
    });
});
