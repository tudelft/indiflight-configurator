<template>
    <UiBox :title="t('indiConfigCalcTitle')" :help="t('indiConfigCalcHelp')" collapsible :default-open="false">
        <div class="flex flex-col gap-4">
            <!-- Layout preset -->
            <div class="flex flex-wrap items-end gap-3">
                <label class="flex flex-col gap-1 text-xs">
                    {{ t("indiConfigCalcPreset") }}
                    <USelect v-model="presetId" :items="presetItems" size="xs" class="w-44" />
                </label>
                <label class="flex flex-col gap-1 text-xs">
                    {{ t("indiConfigCalcArmLength") }} [mm]
                    <UInputNumber
                        v-model="armLengthMm"
                        :min="1"
                        :step="1"
                        size="xs"
                        class="w-24"
                        :increment="false"
                        :decrement="false"
                    />
                </label>
                <label class="flex items-center gap-2 text-xs pb-1">
                    <USwitch v-model="propsOut" size="xs" />
                    {{ t("indiConfigCalcPropsOut") }}
                </label>
                <UButton
                    size="xs"
                    color="neutral"
                    variant="outline"
                    :label="t('indiConfigCalcFillRotors')"
                    @click="fillRotors"
                />
            </div>

            <!-- Airframe and rotor constants -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <label v-for="p in constants" :key="p.key" class="flex flex-col gap-1 text-xs">
                    <span>
                        {{ t(p.label) }} <span class="text-dimmed">[{{ p.unit }}]</span>
                    </span>
                    <UInputNumber
                        v-model="airframe[p.key]"
                        :min="0"
                        :step="p.step"
                        :format-options="{ maximumFractionDigits: p.decimals, useGrouping: false }"
                        size="xs"
                        :increment="false"
                        :decrement="false"
                    />
                </label>
            </div>

            <!-- Rotors -->
            <div class="overflow-x-auto">
                <table class="text-xs border-separate border-spacing-x-1 border-spacing-y-0.5">
                    <thead>
                        <tr class="text-dimmed">
                            <th class="font-normal text-left"></th>
                            <th class="font-normal">x [mm]</th>
                            <th class="font-normal">y [mm]</th>
                            <th class="font-normal">z [mm]</th>
                            <th class="font-normal">{{ t("indiConfigCalcSpin") }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(r, i) in rotors" :key="i">
                            <td class="pr-2 whitespace-nowrap">{{ t("indiConfigActuatorN", { n: i + 1 }) }}</td>
                            <td v-for="k in 3" :key="k" class="w-20">
                                <UInputNumber
                                    v-model="r.posMm[k - 1]"
                                    :step="1"
                                    size="xs"
                                    :increment="false"
                                    :decrement="false"
                                    :aria-label="`${'xyz'[k - 1]} ${t('indiConfigActuatorN', { n: i + 1 })}`"
                                />
                            </td>
                            <td class="w-24">
                                <USelect v-model="r.spin" :items="spinItems" size="xs" class="w-full" />
                            </td>
                            <td>
                                <UButton
                                    icon="i-lucide-x"
                                    size="xs"
                                    color="neutral"
                                    variant="ghost"
                                    :aria-label="t('indiConfigCalcRemoveRotor')"
                                    @click="rotors.splice(i, 1)"
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>
                <UButton
                    class="mt-1"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-plus"
                    :label="t('indiConfigCalcAddRotor')"
                    :disabled="rotors.length >= maxActuators"
                    @click="rotors.push({ posMm: [0, 0, 0], spin: 'cw' })"
                />
            </div>

            <!-- Result -->
            <UAlert v-if="result.error" color="error" variant="subtle" :description="result.error" />
            <template v-else>
                <div class="flex flex-col gap-1 text-xs">
                    <span :class="result.hover.controllable ? 'text-success' : 'text-error'">
                        {{
                            result.hover.controllable
                                ? t("indiConfigCalcControllable")
                                : t("indiConfigCalcNotControllable")
                        }}
                    </span>
                    <span
                        v-if="result.hover.controllable"
                        :class="result.hover.canHover ? 'text-success' : 'text-error'"
                    >
                        {{
                            result.hover.canHover
                                ? t("indiConfigCalcHover", {
                                      tw: result.hover.thrustToWeight.toFixed(2),
                                      u: hoverRange,
                                  })
                                : t("indiConfigCalcNoHover")
                        }}
                    </span>
                    <span v-if="result.clamped.length" class="text-warning">
                        {{ t("indiConfigCalcClamped", { names: result.clamped.join(", ") }) }}
                    </span>
                </div>

                <div class="flex flex-wrap items-center gap-4 text-xs">
                    <label class="flex items-center gap-2">
                        <USwitch v-model="alsoActuators" size="xs" />
                        {{ t("indiConfigCalcAlsoActuators", { n: rotors.length }) }}
                    </label>
                    <label class="flex items-center gap-2">
                        <USwitch v-model="alsoHoverRpm" size="xs" :disabled="!result.hover.canHover" />
                        {{ t("indiConfigCalcAlsoHoverRpm") }}
                    </label>
                    <UButton size="sm" :label="t('indiConfigCalcApply')" :disabled="!rotors.length" @click="apply" />
                </div>
            </template>
        </div>
    </UiBox>
</template>

<script setup>
import { computed, reactive, ref } from "vue";
import { useTranslation } from "i18next-vue";
import UiBox from "@/components/elements/UiBox.vue";
import {
    PRESETS,
    calculateG1G2,
    checkHover,
    effectivenessToSettings,
    presetRotors,
    rpmAtCommand,
} from "@/js/indiflight/indiEffectiveness";

const props = defineProps({
    /** Length of the per-actuator settings on this firmware */
    maxActuators: { type: Number, required: true },
    /** indi_act_max_rpm as configured, for the hover rpm */
    maxRpm: { type: Array, default: () => [] },
});
/** apply(values): settings to merge into the form */
const emit = defineEmits(["apply"]);
const { t } = useTranslation();

const presetId = ref("quadx");
const armLengthMm = ref(100);
const propsOut = ref(false);
const presetItems = PRESETS.map((p) => ({ value: p.id, label: p.name }));
const spinItems = computed(() => [
    { value: "cw", label: t("indiConfigCalcSpinCw") },
    { value: "ccw", label: t("indiConfigCalcSpinCcw") },
]);

// Defaults: a 5" quad of about 500 g
const airframe = reactive({
    mass: 0.5,
    ixx: 0.0012,
    iyy: 0.0012,
    izz: 0.0022,
    maxThrust: 9,
    torqueCoef: 0.012,
    rotorInertia: 2e-6,
});
const constants = [
    { key: "mass", label: "indiConfigCalcMass", unit: "kg", step: 0.01, decimals: 3 },
    { key: "ixx", label: "indiConfigCalcIxx", unit: "kg·m²", step: 1e-5, decimals: 6 },
    { key: "iyy", label: "indiConfigCalcIyy", unit: "kg·m²", step: 1e-5, decimals: 6 },
    { key: "izz", label: "indiConfigCalcIzz", unit: "kg·m²", step: 1e-5, decimals: 6 },
    { key: "maxThrust", label: "indiConfigCalcMaxThrust", unit: "N", step: 0.1, decimals: 2 },
    { key: "torqueCoef", label: "indiConfigCalcTorqueCoef", unit: "m", step: 0.001, decimals: 4 },
    { key: "rotorInertia", label: "indiConfigCalcRotorInertia", unit: "kg·m²", step: 1e-7, decimals: 9 },
];

const rotors = ref([]);

function fillRotors() {
    rotors.value = presetRotors(presetId.value, { armLength: armLengthMm.value / 1000, propsOut: propsOut.value })
        .slice(0, props.maxActuators)
        .map((r) => ({ posMm: r.pos.map((v) => Math.round(v * 10000) / 10), spin: r.spin }));
}
fillRotors();

const result = computed(() => {
    try {
        const eff = calculateG1G2({
            mass: airframe.mass,
            inertia: [airframe.ixx, airframe.iyy, airframe.izz],
            rotors: rotors.value.map((r) => ({
                pos: r.posMm.map((v) => (v ?? 0) / 1000),
                spin: r.spin,
                maxThrust: airframe.maxThrust,
                torqueCoef: airframe.torqueCoef,
                inertia: airframe.rotorInertia,
            })),
        });
        const { values, clamped } = effectivenessToSettings(eff);
        return { values, clamped, hover: checkHover(eff), error: null };
    } catch (e) {
        return { error: e.message };
    }
});

const hoverRange = computed(() => {
    const u = result.value.hover?.hoverCommands ?? [];
    const pct = (v) => `${Math.round(v * 100)} %`;
    const lo = Math.min(...u);
    const hi = Math.max(...u);
    return hi - lo < 0.005 ? pct(lo) : `${pct(lo)} … ${pct(hi)}`;
});

const alsoActuators = ref(true);
const alsoHoverRpm = ref(true);

function apply() {
    const n = rotors.value.length;
    const values = { ...result.value.values };
    if (alsoActuators.value) {
        values.indi_act_num = n;
        values.indi_act_type = new Array(n).fill(1);
    }
    if (alsoHoverRpm.value && result.value.hover.canHover) {
        values.indi_act_hover_rpm = result.value.hover.hoverCommands.map((u, i) =>
            Math.round(rpmAtCommand(props.maxRpm[i] ?? 0, u)),
        );
    }
    emit("apply", values);
}
</script>
