<template>
    <div class="overflow-x-auto">
        <table class="w-full text-xs border-separate border-spacing-x-1 border-spacing-y-0.5">
            <thead>
                <tr>
                    <th class="text-left font-normal text-dimmed"></th>
                    <th v-for="i in columns" :key="i" class="font-semibold text-center min-w-20">
                        {{ t("indiConfigActuatorN", { n: i }) }}
                    </th>
                </tr>
            </thead>
            <tbody v-for="section in sections" :key="section.id">
                <tr>
                    <td :colspan="columns + 1" class="pt-3 pb-1 font-semibold">
                        {{ t(`indiConfigActGroup_${section.id}`) }}
                        <HelpIcon
                            v-if="i18next.exists(`indiConfigActGroup_${section.id}Help`)"
                            :text="t(`indiConfigActGroup_${section.id}Help`)"
                            class="inline-block align-middle"
                        />
                    </td>
                </tr>
                <tr v-for="field in section.fields" :key="field.name">
                    <td class="whitespace-nowrap pr-2">
                        <span>{{ fieldLabel(field) }}</span>
                        <span v-if="field.unit" class="text-dimmed ml-1">[{{ field.unit }}]</span>
                        <HelpIcon
                            v-if="i18next.exists(fieldHelpKey(field.name))"
                            :text="t(fieldHelpKey(field.name))"
                            class="inline-block align-middle ml-1"
                        />
                    </td>
                    <td v-for="i in columns" :key="i" :class="{ 'bg-warning/10': highlight[field.name]?.[i - 1] }">
                        <IndiSettingInput
                            :field="field"
                            :info="info[field.name]"
                            :model-value="values[field.name][i - 1]"
                            :aria-label="`${fieldLabel(field)} ${t('indiConfigActuatorN', { n: i })}`"
                            @update:model-value="(v) => setElement(field.name, i - 1, v)"
                        />
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import HelpIcon from "@/components/elements/HelpIcon.vue";
import IndiSettingInput from "./IndiSettingInput.vue";
import { fieldHelpKey, fieldLabelKey } from "./labels";

const props = defineProps({
    /** ACTUATOR_ROWS from src/js/indiflight/indiSettings.ts */
    rows: { type: Array, required: true },
    info: { type: Object, required: true },
    values: { type: Object, required: true },
    actNum: { type: Number, required: true },
    /** {name: boolean[]}: cells to mark, e.g. those a computed effectiveness would change */
    highlight: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["set"]);
const { t, i18next } = useTranslation();

const sections = computed(() =>
    props.rows
        .map((s) => ({ ...s, fields: s.fields.filter((f) => props.info[f.name]?.isArray) }))
        .filter((s) => s.fields.length),
);
// Never more columns than the shortest array holds
const columns = computed(() =>
    Math.min(props.actNum, ...sections.value.flatMap((s) => s.fields.map((f) => props.info[f.name].length))),
);

const fieldLabel = (field) => t(fieldLabelKey(field.name), { defaultValue: field.name });

function setElement(name, i, v) {
    const next = [...props.values[name]];
    next[i] = v;
    emit("set", name, next);
}
</script>
