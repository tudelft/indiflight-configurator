import type { FieldDef } from "@/js/indiflight/indiSettings";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const fieldLabelKey = (name: string): string => `indiConfigField_${name}`;
export const fieldHelpKey = (name: string): string => `indiConfigField_${name}Help`;

const AXES = ["indiConfigAxisRoll", "indiConfigAxisPitch", "indiConfigAxisYaw"];
const PSEUDO_CONTROLS = ["fx", "fy", "fz", "indiConfigAxisRoll", "indiConfigAxisPitch", "indiConfigAxisYaw"];

/** Labels of the array elements shown: per-actuator arrays show only the configured actuators. */
export function elementLabelsFor(field: FieldDef, length: number, actNum: number, t: Translate): string[] {
    switch (field.elements) {
        case "axes":
            return AXES.slice(0, length).map((k) => t(k));
        case "pseudoControls":
            return PSEUDO_CONTROLS.slice(0, length).map((k) => (k.startsWith("indi") ? t(k) : k));
        case "actuators":
            return Array.from({ length: Math.min(length, actNum) }, (_, i) => t("indiConfigActuatorN", { n: i + 1 }));
        default:
            return Array.from({ length }, (_, i) => `[${i}]`);
    }
}
