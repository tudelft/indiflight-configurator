<template>
    <USwitch
        v-if="kind === 'bool'"
        :model-value="Boolean(modelValue)"
        :disabled="disabled"
        :aria-label="ariaLabel"
        @update:model-value="(on) => emit('update:modelValue', on ? 1 : 0)"
    />
    <USelect
        v-else-if="kind === 'enum'"
        :model-value="modelValue"
        :items="enumItems"
        :disabled="disabled"
        :aria-label="ariaLabel"
        size="xs"
        class="w-full min-w-20"
        @update:model-value="(v) => emit('update:modelValue', v)"
    />
    <UInputNumber
        v-else
        :model-value="shown"
        :min="min"
        :max="max"
        :step="scale"
        :format-options="formatOptions"
        :disabled="disabled"
        :aria-label="ariaLabel"
        :increment="false"
        :decrement="false"
        size="xs"
        class="w-full min-w-16"
        @update:model-value="onNumber"
    />
</template>

<script setup>
import { computed } from "vue";
import { useTranslation } from "i18next-vue";

/** One stored setting value (or one element of an array setting), shown in the field's unit. */
const props = defineProps({
    /** FieldDef from src/js/indiflight/indiSettings.ts */
    field: { type: Object, required: true },
    /** SettingInfo from MSP2_CLI_SETTING_INFO */
    info: { type: Object, required: true },
    modelValue: { type: Number, default: 0 },
    disabled: { type: Boolean, default: false },
    ariaLabel: { type: String, default: undefined },
});
const emit = defineEmits(["update:modelValue"]);
const { t } = useTranslation();

const kind = computed(() => props.field.kind ?? "number");
const scale = computed(() => props.field.scale ?? 1);
const decimals = computed(() => Math.max(0, Math.round(-Math.log10(scale.value))));
const formatOptions = computed(() => ({ maximumFractionDigits: decimals.value, useGrouping: false }));
const round = (v) => Number(v.toFixed(decimals.value));

const shown = computed(() => round(props.modelValue * scale.value));
const min = computed(() => (props.info.min === null ? undefined : round(props.info.min * scale.value)));
const max = computed(() => (props.info.max === null ? undefined : round(props.info.max * scale.value)));

const enumItems = computed(() => (props.field.options ?? []).map((o) => ({ value: o.value, label: t(o.label) })));

function onNumber(v) {
    if (v === null || v === undefined || Number.isNaN(v)) {
        return;
    }
    emit("update:modelValue", Math.round(v / scale.value));
}
</script>
