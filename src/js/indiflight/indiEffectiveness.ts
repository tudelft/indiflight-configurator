/**
 * INDI control effectiveness of a multirotor from its geometry, ported from `MultiRotor.calculateG1G2()` in
 * `support/simulation/PyNDIflight/crafts.py` of the firmware repo, plus the conversion to the integer
 * `indi_act_g1_*` / `indi_act_g2_*` settings (scalings from `initIndiRuntimeParameters()` in `indi_init.c`).
 *
 * Body frame is FRD (x forward, y right, z down), so an upright rotor has thrust axis [0, 0, -1]. Spin is seen
 * from above. The drag torque coefficient is signed with the spin: cm < 0 for clockwise rotors.
 *
 * With the normalised command u = T / Tmax, the specific generalised forces A = (fx fy fz | p q r dot) are
 *   ΔA = G1 Δu + G2 Δω̇,   G1 = M⁻¹ B1,  G2 = M⁻¹ B2,  M = diag(m, m, m, Ixx, Iyy, Izz)
 * where B1 holds thrust axes, lever arms and drag torque (scaled by Tmax), and B2 the propeller inertia.
 */
import { BETAFLIGHT_MIXERS, flipSpin } from "./betaflightMixers.js";

export type Vec3 = [number, number, number];
export type Spin = "cw" | "ccw";

export interface Rotor {
    /** Position relative to the centre of gravity [m], FRD */
    pos: Vec3;
    /** Thrust direction, FRD; need not be normalised. Default [0, 0, -1] */
    axis?: Vec3;
    spin: Spin;
    /** Thrust at full command [N] */
    maxThrust: number;
    /** Drag torque per thrust [m], unsigned */
    torqueCoef: number;
    /** Inertia of rotor and propeller about the spin axis [kg m²] */
    inertia: number;
}

export interface Airframe {
    /** [kg] */
    mass: number;
    /** Principal moments of inertia [kg m²]: Ixx, Iyy, Izz. Off-diagonal terms are ignored, as in crafts.py */
    inertia: Vec3;
    rotors: Rotor[];
}

export interface Effectiveness {
    /** 6 x N: rows fx fy fz [N/kg], roll pitch yaw [rad/s²], per unit command */
    G1: number[][];
    /** 6 x N: rows fx fy fz (always 0), roll pitch yaw [-], per rad/s² of rotor acceleration */
    G2: number[][];
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];

function unit(v: Vec3): Vec3 {
    const n = Math.hypot(...v);
    if (!(n > 0)) {
        throw new Error("Rotor thrust axis must not be zero");
    }
    return [v[0] / n, v[1] / n, v[2] / n];
}

export function calculateG1G2(craft: Airframe): Effectiveness {
    const diag = [craft.mass, craft.mass, craft.mass, ...craft.inertia];
    if (!diag.every((d) => d > 0)) {
        throw new Error("Mass and inertia must be positive");
    }
    const N = craft.rotors.length;
    const G1 = Array.from({ length: 6 }, () => new Array<number>(N).fill(0));
    const G2 = Array.from({ length: 6 }, () => new Array<number>(N).fill(0));

    craft.rotors.forEach((r, i) => {
        const ax = unit(r.axis ?? [0, 0, -1]);
        const cm = r.spin === "cw" ? -r.torqueCoef : r.torqueCoef;
        const lever = cross(r.pos, ax);
        for (let k = 0; k < 3; k++) {
            G1[k][i] = (ax[k] * r.maxThrust) / diag[k];
            G1[3 + k][i] = ((lever[k] - cm * ax[k]) * r.maxThrust) / diag[3 + k];
            G2[3 + k][i] = (-Math.sign(cm) * ax[k] * r.inertia) / diag[3 + k];
        }
    });
    return { G1, G2 };
}

/** Setting name, row of G1 or G2, and the factor from SI to the stored integer (indi_init.c divides by it). */
export const EFFECTIVENESS_SETTINGS = [
    { name: "indi_act_g1_fx", matrix: "G1", row: 0, factor: 100 },
    { name: "indi_act_g1_fy", matrix: "G1", row: 1, factor: 100 },
    { name: "indi_act_g1_fz", matrix: "G1", row: 2, factor: 100 },
    { name: "indi_act_g1_roll", matrix: "G1", row: 3, factor: 10 },
    { name: "indi_act_g1_pitch", matrix: "G1", row: 4, factor: 10 },
    { name: "indi_act_g1_yaw", matrix: "G1", row: 5, factor: 10 },
    { name: "indi_act_g2_roll", matrix: "G2", row: 3, factor: 1e5 },
    { name: "indi_act_g2_pitch", matrix: "G2", row: 4, factor: 1e5 },
    { name: "indi_act_g2_yaw", matrix: "G2", row: 5, factor: 1e5 },
] as const;

const INT16_MIN = -32768;
const INT16_MAX = 32767;

/**
 * The G1/G2 settings for N actuators: {name: integer per actuator}. Values beyond int16 are clamped and their
 * setting names returned in `clamped`.
 */
