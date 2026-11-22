/**
 * Crafts for the Flight Plotter's 3D view, and which logged signals drive each drawn rotor.
 *
 * Logged motor k (`motor[k]`) is the k-th INDI actuator flagged as a motor, in INDI or Betaflight mixer order
 * and never in physical output order: `motor_output_reordering` only remaps output pins and isn't logged.
 * The mixer type and `yaw_motors_reversed` aren't logged either, so the Betaflight presets come in props-in and
 * props-out variants and the user picks. The only geometry in the header is the INDI effectiveness matrix
 * (`indi_act_g1_*`), but the firmware writes only its first 4 actuators.
 *
 * Craft3D's body frame is FRD (x forward, y right, z down). Spin is seen from above.
 */
import { Craft3D, noseArrow, tailsitter } from "flightplotter";

const ARM = 0.3;
const PROP = 0.1;

/**
 * Betaflight mixer tables (mixer_init.c): per motor [azimuth in deg clockwise from the nose, spin with props in,
 * level: 0 flat, -1 top / 1 bottom of a coaxial pair].
 */
const BETAFLIGHT = [
    {
        id: "quadx",
        name: "Quad X",
        rotors: [
            [135, "cw"],
            [45, "ccw"],
            [225, "ccw"],
            [315, "cw"],
        ],
    },
    {
        id: "hex6x",
        name: "Hex X",
        rotors: [
            [150, "ccw"],
            [30, "ccw"],
            [210, "cw"],
            [330, "cw"],
            [90, "cw"],
            [270, "ccw"],
        ],
    },
    {
        id: "hex6p",
        name: "Hex + (HEX6)",
        rotors: [
            [120, "ccw"],
            [60, "cw"],
            [240, "ccw"],
            [300, "cw"],
            [0, "ccw"],
            [180, "cw"],
        ],
    },
    {
        id: "octoflatx",
        name: "Octo flat X",
        rotors: [
            [292.5, "ccw"],
            [22.5, "ccw"],
            [112.5, "ccw"],
            [202.5, "ccw"],
            [337.5, "cw"],
            [67.5, "cw"],
            [157.5, "cw"],
            [247.5, "cw"],
        ],
    },
    {
        id: "octox8",
        name: "Octo X8 (coaxial)",
        rotors: [
            [135, "cw", -1],
            [45, "ccw", -1],
            [225, "ccw", -1],
            [315, "cw", -1],
            [135, "ccw", 1],
            [45, "cw", 1],
            [225, "cw", 1],
            [315, "ccw", 1],
        ],
    },
];

const flip = (spin) => ({ cw: "ccw", ccw: "cw" })[spin];

/** @param {{xyz: number[], spin?: string}[]} rotors */
function buildCraft(name, rotors) {
    const c = new Craft3D([noseArrow(ARM / 2)], name);
    for (const r of rotors) {
        c.addRotor({ xyz: r.xyz, axis: [0, 0, -1], R: PROP, spin: r.spin });
    }
    return c;
}

const atAzimuth = (deg, level = 0) => {
    const a = (deg * Math.PI) / 180;
    return [ARM * Math.cos(a), ARM * Math.sin(a), level * 0.05];
};

/** "H name:value" lines the parser doesn't know, as {name: value} */
export function extraHeaders(sysConfig) {
    return Object.fromEntries((sysConfig?.unknownHeaders ?? []).map((h) => [h.name, h.value]));
}

const intList = (s) => (s == null ? null : String(s).split(",").map(Number));

/**
 * The INDI actuator setup from the header.
 * @returns {{actNum: number, motorActs: number[], servoActs: number[], g1: {roll, pitch, yaw}|null, tailsitter: boolean}}
 */
