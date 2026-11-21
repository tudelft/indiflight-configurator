/**
 * Fixed Flight Plotter layout for Indiflight logs: the panels and 3D view of flightPlotter.py
 * (IndiflightPlotter / IndiflightViewport in the firmware repo's support/LogAnalysis), on the SI
 * columns from flightLogToSI().
 */
import { bitChangeEvents, derivative, lowpassFiltfilt, rotateByQuaternion, sampleRate } from "flightplotter";
import { craftChoices, detectCraft, extraHeaders } from "./flightPlotterCrafts";

export { detectCraft, extraHeaders };

const vec = (columns, name, n = 3) => {
    const a = [];
    for (let i = 0; i < n; i++) {
        a.push(columns[`${name}[${i}]`]);
    }
    return a.every(Boolean) ? a : null;
};

/**
 * The signals IndiflightPlotter computes: body velocities, inertial acceleration, servo derivatives.
 * @returns {Object<string, string>} how each came about, for the plotter's tooltips
 */
function addDerived(time, columns, Ns) {
    const descriptions = {};
    const AXES = ["x", "y", "z"];
    const quat = vec(columns, "quat", 4);
    if (quat) {
        for (const [src, dst, what] of [
            ["vel", "velB", "Velocity estimate"],
            ["localVel", "localVelB", "Mocap velocity"],
            ["velSp", "velSpB", "Velocity setpoint"],
        ]) {
            const v = vec(columns, src);
            if (v) {
                rotateByQuaternion(quat, v, true).forEach((a, i) => {
                    columns[`${dst}[${i}]`] = a;
                    descriptions[`${dst}[${i}]`] =
                        `Computed here: ${what} ${src}[0..2], rotated world → body (FRD) with the onboard attitude ` +
                        `estimate quat; body ${AXES[i]}.`;
                });
            }
        }
        const acc = vec(columns, "accSmooth");
        if (acc) {
            const accI = rotateByQuaternion(quat, acc, false);
            for (let i = 0; i < accI[2].length; i++) {
                accI[2][i] += 9.81;
            }
            accI.forEach((a, i) => {
                columns[`accI[${i}]`] = a;
                descriptions[`accI[${i}]`] =
                    "Computed here: specific force accSmooth[0..2], rotated body → world (NED) with quat, plus " +
                    `gravity (9.81 m/s² on z), i.e. the inertial acceleration; world ${AXES[i]}.`;
            });
        }
    }
    const servo = Ns > 0 ? vec(columns, "servo_feedback", Ns) : null;
    if (servo) {
        const fs = sampleRate(time);
        servo.forEach((y, i) => {
            const f = lowpassFiltfilt(y, fs, 20);
            columns[`servoDot[${i}]`] = derivative(time, f, 1);
            columns[`servoDotDot[${i}]`] = derivative(time, f, 2);
            const how = `servo_feedback[${i}], low-passed at 20 Hz without phase lag (forward-backward)`;
            descriptions[`servoDot[${i}]`] = `Computed here: rate of ${how}, then differentiated [rad/s].`;
            descriptions[`servoDotDot[${i}]`] = `Computed here: acceleration of ${how}, differentiated twice [rad/s²].`;
        });
    }
    return descriptions;
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
const v3 = (name) => [0, 1, 2].map((i) => `${name}[${i}]`);
const XYZ = ["X", "Y", "Z"];
const RPY = ["roll", "pitch", "yaw"];

/** panel spec from per-style column lists, like _plot_timeseries(light, solid, dashed, series_labels) */
function panel(row, col, title, ylabel, styles, labels, { light, solid, dashed, ylim }) {
    return {
        row,
        col,
        title,
        ylabel,
        styles,
        ylim,
        series: labels.map((label, i) => ({
            label,
            light: light?.[i] ?? null,
            solid: solid?.[i] ?? null,
            dashed: dashed?.[i] ?? null,
        })),
    };
}

/** IndiflightPlotter._populate; motor and servo signals by INDI actuator index */
function panels(columns, { Nr, Ns, act }) {
    const has = (c) => !!columns[c];
    const motors = act.motorActs.length === Nr ? act.motorActs : range(0, Nr);
    const servos = act.servoActs.length === Ns ? act.servoActs : range(Nr, Nr + Ns);
    const P = [
        panel(0, 2, "Body Angular Rates", "Angular Rate [rad/s]", ["Raw", "Filtered", "Setpoint"], RPY, {
            light: v3("gyroADCafterRpm"),
            solid: v3("gyroADC"),
            dashed: v3("gyroSp"),
        }),
        panel(1, 1, "Body Specific Forces", "Specific Force [N/kg]", ["Raw", "Filtered", "Setpoint"], XYZ, {
            solid: v3("accSmooth"),
            dashed: v3("spfSp"),
        }),
        panel(1, 2, "Body Angular Accel.", "Angular Accel. [rad/s²]", [null, "Filtered", "Setpoint"], RPY, {
            solid: v3("alpha"),
            dashed: v3("alphaSp"),
        }),
        panel(
            3,
            0,
            "RC Commands",
            "RC Command",
            [null, "Raw", null],
            ["RC Roll", "RC Pitch", "RC Yaw", "RC Throttle"],
            { solid: range(0, 4).map((i) => `rcCommand[${i}]`), ylim: [-1.1, 1.1] },
        ),
        panel(
            2,
            2,
            "Actuator Commands Motors",
            "Actuator Commands [-]",
            [null, "Est. state", "Command"],
            motors.map((i) => `Actuator ${i + 1}`),
            { solid: motors.map((i) => `u_state[${i}]`), dashed: motors.map((i) => `u[${i}]`), ylim: [-0.05, 1.05] },
        ),
    ];
    if (Nr > 0) {
        P.push(
            panel(
                3,
                2,
                "Motor Speeds",
                "Motor Speed [rad/s]",
                ["Raw", "Onboard filt.", null],
                motors.map((_, k) => `Motor ${k + 1}`),
                {
                    light: motors.map((i) => `omegaUnfiltered[${i}]`),
                    solid: motors.map((i) => `omega[${i}]`),
                    ylim: [-100, null],
                },
            ),
        );
    }
    if (Ns > 0) {
        P.push(
            panel(
                2,
                1,
                "Actuator Commands Servos",
                "Actuator Commands [-]",
                [null, "Est. state", "Command"],
                servos.map((i) => `Actuator ${i + 1}`),
                {
                    solid: servos.map((i) => `u_state[${i}]`),
                    dashed: servos.map((i) => `u[${i}]`),
                    ylim: [-1.05, 1.05],
                },
            ),
        );
        if (has("servo_feedback[0]")) {
            const s = range(0, Ns);
            P.push(
                panel(
                    3,
                    1,
                    "Servo State",
                    "Servo State [rad]",
                    [null, "Unfiltered state", "Scaled Command"],
                    s.map((i) => `Servo ${i + 1}`),
                    {
                        solid: s.map((i) => `servo_feedback[${i}]`),
                        dashed: servos.map((i) => [`u[${i}]`, (100 * Math.PI) / 180]),
                    },
                ),
            );
            P.push(
                panel(
                    4,
                    1,
                    "Servo Derivatives",
                    "Servo Derivative",
                    ["2nd Derivative", "1st Derivative ×10", null],
                    s.map((i) => `Servo ${i + 1}`),
                    { light: s.map((i) => `servoDotDot[${i}]`), solid: s.map((i) => [`servoDot[${i}]`, 10]) },
                ),
            );
        }
    }
    if (has("pos[0]")) {
        const mocap = ["Mocap", "Estimated", "Setpoint"];
        P.push(
            panel(0, 0, "Position", "Position [m]", mocap, XYZ, {
                light: v3("localPos"),
                solid: v3("pos"),
                dashed: v3("posSp"),
            }),
            panel(1, 0, "Velocity Global", "Velocity [m/s]", mocap, XYZ, {
                light: v3("localVel"),
                solid: v3("vel"),
                dashed: v3("velSp"),
            }),
            panel(0, 1, "Velocity Body", "Velocity [m/s]", mocap, XYZ, {
                light: v3("localVelB"),
                solid: v3("velB"),
                dashed: v3("velSpB"),
            }),
            panel(2, 0, "Acceleration Global", "Acceleration [m/s²]", [null, "Estimated", "Setpoint"], XYZ, {
                solid: v3("accI"),
                dashed: v3("accSp"),
            }),
        );
    }
    return P;
}

/** IndiflightViewport, without the craft-dependent part (see craftChoices) */
function viewport(columns) {
    const refs = (name, n) => (vec(columns, name, n) ? range(0, n).map((i) => `${name}[${i}]`) : undefined);
    return {
        att: refs("quat", 4),
        attSet: refs("quatSp", 4),
        attMeas: refs("localQuat", 4),
        pos: refs("pos", 3),
        posSet: refs("posSp", 3),
        posMeas: refs("localPos", 3),
        vel: refs("vel", 3),
        velSet: refs("velSp", 3),
        velMeas: refs("localVel", 3),
        acc: refs("accI", 3),
        accSet: refs("accSp", 3),
        interpolation: "previous",
    };
}

/**
 * A layout saved with another log of this craft type, for this log: its tabs and panels, but this log's 3D view
 * (its signals, and its geometry and thrust scaling for the craft the user chose, if this log offers that craft).
 * @param {object|null} saved  a layout file object
 * @param {{viewport: object, crafts: {label: string, viewport: object}[]}} plot  from indiflightPlot()
 */
export function adaptSavedLayout(saved, plot) {
    if (!saved) {
        return null;
    }
    const name = saved.viewport?.craft?.name;
    const choice = plot.crafts.find((c) => c.label === name) ?? plot.crafts[0];
    const own = JSON.parse(JSON.stringify({ ...plot.viewport, ...choice.viewport }));
    return { ...saved, viewport: { ...own, craft: { ...own.craft, name: choice.label } } };
}

/**
 * FlightPlotter options for an Indiflight log.
 * @param {{time: Float64Array, columns: Object<string, ArrayLike<number>>, events: object[]}} si  from flightLogToSI()
 * @param {string[]} modeNames  flight mode name per bit of flightModeFlags
 * @param {Object<string, string>} [headers]  header values the parser doesn't know (extraHeaders()), for the INDI
 *                                            actuator setup
 */
export function indiflightPlot(si, modeNames, headers = {}) {
    const { time, columns } = si;
    const craft = detectCraft(columns, headers);
    const crafts = craftChoices(columns, craft);
    const descriptions = addDerived(time, columns, craft.Ns);
    const events = [...si.events];
    if (columns.flightModeFlags) {
        events.push(...bitChangeEvents(time, columns.flightModeFlags, modeNames));
    }
    return {
        craft,
        data: { time, columns, events, descriptions },
        panels: panels(columns, craft),
        viewport: { ...viewport(columns), ...crafts[0].viewport },
        crafts,
    };
}
