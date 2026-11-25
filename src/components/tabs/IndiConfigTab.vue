<template>
    <BaseTab tab-name="indi_config">
        <div class="content_wrapper">
            <div class="tab_title">{{ t("tabIndiConfig") }}</div>

            <div class="flex items-start gap-3 flex-wrap mb-2">
                <SettingRow :label="t('indiConfigProfile')" :help="t('indiConfigProfileHelp')">
                    <USelect
                        :model-value="store.profileIndex"
                        :items="profileItems"
                        class="min-w-20"
                        :disabled="store.hasEdits || busy"
                        @update:model-value="onProfileChange"
                    />
                </SettingRow>

                <div class="flex gap-2 flex-wrap ml-auto">
                    <UButton
                        :label="t('indiConfigCopyProfile')"
                        color="neutral"
                        variant="outline"
                        :disabled="store.hasEdits || busy || store.profileCount < 2"
                        @click="copyProfile"
                    />
                    <UButton
                        :label="t('indiConfigResetProfile')"
                        color="neutral"
                        variant="outline"
                        :disabled="busy"
                        @click="store.resetToDefaults()"
                    />
                </div>
            </div>

            <SubtabNav v-model="activeSubtab" :items="subtabItems" />

            <UAlert
                v-if="!loaded && loadError"
                class="m-5 w-auto"
                color="error"
                variant="subtle"
                :title="t('indiConfigLoadFailed')"
                :description="loadError"
            />
            <TabLoadingState v-else-if="!loaded" />
            <div v-else class="tabarea">
                <div v-if="activeSubtab === 'controller'" class="p-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <IndiSettingGroup
                        v-for="group in CONTROLLER_GROUPS"
                        :key="group.id"
                        :group="group"
                        :info="store.info"
                        :values="store.values"
                        :act-num="actNum"
                        @set="set"
                    />
                </div>

                <div v-else-if="activeSubtab === 'actuators'" class="p-5 flex flex-col gap-4">
                    <UiBox :title="t('indiConfigActuators')" :help="t('indiConfigActuatorsHelp')">
                        <SettingRow :label="t('indiConfigField_indi_act_num')">
                            <div class="w-20">
                                <IndiSettingInput
                                    :field="{ name: ACT_NUM }"
                                    :info="store.info[ACT_NUM]"
                                    :model-value="actNum"
                                    :aria-label="t('indiConfigField_indi_act_num')"
                                    @update:model-value="(v) => set(ACT_NUM, v)"
                                />
                            </div>
                        </SettingRow>
                        <IndiActuatorTable
                            :rows="ACTUATOR_ROWS"
                            :info="store.info"
                            :values="store.values"
                            :act-num="actNum"
                            @set="set"
                        />
                    </UiBox>
                    <IndiEffectivenessCalculator
                        :max-actuators="maxActuators"
                        :max-rpm="store.values.indi_act_max_rpm ?? []"
                        @apply="onApplyEffectiveness"
                    />
                </div>

                <div v-else class="p-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <IndiSettingGroup
                        v-for="group in advancedGroups"
                        :key="group.id"
                        :group="group"
                        :info="store.info"
                        :values="store.values"
                        :act-num="actNum"
                        @set="set"
                    />
                </div>
            </div>

            <div class="content_toolbar toolbar_fixed_bottom flex items-center gap-2">
                <UButton :label="t('indiConfigRefresh')" :disabled="busy" variant="soft" @click="refresh" />
                <UButton
                    :label="t('indiConfigSave')"
                    :disabled="!store.hasChanges || busy"
                    :loading="isSaving"
                    @click="save"
                />
            </div>
        </div>
    </BaseTab>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import BaseTab from "./BaseTab.vue";
