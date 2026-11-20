/**
 * Scaling of Indiflight-only blackbox fields; must match loadMainState() in Indiflight's blackbox.c.
 * `phys` maps the raw logged value to a physical value; `deg` marks values in degrees (or deg/s, deg/s²),
 * which the presenter shows in the user's angle unit and flightlog_si.js converts to radians.
 * Keyed by field name without the array index.
 */

export const UNIT_FLOAT_TO_SIGNED16VB = (127 << 6) - 1; // values in [-1, 1]
export const UNIT_FLOAT_TO_UNSIGNED16VB = (127 << 7) - 1; // values in [0, 1]

const unitFloat = { phys: (v) => v / UNIT_FLOAT_TO_SIGNED16VB };
const milli = { phys: (v) => v / 1000 };
const centi = { phys: (v) => v / 100 };
const raw = { phys: (v) => v };

export const INDIFLIGHT_FIELDS = {
    quat: unitFloat,
    quatSp: unitFloat,
    ekf_quat: unitFloat,
    extQuat: unitFloat,
    localQuat: unitFloat,
    hoverAttitude: unitFloat,
    u: unitFloat,
    u_state: unitFloat,
    dv: { phys: (v) => v / 10 }, // N/kg for [0..2], Nm/(kg m²) for [3..5]
    alpha: { phys: (v) => v * 10, deg: true },
    alphaSp: { phys: (v) => v * 10, deg: true },
    spfSp: centi,
    omega: raw,
    omegaUnfiltered: raw,
    servo_feedback: { phys: (v) => v / 100, deg: true },
    pitot_pressureZero: centi,
    pitot_pressure: centi,
    pitot_temperature: centi,
    pitot_airSpeed: centi,
    learner_gains: { phys: (v) => v / 10 },
    // modular_drone_learning fork
    quatSpPreFf: unitFloat,
    d: unitFloat,
    rpmCmd_f: unitFloat,
    omegaSp: raw,
    rpmOmega_f: raw,
    omega_dot: { phys: (v) => v * 100 },
    pos: milli,
    posSp: milli,
    extPos: milli,
    localPos: milli,
    ekf_pos: milli,
    vel: centi,
    velSp: centi,
    extVel: centi,
    localVel: centi,
    ekf_vel: centi,
    accSp: centi,
    extTime: milli, // ms
    ekf_acc_b: milli,
    ekf_gyro_b: { phys: (v) => v / 1000, deg: true },
    // legacy Euler attitude fields, logged in mrad
    ekf_att: milli,
    extAtt: milli,
};

const RLS_LAMBDA = { phys: (v) => v / UNIT_FLOAT_TO_UNSIGNED16VB };
const RLS_E_VAR = { phys: (v) => v / (0.001 * 0xffff) };

/**
 * @param {string} fieldName  e.g. "quat[2]" or "fx_q_rls_lambda"
 * @returns {{name: string, index: number, phys: function(number): number, deg?: boolean} | undefined}
 *          undefined if fieldName is not an Indiflight field
 */
export function indiflightField(fieldName) {
    const match = /^(\w+?)(?:\[(\d+)\])?$/.exec(fieldName);
    if (!match) {
        return undefined;
    }
    const name = match[1];
    const index = Number(match[2] ?? 0);
    if (Object.hasOwn(INDIFLIGHT_FIELDS, name)) {
        return { name, index, ...INDIFLIGHT_FIELDS[name] };
    }
    // learner RLS diagnostics: motor_N_rls_*, fx_<axis>_rls_*
    if (name.endsWith("_rls_lambda")) {
        return { name, index, ...RLS_LAMBDA };
    }
    if (name.endsWith("_rls_e_var")) {
        return { name, index, ...RLS_E_VAR };
    }
    return undefined;
}
