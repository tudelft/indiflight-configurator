<template>
    <UiBox :title="$t('localBuildTitle')" collapsible class="mt-4">
        <DaemonConnection :busy="store.building" />

        <template v-if="store.connected && store.info">
            <!-- Board / profile selection -->
            <div class="flex flex-wrap items-end gap-2">
                <UFormField :label="$t('localBuildBoard')" size="sm">
                    <USelect
                        :model-value="store.board"
                        :items="store.boards"
                        size="sm"
                        class="min-w-48"
                        :disabled="busy"
                        @update:model-value="store.selectBoard"
                    />
                </UFormField>
                <UFormField :label="$t('localBuildProfile')" size="sm">
                    <USelect
                        :model-value="store.profile || NO_PROFILE"
                        :items="profileItems"
                        size="sm"
                        class="min-w-48"
                        :disabled="busy"
                        @update:model-value="(v) => store.selectProfile(v === NO_PROFILE ? '' : v)"
                    />
                </UFormField>
                <UButton
                    size="sm"
                    variant="ghost"
                    icon="i-lucide-folder-sync"
                    :disabled="busy"
                    :title="$t('localBuildRescanTitle')"
                    @click="store.refreshConfigs()"
                >
                    {{ $t("localBuildRescan") }}
                </UButton>
            </div>

            <BuildConfigPreview />

            <!-- Build options -->
            <div class="flex flex-wrap items-end gap-3">
                <UFormField :label="$t('localBuildDebug')" size="sm">
                    <USelect
                        :model-value="store.options.debug ?? 'NONE'"
                        :items="debugItems"
                        size="sm"
                        class="min-w-40"
                        :disabled="busy"
                        @update:model-value="(v) => (store.options.debug = v === 'NONE' ? null : v)"
                    />
                </UFormField>
                <UFormField :label="$t('localBuildExtraFlags')" size="sm" class="grow">
                    <UInput
                        v-model="store.options.extraFlags"
                        size="sm"
                        class="w-full font-mono"
                        placeholder="-DUSE_FOO -DBAR=1"
                        :disabled="busy"
                    />
                </UFormField>
                <label class="flex items-center gap-2 text-sm pb-1">
                    <USwitch v-model="store.options.clean" size="sm" :disabled="busy" />
                    {{ $t("localBuildClean") }}
                </label>
            </div>

            <div class="flex flex-wrap items-center gap-2">
                <UButton
                    color="success"
                    icon="i-lucide-hammer"
                    :loading="store.building"
                    :disabled="busy || !store.board"
                    @click="onBuild"
                >
                    {{ $t("localBuildCompile") }}
                </UButton>
                <UButton v-if="store.building" color="error" variant="soft" icon="i-lucide-x" @click="store.cancel()">
                    {{ $t("cancel") }}
                </UButton>
                <UButton
                    v-if="store.job?.state === 'success'"
                    variant="soft"
                    icon="i-lucide-download"
                    :loading="loading"
                    :disabled="busy"
                    @click="loadIntoFlasher"
                >
                    {{ $t("localBuildLoadIntoFlasher") }}
                </UButton>
                <label class="flex items-center gap-2 text-xs">
                    <USwitch v-model="autoLoad" size="xs" />
                    {{ $t("localBuildAutoLoad") }}
                </label>
                <span v-if="startError" class="text-xs text-error">{{ startError }}</span>
            </div>

            <!-- Job progress and log -->
            <div v-if="store.job" class="flex flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2 text-xs">
                    <UBadge :color="stateColor" variant="subtle" size="sm">{{ store.job.state }}</UBadge>
                    <span class="font-mono text-muted">{{ progressText }}</span>
                    <span v-for="a in store.job.artifacts" :key="a.name" class="font-mono text-muted">
                        {{ a.name }} ({{ a.size }} B)
                    </span>
                    <span v-if="store.job.error" class="text-error">{{ store.job.error }}</span>
                </div>
                <UProgress
                    v-if="store.building"
                    :model-value="progressPercent"
                    :max="100"
                    size="xs"
                    :color="store.job.state === 'image' ? 'warning' : 'primary'"
                />
                <pre
                    ref="logEl"
                    class="max-h-72 overflow-auto rounded-md bg-muted p-2 text-xs font-mono whitespace-pre-wrap select-text! **:select-text!"
                ><span
                    v-for="(entry, i) in store.log"
                    :key="i"
                    :class="{ 'text-muted': entry.stream === 'meta', 'text-error': isErrorLine(entry) }"
                >{{ entry.line }}
