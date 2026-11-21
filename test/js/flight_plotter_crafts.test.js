import { beforeAll, describe, expect, it } from "vitest";

// flightplotter pulls in uPlot, which needs matchMedia; jsdom has none
let detectCraft, craftChoices, extraHeaders;
beforeAll(async () => {
    window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} });
    ({ detectCraft, craftChoices, extraHeaders } = await import("../../src/js/indiflight/flightPlotterCrafts.js"));
});

const columnsWith = (nMotor, nU = 8) => {
    const c = {};
    for (let i = 0; i < nMotor; i++) {
        c[`motor[${i}]`] = new Float32Array(4);
    }
    for (let i = 0; i < nU; i++) {
        c[`u[${i}]`] = new Float32Array(4);
        c[`omega[${i}]`] = Float32Array.from([0, 100 * (i + 1), 50, 0]);
    }
    return c;
};

const rotorsOf = (choice) =>
    choice.viewport.craft.rotors.map((r) => {
        const [x, y] = r.xyz;
        // azimuth clockwise from the nose, seen from above (FRD: x forward, y right)
        const az = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
        return [az, r.spin];
    });

// header values from the mockup logs in ../indiflight/logs-mockup
const QUAD = {
    indi_act_num: "4",
    indi_act_is_motor: "1,1,1,1",
    indi_act_is_servo: "0,0,0,0",
    indi_act_g1_roll: "-4000,-4000,4000,4000",
    indi_act_g1_pitch: "-2600,2600,-2600,2600",
    indi_act_g1_yaw: "-510,510,510,-510",
    indi_tails_use_scheduled: "0",
};
const HEX = {
    indi_act_num: "6",
    indi_act_is_motor: "1,1,1,1",
    indi_act_g1_roll: "-10,4950,4960,10",
    indi_act_g1_pitch: "5780,2900,-2830,-5700",
    indi_act_g1_yaw: "-210,210,-200,210",
    indi_tails_use_scheduled: "0",
};
const TAILSITTER = {
    indi_act_num: "4",
    indi_act_type: "1,1,2,2",
    indi_act_g1_roll: "1975,-1975,0,0",
    indi_act_g1_pitch: "0,0,-810,-810",
    indi_act_g1_yaw: "0,0,-563,563",
    indi_tails_use_scheduled: "1",
};

describe("flight plotter crafts", () => {
    it("reads unknown headers as a map", () => {
        expect(extraHeaders({ unknownHeaders: [{ name: "indi_act_num", value: "4" }] })).toEqual({ indi_act_num: "4" });
        expect(extraHeaders(undefined)).toEqual({});
    });

    it("draws the quad from the INDI header, matching Betaflight QuadX props in", () => {
        const columns = columnsWith(4);
        const choices = craftChoices(columns, detectCraft(columns, QUAD));
        expect(choices[0].label).toMatch(/INDI/);
        // 0 rear right CW, 1 front right CCW, 2 rear left CCW, 3 front left CW
        const indi = rotorsOf(choices[0]);
        expect(indi.map(([, s]) => s)).toEqual(["cw", "ccw", "ccw", "cw"]);
        const quadx = choices.find((c) => /Quad X.*props in/.test(c.label));
        expect(rotorsOf(quadx)).toEqual([
            [135, "cw"],
            [45, "ccw"],
            [225, "ccw"],
            [315, "cw"],
        ]);
        // same quadrants as the preset (the header ratio makes it wider than long)
        indi.forEach(([az], k) => expect(Math.abs(az - rotorsOf(quadx)[k][0])).toBeLessThan(25));
    });

    it("props out flips every spin", () => {
        const columns = columnsWith(4);
        const choices = craftChoices(columns, detectCraft(columns, {}));
        const pin = rotorsOf(choices.find((c) => /Quad X.*props in/.test(c.label)));
        const pout = rotorsOf(choices.find((c) => /Quad X.*props out/.test(c.label)));
        expect(pout.map(([, s]) => s)).toEqual(pin.map(([, s]) => (s === "cw" ? "ccw" : "cw")));
    });

    it("ranks crafts by the 4 actuators a hex header covers", () => {
        const columns = columnsWith(6);
        const choices = craftChoices(columns, detectCraft(columns, HEX));
        // the header can't describe 6 rotors, so no INDI choice
        expect(choices.some((c) => /INDI/.test(c.label))).toBe(false);
        // plus hex numbered counter-clockwise from the front, starting clockwise
        expect(choices[0].label).toMatch(/counter-clockwise from the front/);
        expect(rotorsOf(choices[0])).toEqual([
            [0, "cw"],
            [300, "ccw"],
            [240, "cw"],
            [180, "ccw"],
            [120, "cw"],
            [60, "ccw"],
        ]);
    });

    it("wires rotor k to the k-th INDI motor actuator", () => {
        const columns = columnsWith(4);
        const choices = craftChoices(columns, detectCraft(columns, QUAD));
        const v = choices[0].viewport;
        expect(v.rotorSet).toEqual(["u[0]", "u[1]", "u[2]", "u[3]"]);
        expect(v.rotor.map((r) => r[0])).toEqual(["omega[0]", "omega[1]", "omega[2]", "omega[3]"]);
        // thrust is normalised to the largest motor speed of the motors
        expect(v.rotor[0][1] * 400).toBeCloseTo(1, 3);
    });

    it("detects the tailsitter: motors 0, 1, servos 2, 3", () => {
        const columns = columnsWith(2);
        const detected = detectCraft(columns, TAILSITTER);
        expect(detected).toMatchObject({ type: "tailsitter", Nr: 2, Ns: 2 });
        const [choice] = craftChoices(columns, detected);
        expect(choice.viewport.rotorSet).toEqual(["u[0]", "u[1]"]);
        expect(choice.viewport.surfaceSet.map((r) => r[0])).toEqual(["u[2]", "u[3]"]);
    });

    it("works without INDI headers", () => {
        const columns = columnsWith(8);
        const detected = detectCraft(columns, {});
        expect(detected.type).toBe("octorotor");
        const labels = craftChoices(columns, detected).map((c) => c.label);
        expect(labels[0]).toMatch(/Octo flat X.*props in/);
        expect(labels.some((l) => /X8/.test(l))).toBe(true);
    });
});
