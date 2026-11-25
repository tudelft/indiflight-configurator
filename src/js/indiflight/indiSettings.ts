/**
 * The INDI profile settings the INDI tab shows, grouped as on screen. Names, ranges and array lengths come from the
 * firmware (`indi_*` in cli/settings.c, read over MSP2_CLI_SETTING_INFO); a setting the connected firmware doesn't
 * have is left out. `scale` turns the stored integer into the unit shown (from `initIndiRuntimeParameters()` in
 * indi_init.c).
 */

export type FieldKind = "number" | "bool" | "enum";

/** How the elements of an array setting are labelled: per axis, per WLS pseudo-control, per actuator, by index */
export type ElementLabels = "axes" | "pseudoControls" | "actuators" | "index";

export interface FieldDef {
    name: string;
    kind?: FieldKind;
    /** Shown value = stored value * scale */
    scale?: number;
    unit?: string;
    /** For "enum": stored value -> i18n key */
    options?: { value: number; label: string }[];
    elements?: ElementLabels;
    /** Expert-mode only */
    expert?: boolean;
}

export interface GroupDef {
    id: string;
    fields: FieldDef[];
    /** The setting that switches the group on; the group's other fields are dimmed while it is off */
    enable?: string;
    expert?: boolean;
}

export const ACTUATOR_TYPES = [
    { value: 0, label: "indiConfigActTypeOff" },
    { value: 1, label: "indiConfigActTypeMotor" },
    { value: 2, label: "indiConfigActTypeServo" },
];

export const CONTROLLER_GROUPS: GroupDef[] = [
    {
        id: "gains",
        fields: [
            { name: "indi_attitude_gains", scale: 0.1, unit: "1/s²", elements: "axes" },
            { name: "indi_rate_gains", scale: 0.1, unit: "1/s", elements: "axes" },
        ],
    },
    {
        id: "rateLimits",
        fields: [
            { name: "indi_attitude_max_tilt_rate", unit: "°/s" },
            { name: "indi_attitude_max_yaw_rate", unit: "°/s" },
            { name: "indi_max_rate_setpoint", unit: "°/s", elements: "axes" },
        ],
    },
    {
        id: "manual",
        fields: [
            { name: "indi_manual_use_coordinated_yaw", kind: "bool" },
            { name: "indi_manual_max_upwards_accel", unit: "m/s²" },
            { name: "indi_manual_max_tilt", unit: "°" },
        ],
    },
    {
        id: "indi",
        fields: [
            { name: "indi_use_increment", kind: "bool" },
            { name: "indi_use_accel_for_thrust", kind: "bool" },
            { name: "indi_use_rpm_dot_feedback", kind: "bool" },
            { name: "indi_sync_lowpass_hz", unit: "Hz" },
        ],
    },
    {
        id: "wls",
        fields: [{ name: "indi_wls_axes_weights", elements: "pseudoControls" }],
    },
];

/** One row per setting, one column per actuator */
export const ACTUATOR_ROWS: { id: string; fields: FieldDef[] }[] = [
    {
        id: "actuator",
        fields: [
            { name: "indi_act_type", kind: "enum", options: ACTUATOR_TYPES },
            { name: "indi_act_time_constant_ms", unit: "ms" },
            { name: "indi_act_max_rpm", unit: "rpm" },
            { name: "indi_act_hover_rpm", unit: "rpm" },
            { name: "indi_act_nonlinearity", unit: "%" },
            { name: "indi_act_min", unit: "%" },
            { name: "indi_act_max", unit: "%" },
        ],
    },
    {
        id: "g1",
        fields: [
            { name: "indi_act_g1_fx", scale: 0.01, unit: "N/kg" },
            { name: "indi_act_g1_fy", scale: 0.01, unit: "N/kg" },
            { name: "indi_act_g1_fz", scale: 0.01, unit: "N/kg" },
            { name: "indi_act_g1_roll", scale: 0.1, unit: "rad/s²" },
            { name: "indi_act_g1_pitch", scale: 0.1, unit: "rad/s²" },
            { name: "indi_act_g1_yaw", scale: 0.1, unit: "rad/s²" },
        ],
    },
    {
        id: "g2",
        fields: [
            { name: "indi_act_g2_roll", scale: 1e-5 },
            { name: "indi_act_g2_pitch", scale: 1e-5 },
            { name: "indi_act_g2_yaw", scale: 1e-5 },
        ],
    },
    {
        id: "allocation",
        fields: [{ name: "indi_wls_act_penalties" }, { name: "indi_wls_act_preferred_state", unit: "%" }],
    },
];