export function indiActuators(headers, nMotor) {
    const actNum = +headers.indi_act_num || 0;
    let isMotor = intList(headers.indi_act_is_motor);
    let isServo = intList(headers.indi_act_is_servo);
    // older firmware: indi_act_type, 1 motor, 2 servo
    const type = intList(headers.indi_act_type);
    if (!isMotor && type) {
        isMotor = type.map((t) => (t === 1 ? 1 : 0));
        isServo = type.map((t) => (t === 2 ? 1 : 0));
    }
    const tailsitter = headers.indi_tails_use_scheduled === "1";
    if (tailsitter) {
        // the firmware forces actuators 0, 1 to motors and 2, 3 to servos
        isMotor = [1, 1, 0, 0];
        isServo = [0, 0, 1, 1];
    }
    // the header lists at most 4 actuators per array; assume the rest are motors
    const flag = (list, i, dflt) => (list && i < list.length ? !!list[i] : dflt);
    const motorActs = [];
    const servoActs = [];
    for (let i = 0; i < Math.max(actNum, nMotor); i++) {
        if (flag(isMotor, i, true) && motorActs.length < nMotor) {
            motorActs.push(i);
        } else if (flag(isServo, i, false)) {
            servoActs.push(i);
        }
    }
    const roll = intList(headers.indi_act_g1_roll);
    const pitch = intList(headers.indi_act_g1_pitch);
    const yaw = intList(headers.indi_act_g1_yaw);
    return { actNum, motorActs, servoActs, g1: roll && pitch && yaw ? { roll, pitch, yaw } : null, tailsitter };
}

/**
 * Rotor geometry from the INDI G1 matrix, for the motors the header covers (the first ones; the firmware writes
 * at most 4 actuators). g1_pitch ∝ x·T/Iyy and g1_roll ∝ -y·T/Ixx, so with Ixx ≈ Iyy their ratio gives the
 * rotor's direction; g1_yaw < 0 means it spins clockwise. Null without usable G1 values.
 */
function indiRotors(act) {
    const { g1 } = act;
    const covered = g1
        ? act.motorActs.filter((a) => a < g1.roll.length && a < g1.pitch.length && a < g1.yaw.length)
        : [];
    const motorActs = act.motorActs.slice(0, covered.length);
    if (!motorActs.length) {
        return null;
    }
    const raw = motorActs.map((a) => [g1.pitch[a], -g1.roll[a]]);
    const scale = Math.max(...raw.map(([x, y]) => Math.hypot(x, y)));
    if (!(scale > 0)) {
        return null;
    }
    return motorActs.map((a, k) => {
        const yaw = g1.yaw[a] ?? 0;
        return {
            xyz: [(ARM * raw[k][0]) / scale, (ARM * raw[k][1]) / scale, 0],
            spin: yaw < 0 ? "cw" : yaw > 0 ? "ccw" : undefined,
        };
    });
}

/**
 * Craft from the log: motor count from the logged fields, INDI actuator setup from the header.
 * `type` keys the user's saved layouts.
 * @returns {{type: string, Nr: number, Ns: number, act: object}}
 */
export function detectCraft(columns, headers = {}) {
    let nMotor = 0;
    while (columns[`motor[${nMotor}]`]) {
        nMotor++;
    }
    const act = indiActuators(headers, nMotor);
    if (act.tailsitter || (nMotor === 2 && columns["u[3]"])) {
        return { type: "tailsitter", Nr: 2, Ns: 2, act: { ...act, motorActs: [0, 1], servoActs: [2, 3] } };
    }
    const type = { 4: "quadrotor", 6: "hexarotor", 8: "octorotor" }[nMotor] ?? `multirotor${nMotor}`;
    return { type, Nr: Math.max(1, nMotor), Ns: 0, act };
}

/**
 * The signals offered in the 3D view's rotor signal selector, default first: motor speeds (omegaUnfiltered, with
 * omegaSp as setpoint), commands (u_state, with the motor outputs as setpoint), or INDI commands (u_state, with u as
 * setpoint). Speeds are the default when the log has both of them, else the motor outputs. Rotor k is the k-th INDI motor actuator, and motor[k] the k-th motor output.
 * @param {object} columns  SI columns
 * @param {{act: object}} detected  from detectCraft()
 * @returns {{label: string, viewport: {rotor: Array, rotorSet: Array}}[]}
 */
