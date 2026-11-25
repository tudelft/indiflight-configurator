<template>
    <UiBox v-if="visibleFields.length || hasEnable" :title="t(`indiConfigGroup_${group.id}`)" :help="groupHelp">
        <template v-if="hasEnable" #title>
            <USwitch
                size="xs"
                :model-value="enabled"
                :aria-label="t(`indiConfigGroup_${group.id}`)"
                @update:model-value="(on) => emit('set', group.enable, on ? 1 : 0)"
            />
        </template>
        <div class="flex flex-col gap-2" :class="{ 'opacity-50': hasEnable && !enabled }">
            <div v-for="field in visibleFields" :key="field.name" class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <SettingRow class="min-w-56 flex-1" :help="fieldHelp(field)">
                    <template #label>
                        <span>{{ fieldLabel(field) }}</span>
                        <span v-if="field.unit" class="text-dimmed ml-1">[{{ field.unit }}]</span>
                    </template>
                </SettingRow>
                <div v-if="!info[field.name].isArray" class="w-28" :class="{ 'w-auto': field.kind === 'bool' }">
                    <IndiSettingInput
                        :field="field"
                        :info="info[field.name]"
                        :model-value="values[field.name]"
                        :aria-label="fieldLabel(field)"
                        @update:model-value="(v) => emit('set', field.name, v)"
                    />
                </div>
                <div v-else class="flex flex-wrap gap-1">
                    <div
                        v-for="(label, i) in elementLabels(field)"
                        :key="i"
                        class="flex flex-col items-center"
                        :class="field.kind === 'bool' ? 'w-auto' : 'w-20'"
                    >
                        <span class="text-[10px] text-dimmed">{{ label }}</span>
                        <IndiSettingInput
                            :field="field"
                            :info="info[field.name]"
                            :model-value="values[field.name][i]"
                            :aria-label="`${fieldLabel(field)} ${label}`"
                            @update:model-value="(v) => setElement(field.name, i, v)"
                        />
                    </div>
                </div>
            </div>
        </div>
    </UiBox>
</template>

<script setup>
import { computed } from "vue";
import { useTranslation } from "i18next-vue";
import UiBox from "@/components/elements/UiBox.vue";
import SettingRow from "@/components/elements/SettingRow.vue";
import IndiSettingInput from "./IndiSettingInput.vue";
import { elementLabelsFor, fieldHelpKey, fieldLabelKey } from "./labels";

const props = defineProps({
    /** GroupDef from src/js/indiflight/indiSettings.ts */
    group: { type: Object, required: true },
    info: { type: Object, required: true },
    values: { type: Object, required: true },
    actNum: { type: Number, default: 0 },
});
/** set(name, value): a whole setting, arrays included */
const emit = defineEmits(["set"]);
const { t, i18next } = useTranslation();

const visibleFields = computed(() => props.group.fields.filter((f) => f.name in props.info));
const hasEnable = computed(() => Boolean(props.group.enable && props.group.enable in props.info));
const enabled = computed(() => hasEnable.value && Boolean(props.values[props.group.enable]));
const groupHelp = computed(() => {
    const key = `indiConfigGroup_${props.group.id}Help`;
    return i18next.exists(key) ? t(key) : null;
});

const fieldLabel = (field) => t(fieldLabelKey(field.name), { defaultValue: field.name });
const fieldHelp = (field) => (i18next.exists(fieldHelpKey(field.name)) ? t(fieldHelpKey(field.name)) : "");
const elementLabels = (field) => elementLabelsFor(field, props.info[field.name].length, props.actNum, t);

function setElement(name, i, v) {
    const next = [...props.values[name]];
    next[i] = v;
    emit("set", name, next);
}
</script>