export const ADVANCED_GROUPS: GroupDef[] = [
    {
        id: "rpmCtl",
        enable: "indi_use_rpm_ctl",
        fields: [
            { name: "indi_rpm_ctl_gain", scale: 0.1 },
            { name: "indi_rpm_ctl_delay" },
            { name: "indi_rpm_ctl_lpf_hz", unit: "Hz" },
        ],
    },
    {
        id: "motorLeadLag",
        enable: "indi_use_motor_lead_lag",
        fields: [
            { name: "indi_act_time_constant_true_ms", unit: "ms", elements: "actuators" },
            { name: "indi_act_time_constant_des_ms", unit: "ms", elements: "actuators" },
        ],
    },
    {
        id: "feedforward",
        fields: [
            { name: "indi_ff_coefs", elements: "index" },
            { name: "indi_use_ff_filter", kind: "bool" },
            { name: "indi_ff_filter_coefs", elements: "index" },
        ],
    },
    {
        id: "attLeadLag",
        enable: "indi_use_attitude_lead_lag",
        fields: [
            { name: "indi_attitude_coefs", elements: "index" },
            { name: "indi_rate_coefs", elements: "index" },
        ],
    },
    {
        id: "gainScheduling",
        enable: "indi_use_gain_scheduling",
        fields: [{ name: "indi_gain_scheduling_type" }, { name: "indi_gain_schedule_ff", kind: "bool" }],
    },
    {
        id: "spInjection",
        enable: "indi_inject_attitude_setpoints",
        expert: true,
        fields: [
            { name: "indi_att_sp_injection_type" },
            { name: "indi_att_sp_injection_amplitude", scale: 0.1, unit: "°" },
            { name: "indi_att_sp_injection_duration", unit: "ms" },
            { name: "indi_att_sp_injection_duration_down", unit: "ms" },
        ],
    },
    {
        id: "inputDist",
        enable: "indi_inject_input_dist",
        expert: true,
        fields: [
            { name: "indi_input_dist_amplitude", unit: "%" },
            { name: "indi_apply_dist_to_motor", kind: "bool", elements: "actuators" },
        ],
    },
    {
        id: "tailsitter",
        enable: "indi_tails_use_scheduled",
        expert: true,
        fields: [
            { name: "indi_tails_use_sine", kind: "bool" },
            { name: "indi_tails_d0", elements: "index" },
            { name: "indi_tails_cxw", elements: "index" },
            { name: "indi_tails_cyw", elements: "index" },
            { name: "indi_tails_czw", elements: "index" },
            { name: "indi_tails_clw", elements: "index" },
            { name: "indi_tails_cmw", elements: "index" },
            { name: "indi_tails_cnw", elements: "index" },
            { name: "indi_tails_cnwd", elements: "index" },
            { name: "indi_tails_cxd", elements: "index" },
            { name: "indi_tails_cmd", elements: "index" },
            { name: "indi_tails_cnd", elements: "index" },
        ],
    },
];

export const ACT_NUM = "indi_act_num";

/** Every setting the tab reads, in load order */
export const ALL_SETTING_NAMES: string[] = [
    ACT_NUM,
    ...CONTROLLER_GROUPS.flatMap((g) => g.fields.map((f) => f.name)),
    ...ACTUATOR_ROWS.flatMap((g) => g.fields.map((f) => f.name)),
    ...ADVANCED_GROUPS.flatMap((g) => [...(g.enable ? [g.enable] : []), ...g.fields.map((f) => f.name)]),
];