export function signalChoices(columns, { act }) {
    const motors = act.motorActs;
    const all = (name) => motors.length > 0 && motors.every((a) => columns[`${name}[${a}]`]);
    // the 3D view expects thrust in 0..1: speeds relative to the fastest motor, filtered so spikes don't count
    let omegaMax = 0;
    const src = all("omega") ? "omega" : "omegaUnfiltered";
    for (const a of motors) {
        for (const v of columns[`${src}[${a}]`] ?? []) {
            if (v > omegaMax) {
                omegaMax = v;
            }
        }
    }
    const k = 1 / (omegaMax + 1e-6);
    const speeds = {
        label: "Speeds: omegaUnfiltered, omegaSp",
        viewport: {
            rotor: motors.map((a) => [`omegaUnfiltered[${a}]`, k]),
            rotorSet: motors.map((a) => (columns[`omegaSp[${a}]`] ? [`omegaSp[${a}]`, k] : null)),
        },
    };
    const commands = {
        label: "Commands: u_state, motor",
        viewport: { rotor: motors.map((a) => `u_state[${a}]`), rotorSet: motors.map((_, i) => `motor[${i}]`) },
    };
    const indi = {
        label: "Commands: u_state, u",
        viewport: { rotor: motors.map((a) => `u_state[${a}]`), rotorSet: motors.map((a) => `u[${a}]`) },
    };
    if (!all("omegaUnfiltered")) {
        return [commands, indi];
    }
    return all("omegaSp") ? [speeds, commands, indi] : [commands, indi, speeds];
}

/**
 * The crafts offered in the 3D view's selector, default first, each as the part of the viewport spec that
 * depends on the craft: geometry and the signals driving its surfaces. Rotor signals come from signalChoices().
 * @param {object} columns  SI columns
 * @param {{type: string, Nr: number, Ns: number, act: object}} detected  from detectCraft()
 * @returns {{label: string, viewport: object}[]}
 */
export function craftChoices(columns, detected) {
    const { Nr, Ns, act } = detected;
    const choice = (label, craft, extra = {}) => ({ label, viewport: { craft, ...extra } });

    if (detected.type === "tailsitter") {
        const craft = tailsitter();
        craft.name = "Tailsitter";
        return [
            choice("Tailsitter", craft, {
                surface: Ns ? act.servoActs.map((_, s) => `servo_feedback[${s}]`) : undefined,
                surfaceSet: act.servoActs.map((a) => [`u[${a}]`, (100 * Math.PI) / 180]),
            }),
        ];
    }
    const out = [];
    const indi = indiRotors(act);
    if (indi?.length === Nr) {
        out.push(choice("From INDI config (log header)", buildCraft("From INDI config (log header)", indi)));
    }
    for (const bf of BETAFLIGHT.filter((m) => m.rotors.length === Nr)) {
        for (const propsOut of [false, true]) {
            const label = `${bf.name}, Betaflight order, props ${propsOut ? "out" : "in"}`;
            const rotors = bf.rotors.map(([az, spin, level]) => ({
                xyz: atAzimuth(az, level),
                spin: propsOut ? flip(spin) : spin,
            }));
            out.push(choice(label, buildCraft(label, rotors)));
        }
    }
    for (const [label, az] of [
        [`Ring of ${Nr}, clockwise from front right`, (k) => (Nr > 1 ? 180 / Nr : 0) + (360 * k) / Nr],
        [`Ring of ${Nr}, counter-clockwise from the front`, (k) => -(360 * k) / Nr],
    ]) {
        const rotors = Array.from({ length: Nr }, (_, k) => ({ xyz: atAzimuth(az(k)) }));
        // spin alternates around a ring; the header can tell which way the first one turns
        if (indi?.[0]?.spin) {
            rotors.forEach((r, k) => (r.spin = k % 2 ? flip(indi[0].spin) : indi[0].spin));
        }
        out.push(choice(label, buildCraft(label, rotors)));
    }
    if (indi && indi.length < Nr) {
        // partial header: the best match for the rotors it covers goes first (stable sort keeps ties in order)
        const score = (c) =>
            c.viewport.craft.rotors.slice(0, indi.length).reduce((n, r, k) => n + rotorMatch(r, indi[k]), 0);
        out.sort((a, b) => score(b) - score(a));
    }
    return out;
}

/** 0..2: same direction from the centre (within 20°), and same spin */
function rotorMatch(r, ref) {
    const ang = (xyz) => Math.atan2(xyz[1], xyz[0]);
    let d = Math.abs(ang(r.xyz) - ang(ref.xyz)) % (2 * Math.PI);
    d = Math.min(d, 2 * Math.PI - d);
    const dir = d < (20 * Math.PI) / 180 ? 1 : 0;
    return dir + (dir && ref.spin && r.spin === ref.spin ? 1 : 0);
}
