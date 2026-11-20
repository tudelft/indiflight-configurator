/**
 * Fixed Flight Plotter layout for Indiflight logs: the panels and 3D view of flightPlotter.py
 * (IndiflightPlotter / IndiflightViewport in the firmware repo's support/LogAnalysis), on the SI
 * columns from flightLogToSI().
 */
import {
    Craft3D,
    bitChangeEvents,
    derivative,
    lowpassFiltfilt,
    multirotor,
    noseArrow,
    quadrotor,
    rotateByQuaternion,
    sampleRate,
    tailsitter,
} from "flightplotter";

/** flightPlotter.py's Hexarotor */
function hexarotor(l = 0.4, R = 0.1) {
    const r = l / 2;
    const s = 0.8660254037844386;
    const c = new Craft3D([noseArrow(l)]);
    for (const xyz of [
        [r, 0, 0],
        [0.5 * r, s * r, 0],
        [-0.5 * r, s * r, 0],
        [-r, 0, 0],
        [-0.5 * r, -s * r, 0],
        [0.5 * r, -s * r, 0],
    ]) {
        c.addRotor({ xyz, axis: [0, 0, -1], R });
    }
    return c;
}

const count = (columns, name) => {
    let i = 0;
    while (columns[`${name}[${i}]`]) {
        i++;
    }
    return i;
};

/**
 * Craft from the number of logged motors: 2 tailsitter (2 rotors, 2 servos), 4 quad, 6 hex.
 * @returns {{type: string, Nr: number, Ns: number, craft: Craft3D}}
 */
export function detectCraft(columns) {
    const nMotor = count(columns, "motor");
    if (nMotor === 2 && count(columns, "u") >= 4) {
        return { type: "tailsitter", Nr: 2, Ns: 2, craft: tailsitter() };
    }
    if (nMotor === 6) {
        return { type: "hexarotor", Nr: 6, Ns: 0, craft: hexarotor() };
    }
    if (nMotor === 4) {
        return { type: "quadrotor", Nr: 4, Ns: 0, craft: quadrotor() };
    }
    return { type: "multirotor", Nr: Math.max(1, nMotor), Ns: 0, craft: multirotor(Math.max(1, nMotor)) };
}

const vec = (columns, name, n = 3) => {
    const a = [];
    for (let i = 0; i < n; i++) {
        a.push(columns[`${name}[${i}]`]);
    }
    return a.every(Boolean) ? a : null;
};

/** the signals IndiflightPlotter computes: body velocities, inertial acceleration, servo derivatives */
function addDerived(time, columns, Ns) {
    const quat = vec(columns, "quat", 4);
    if (quat) {
        for (const [src, dst] of [
            ["vel", "velB"],
            ["localVel", "localVelB"],
            ["velSp", "velSpB"],
        ]) {
            const v = vec(columns, src);
            if (v) {
                rotateByQuaternion(quat, v, true).forEach((a, i) => (columns[`${dst}[${i}]`] = a));
            }
        }
        const acc = vec(columns, "accSmooth");
        if (acc) {
            const accI = rotateByQuaternion(quat, acc, false);
            for (let i = 0; i < accI[2].length; i++) {
                accI[2][i] += 9.81;
            }
            accI.forEach((a, i) => (columns[`accI[${i}]`] = a));
        }
    }
    const servo = Ns > 0 ? vec(columns, "servo_feedback", Ns) : null;
    if (servo) {
        const fs = sampleRate(time);
        servo.forEach((y, i) => {
            const f = lowpassFiltfilt(y, fs, 20);
            columns[`servoDot[${i}]`] = derivative(time, f, 1);
            columns[`servoDotDot[${i}]`] = derivative(time, f, 2);
        });
    }
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

/** IndiflightPlotter._populate */
function panels(columns, Nr, Ns) {
    const N = Nr + Ns;
    const has = (c) => !!columns[c];
    const motors = range(0, Nr);
    const servos = range(Nr, N);
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
                motors.map((i) => `Motor ${i + 1}`),
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

/** IndiflightViewport */
function viewport(columns, { craft, Nr, Ns }) {
    const refs = (name, n) => (vec(columns, name, n) ? range(0, n).map((i) => `${name}[${i}]`) : undefined);
    let omegaMax = 0;
    for (let i = 0; i < Nr; i++) {
        for (const v of columns[`omega[${i}]`] ?? []) {
            if (v > omegaMax) {
                omegaMax = v;
            }
        }
    }
    return {
        craft,
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
        rotor: range(0, Nr).map((i) => [`omega[${i}]`, 1 / (omegaMax + 1e-6)]), // normalized for visualization
        rotorSet: range(0, Nr).map((i) => `u[${i}]`),
        surface: Ns ? refs("servo_feedback", Ns) : undefined,
        surfaceSet: Ns ? range(Nr, Nr + Ns).map((i) => [`u[${i}]`, (100 * Math.PI) / 180]) : undefined,
        interpolation: "previous",
    };
}

/**
 * FlightPlotter options for an Indiflight log.
 * @param {{time: Float64Array, columns: Object<string, ArrayLike<number>>, events: object[]}} si  from flightLogToSI()
 * @param {string[]} modeNames  flight mode name per bit of flightModeFlags
 */
export function indiflightPlot(si, modeNames) {
    const { time, columns } = si;
    const craft = detectCraft(columns);
    addDerived(time, columns, craft.Ns);
    const events = [...si.events];
    if (columns.flightModeFlags) {
        events.push(...bitChangeEvents(time, columns.flightModeFlags, modeNames));
    }
    return {
        craft,
        data: { time, columns, events },
        panels: panels(columns, craft.Nr, craft.Ns),
        viewport: viewport(columns, craft),
    };
}