</span></pre>
            </div>
        </template>
    </UiBox>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, ref, watch } from "vue";
import UiBox from "@/components/elements/UiBox.vue";
import BuildConfigPreview from "./BuildConfigPreview.vue";
import DaemonConnection from "./DaemonConnection.vue";
import { useLocalBuildStore } from "@/stores/localBuild";
import { gui_log } from "@/js/gui_log";
import { i18n } from "@/js/localization";
import { escapeHtml } from "@/js/utils/common";

const emit = defineEmits({
    /** A compiled hex is ready to be flashed */
    firmware: (payload) => typeof payload?.name === "string" && typeof payload?.text === "string",
});

const $t = inject("$t", (key, params) => i18n.getMessage(key, params));
const store = useLocalBuildStore();

// USelect cannot hold an empty-string value
const NO_PROFILE = "__none__";
const profileItems = computed(() => [
    { label: $t("localBuildNoProfile"), value: NO_PROFILE },
    ...store.profiles.map((p) => ({ label: p, value: p })),
]);
const debugItems = [
    { label: "Release", value: "NONE" },
    { label: "INFO (-O2 + symbols)", value: "INFO" },
    { label: "GDB (-O0 + symbols)", value: "GDB" },
];

const busy = computed(() => store.building || store.status === "connecting");
const autoLoad = ref(true);
const loading = ref(false);
const startError = ref("");
const logEl = ref(null);

const STATE_COLORS = { success: "success", failed: "error", cancelled: "neutral" };
const stateColor = computed(() => STATE_COLORS[store.job?.state] ?? "primary");

const progressPercent = computed(() =>
    store.progress.total ? Math.min(100, (100 * store.progress.done) / store.progress.total) : null,
);
const progressText = computed(() => {
    const { done, total, file } = store.progress;
    if (!done) {
        return "";
    }
    return `[${done}/${total ?? "?"}] ${file ?? ""}`;
});

function isErrorLine(entry) {
    return /\b(error|Error 1|undefined reference)\b/.test(entry.line);
}

async function loadIntoFlasher() {
    loading.value = true;
    try {
        const hex = await store.fetchHex();
        if (hex) {
            emit("firmware", hex);
        }
    } catch (e) {
        // The log renders HTML and the message can come from the daemon
        gui_log(`${$t("localBuildFetchFailed")}: ${escapeHtml(e.message)}`);
    } finally {
        loading.value = false;
    }
}

async function onBuild() {
    startError.value = "";
    try {
        const final = await store.build();
        if (final?.state === "success" && autoLoad.value) {
            await loadIntoFlasher();
        }
    } catch (e) {
        // e.g. the daemon rejecting an extra flag; shown as text next to the button
        startError.value = e.message;
        gui_log(`${$t("localBuildFailedToStart")}: ${escapeHtml(e.message)}`);
    }
}

// Keep the log scrolled to the bottom while new lines arrive
watch(
    () => store.log.length,
    async () => {
        const el = logEl.value;
        if (!el) {
            return;
        }
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        await nextTick();
        if (atBottom) {
            el.scrollTop = el.scrollHeight;
        }
    },
);

onMounted(() => {
    if (store.status === "disconnected") {
        store.connect({ silent: true });
    }
});
</script>