export function effectivenessToSettings(eff: Effectiveness): { values: Record<string, number[]>; clamped: string[] } {
    const values: Record<string, number[]> = {};
    const clamped: string[] = [];
    for (const s of EFFECTIVENESS_SETTINGS) {
        values[s.name] = eff[s.matrix][s.row].map((v) => {
            // Rounded symmetrically, so that mirrored rotors get mirrored values
            const raw = Math.sign(v) * Math.round(Math.abs(v * s.factor));
            const c = Math.min(INT16_MAX, Math.max(INT16_MIN, raw));
            if (c !== raw && !clamped.includes(s.name)) {
                clamped.push(s.name);
            }
            return c === 0 ? 0 : c; // no -0
        });
    }
    return { values, clamped };
}

export interface HoverCheck {
    /** Thrust and all three rotation axes can be commanded independently */
    controllable: boolean;
    /** Least-norm commands that hover with zero moments and no horizontal force from the thrust axis, or null */
    hoverCommands: number[] | null;
    /** The hover commands are all within [0, 1] */
    canHover: boolean;
    /** 1 / largest hover command: how far all commands could be scaled up */
    thrustToWeight: number | null;
}

const GRAVITY = 9.81;

/** Solve A x = b by Gaussian elimination with partial pivoting; null if A is singular. */
function solve(A: number[][], b: number[]): number[] | null {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) {
            if (Math.abs(M[r][c]) > Math.abs(M[p][c])) {
                p = r;
            }
        }
        if (Math.abs(M[p][c]) < 1e-9) {
            return null;
        }
        [M[c], M[p]] = [M[p], M[c]];
        for (let r = c + 1; r < n; r++) {
            const f = M[r][c] / M[c][c];
            for (let k = c; k <= n; k++) {
                M[r][k] -= f * M[c][k];
            }
        }
    }
    const x = new Array<number>(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
        let s = M[r][n];
        for (let k = r + 1; k < n; k++) {
            s -= M[r][k] * x[k];
        }
        x[r] = s / M[r][r];
    }
    return x;
}

/**
 * Stand-in for `checkHover()` in crafts.py. That one searches the rotational nullspace of G1 for the most efficient
 * hover; this solves for the least-norm commands giving fz = -g with zero moments, from the fz, roll, pitch and yaw
 * rows. A craft whose rotors can't separate thrust from yaw (all spinning the same way, say) has no solution.
 */
export function checkHover(eff: Effectiveness): HoverCheck {
    const rows = [eff.G1[2], eff.G1[3], eff.G1[4], eff.G1[5]];
    // Rows are normalised for the solve so that the singularity threshold doesn't depend on units
    const norms = rows.map((row) => Math.hypot(...row));
    const none: HoverCheck = { controllable: false, hoverCommands: null, canHover: false, thrustToWeight: null };
    if (rows[0].length < 4 || norms.some((n) => !(n > 0))) {
        return none;
    }
    const G = rows.map((row, k) => row.map((v) => v / norms[k]));
    const gram = G.map((a) => G.map((b) => a.reduce((s, v, i) => s + v * b[i], 0)));
    const y = solve(gram, [-GRAVITY / norms[0], 0, 0, 0]);
    if (!y) {
        return none;
    }
    const u = G[0].map((_, i) => G.reduce((s, row, k) => s + row[i] * y[k], 0));
    const umax = Math.max(...u);
    return {
        controllable: true,
        hoverCommands: u,
        canHover: u.every((v) => v >= 0 && v <= 1),
        thrustToWeight: umax > 0 ? 1 / umax : null,
    };
}

/** Motor speed at a command, with thrust proportional to speed squared */
export const rpmAtCommand = (maxRpm: number, command: number): number => maxRpm * Math.sqrt(command);

export interface Preset {
    id: string;
    name: string;
    count: number;
}

export const PRESETS: Preset[] = BETAFLIGHT_MIXERS.map((m) => ({ id: m.id, name: m.name, count: m.rotors.length }));

/**
 * Rotor positions and spins of a Betaflight mixer, in its motor order, at `armLength` from the centre.
 * The two rotors of a coaxial pair are `coaxialSpacing` apart.
 */
export function presetRotors(
    id: string,
    {
        armLength,
        propsOut = false,
        coaxialSpacing = 0.05,
    }: { armLength: number; propsOut?: boolean; coaxialSpacing?: number },
): { pos: Vec3; spin: Spin }[] {
    const mixer = BETAFLIGHT_MIXERS.find((m) => m.id === id);
    if (!mixer) {
        throw new Error(`Unknown preset ${id}`);
    }
    return mixer.rotors.map(([azimuth, spin, level = 0]) => {
        const a = (azimuth * Math.PI) / 180;
        const s = spin as Spin;
        return {
            pos: [armLength * Math.cos(a), armLength * Math.sin(a), (level * coaxialSpacing) / 2] as Vec3,
            spin: propsOut ? (flipSpin(s) as Spin) : s,
        };
    });
}
