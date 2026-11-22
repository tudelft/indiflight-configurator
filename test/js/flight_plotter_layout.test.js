import { beforeAll, describe, expect, it } from "vitest";

// flightplotter pulls in uPlot, which needs matchMedia; jsdom has none
let indiflightPlot;
beforeAll(async () => {
    window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} });
    ({ indiflightPlot } = await import("../../src/js/indiflight/flightPlotterLayout.js"));
});

const N_SAMPLES = 3;

/** columns of a log with nMotor motors and, if slots > 0, the learner's fields for that many slots */
function log(nMotor, slots) {
    const c = {};
    const col = (name, v = 0) => (c[name] = new Float32Array(N_SAMPLES).fill(v));
    for (let i = 0; i < nMotor; i++) {
        col(`motor[${i}]`);
    }
    for (let i = 0; i < 4; i++) {
        col(`u[${i}]`);
    }
    for (let m = 0; m < slots; m++) {
        for (let i = 0; i < 4; i++) {
            col(`motor_${m}_rls_x[${i}]`);
        }
        col(`motor_${m}_rls_e_var`);
        col(`motor_${m}_rls_lambda`);
    }
    for (const a of "xyz") {
        for (let i = 0; i < slots; i++) {
            col(`fx_${a}_rls_x[${i}]`);
        }
    }
    for (const a of "pqr") {
        for (let i = 0; i < 2 * slots; i++) {
            col(`fx_${a}_rls_x[${i}]`);
        }
    }
    return { time: Float64Array.from({ length: N_SAMPLES }, (_, i) => i * 0.01), columns: c, events: [] };
}

const tab = (plot, name) => plot.tabs.find((t) => t.name === name);
const panelNamed = (t, title) => t.panels.find((p) => p.title === title);
const solids = (p) => p.series.map((s) => s.solid);

describe("Onboard ID tab", () => {
    it("is left out for logs without the learner", () => {
        const plot = indiflightPlot(log(4, 0), []);
        expect(plot.tabs.map((t) => t.name)).toEqual(["Flight Data"]);
    });

    it("shows the omega-dot terms after all learner slots, not after the motors", () => {
        // 8 slots logged (BLACKBOX_LEARNER_LOG_8_MOTORS), but a quad: omega-dot of motor 0 is fx_p_rls_x[8]
        const t = tab(indiflightPlot(log(4, 8), []), "Onboard ID");
        expect(solids(panelNamed(t, "Fx P (ω²)"))).toEqual([0, 1, 2, 3].map((i) => `fx_p_rls_x[${i}]`));
        expect(solids(panelNamed(t, "Fx P (ω̇)"))).toEqual([8, 9, 10, 11].map((i) => `fx_p_rls_x[${i}]`));
        expect(solids(panelNamed(t, "Fx R (ω̇)"))).toEqual([8, 9, 10, 11].map((i) => `fx_r_rls_x[${i}]`));
    });

    it("includes a tailsitter's servos in the Fx panels but not in the motor panels", () => {
        const t = tab(indiflightPlot(log(2, 4), []), "Onboard ID");
        expect(panelNamed(t, "Max Motor Speed").series.map((s) => s.label)).toEqual(["Motor 1", "Motor 2"]);
        const fxQ = panelNamed(t, "Fx Q (ω̇)");
        expect(fxQ.series.map((s) => s.label)).toEqual(["Motor 1", "Motor 2", "Servo 1", "Servo 2"]);
        expect(solids(fxQ)).toEqual([4, 5, 6, 7].map((i) => `fx_q_rls_x[${i}]`));
    });

    it("derives max speed and kappa from the motor model", () => {
        const si = log(4, 4);
        si.columns["motor_1_rls_x[0]"].set([600, 0, -5]);
        si.columns["motor_1_rls_x[1]"].set([1400, 0, 2]);
        const { data } = indiflightPlot(si, []);
        expect([...data.columns["motorWmax[1]"]]).toEqual([2000, 0, -3]);
        expect([...data.columns["motorKappa[1]"]].map((v) => +v.toFixed(6))).toEqual([0.3, 0, 0]);
        expect(data.descriptions["motorKappa[1]"]).toMatch(/motor_1_rls_x\[0\]/);
    });

    it("refers only to columns the log has, apart from the derived ones", () => {
        const plot = indiflightPlot(log(4, 4), []);
        const missing = tab(plot, "Onboard ID")
            .panels.flatMap((p) => p.series.map((s) => s.solid))
            .filter((c) => !plot.data.columns[c] && !/_rls_(e_var|lambda)$/.test(c));
        expect(missing).toEqual([]);
    });
});