import SettingRow from "@/components/elements/SettingRow.vue";
import SubtabNav from "@/components/elements/SubtabNav.vue";
import TabLoadingState from "@/components/elements/TabLoadingState.vue";
import UiBox from "@/components/elements/UiBox.vue";
import IndiSettingGroup from "./indi-config/IndiSettingGroup.vue";
import IndiSettingInput from "./indi-config/IndiSettingInput.vue";
import IndiActuatorTable from "./indi-config/IndiActuatorTable.vue";
import IndiEffectivenessCalculator from "./indi-config/IndiEffectivenessCalculator.vue";
import { ACT_NUM, ACTUATOR_ROWS, ADVANCED_GROUPS, CONTROLLER_GROUPS } from "@/js/indiflight/indiSettings";
import { useIndiConfigStore } from "@/stores/indiConfig";
import { useNavigationStore } from "@/stores/navigation";
import { useIsMounted } from "@/composables/useIsMounted";
import { useSaving } from "@/composables/useSaving";
import { runTabLoad } from "@/composables/useTabLoad";
import { useDialog } from "@/composables/useDialog";
import GUI from "@/js/gui";
import { gui_log } from "@/js/gui_log";

const { t } = useTranslation();
const store = useIndiConfigStore();
const navigationStore = useNavigationStore();
const dialog = useDialog();
const isMounted = useIsMounted();

const activeSubtab = ref("controller");
const subtabItems = computed(() => [
    { label: t("indiConfigSubTabController"), value: "controller", icon: "i-lucide-sliders-horizontal" },
    { label: t("indiConfigSubTabActuators"), value: "actuators", icon: "i-lucide-fan" },
    { label: t("indiConfigSubTabAdvanced"), value: "advanced", icon: "i-lucide-flask-conical" },
]);
const advancedGroups = computed(() => ADVANCED_GROUPS.filter((g) => !g.expert || navigationStore.expertMode));

const profileItems = computed(() =>
    Array.from({ length: store.profileCount }, (_, i) => ({
        value: i,
        label: t("indiConfigProfileOption", { n: i + 1 }),
    })),
);

const actNum = computed(() => Number(store.values[ACT_NUM] ?? 0));
const maxActuators = computed(() => store.info.indi_act_type?.length ?? 8);

const loaded = ref(false);
const loadError = ref("");
const busy = ref(false);

async function load() {
    busy.value = true;
    try {
        const ok = await runTabLoad(
            async () => {
                await store.load();
                return true;
            },
            (e) => {
                console.error("[IndiConfig] Load failed:", e);
                loadError.value = e.message ?? String(e);
            },
        );
        if (ok && isMounted.value) {
            loaded.value = true;
            loadError.value = "";
        }
        return ok;
    } finally {
        busy.value = false;
        GUI.content_ready();
    }
}

function set(name, value) {
    store.values[name] = value;
}

function onApplyEffectiveness(values) {
    store.applyValues(values);
    gui_log(t("indiConfigCalcApplied"));
}

async function onProfileChange(index) {
    if (index === store.profileIndex) {
        return;
    }
    busy.value = true;
    try {
        await runTabLoad(
            () => store.selectProfile(index),
            (e) => gui_log(t("indiConfigProfileSwitchFailed", { error: e.message })),
        );
    } finally {
        busy.value = false;
    }
}

function copyProfile() {
    const options = profileItems.value.filter((p) => p.value !== store.profileIndex);
    dialog.openCopyProfile(
        t("indiConfigCopyProfile"),
        t("indiConfigCopyProfileNote"),
        options,
        [],
        async (selected) => {
            if (typeof selected?.profile !== "number") {
                return;
            }
            busy.value = true;
            try {
                await store.copyProfileTo(selected.profile);
                gui_log(t("indiConfigProfileCopied", { from: store.profileIndex + 1, to: selected.profile + 1 }));
            } catch (e) {
                gui_log(t("indiConfigProfileCopyFailed", { error: e.message }));
            } finally {
                busy.value = false;
            }
        },
        () => {},
    );
}

const { isSaving, runSave } = useSaving();

function save() {
    return runSave(
        async () => {
            await store.save();
            gui_log(t("indiConfigSaved"));
        },
        {
            onError: (e) => {
                console.error("[IndiConfig] Save failed:", e);
                gui_log(t("indiConfigSaveFailed", { error: e.message }));
            },
        },
    );
}

async function refresh() {
    if (await load()) {
        gui_log(t("indiConfigRefreshed"));
    }
}

function cleanup(callback) {
    callback?.();
}
defineExpose({ cleanup });

onMounted(load);
</script>
