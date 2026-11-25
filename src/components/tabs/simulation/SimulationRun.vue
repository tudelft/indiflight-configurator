<template>
    <UiBox :title="$t('simulationRunTitle')">
        <div class="flex flex-wrap items-center gap-2 text-xs">
            <UBadge :color="stateColor" variant="subtle" size="sm">{{ stateLabel }}</UBadge>
            <span class="font-mono">{{ job.sim }}</span>
            <span class="font-mono text-muted">{{ job.profile }}</span>
            <span v-if="job.gdbPort" class="font-mono text-muted">gdbserver 127.0.0.1:{{ job.gdbPort }}</span>
            <span v-if="job.error" class="text-error">{{ job.error }}</span>
        </div>

        <div v-if="sim.running && sim.progress.status" class="flex flex-col gap-1">
            <UProgress v-if="progressPercent !== null" :model-value="progressPercent" :max="100" size="xs" />
            <span class="font-mono text-xs text-muted truncate">{{ sim.progress.status }}</span>
        </div>
        <UProgress v-else-if="sim.running" size="xs" :color="job.state === 'image' ? 'warning' : 'primary'" />
        <p v-if="job.state === 'image'" class="text-xs text-muted">{{ $t("simulationImageNote") }}</p>

        <!-- Three.js visualization served by the sim's Flask app inside the container -->
        <div v-if="sim.visUrl" class="flex flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="font-semibold">{{ $t("simulationVisualization") }}</span>
                <a :href="sim.visUrl" target="_blank" rel="noopener" class="font-mono text-primary">
                    {{ sim.visUrl }}
                </a>
                <UButton size="xs" variant="ghost" icon="i-lucide-refresh-cw" @click="reloadVis">
                    {{ $t("simulationReloadVis") }}
                </UButton>
            </div>
            <iframe
                :key="visKey"
                :src="sim.visUrl"
                :title="$t('simulationVisualization')"
                class="w-full h-[60vh] min-h-80 rounded-md border border-default bg-black"
                sandbox="allow-scripts allow-same-origin"
            />
        </div>
        <p v-else-if="sim.running && job.state === 'running' && !hostNoVis" class="text-xs text-muted">
            {{ $t("simulationVisWaiting") }}
        </p>

        <!-- Blackbox logs the SIL wrote to logs-mockup -->
        <div v-if="job.artifacts?.length" class="flex flex-wrap items-center gap-2 text-xs">
            <span class="font-semibold">{{ $t("simulationLogs") }}</span>
            <UButton
                v-for="a in job.artifacts"
                :key="a.name"
                size="xs"
                variant="soft"
                icon="i-lucide-download"
                :loading="downloading === a.name"
                @click="download(a)"
            >
                {{ a.name }} ({{ formatSize(a.size) }})
            </UButton>
            <UButton
                v-for="a in viewerLogs"
                :key="`view-${a.name}`"
                size="xs"
                variant="ghost"
                icon="i-lucide-line-chart"
                :loading="opening === a.name"
                @click="openInViewer(a)"
            >
                {{ $t("simulationOpenInViewer", { name: a.name }) }}
            </UButton>
            <UButton
                v-for="a in viewerLogs"
                :key="`plot-${a.name}`"
                size="xs"
                variant="ghost"
                icon="i-lucide-activity"
                :loading="opening === `plot-${a.name}`"
                @click="openInFlightPlotter(a)"
            >
                {{ $t("simulationOpenInFlightPlotter", { name: a.name }) }}
            </UButton>
        </div>

        <pre
            ref="logEl"
            class="max-h-72 overflow-auto rounded-md bg-muted p-2 text-xs font-mono whitespace-pre-wrap select-text! **:select-text!"
        ><span
            v-for="(entry, i) in sim.log"
            :key="i"
            :class="{ 'text-muted': entry.stream === 'meta', 'text-error': isErrorLine(entry) }"
        >{{ entry.line }}
</span></pre>
    </UiBox>
</template>

<script setup>
import { computed, inject, nextTick, ref, watch } from "vue";
import UiBox from "@/components/elements/UiBox.vue";
import { useSimulationStore } from "@/stores/simulation";
import FileSystem from "@/js/FileSystem";
import { switchTab } from "@/js/tab_switch";
import { openLogInBlackboxViewer } from "@/blackbox-viewer/vue_init";
import { useFlightPlotterStore } from "@/stores/flightPlotter";
import { gui_log } from "@/js/gui_log";
import { i18n } from "@/js/localization";
import { escapeHtml } from "@/js/utils/common";

const $t = inject("$t", (key, params) => i18n.getMessage(key, params));
const sim = useSimulationStore();
const job = computed(() => sim.job);

const STATE_COLORS = { success: "success", stopped: "neutral", failed: "error", cancelled: "neutral" };
const stateColor = computed(() => STATE_COLORS[job.value.state] ?? "primary");
const STATE_KEYS = {
    queued: "simulationStateQueued",
    image: "simulationStateImage",
    building: "simulationStateBuilding",
    running: "simulationStateRunning",
    stopped: "simulationStateStopped",
};
const stateLabel = computed(() => (STATE_KEYS[job.value.state] ? $t(STATE_KEYS[job.value.state]) : job.value.state));

// --no-vis: no point waiting for the visualization
const hostNoVis = computed(() => job.value.args?.includes("--no-vis"));

const progressPercent = computed(() =>
    sim.progress.total ? Math.min(100, (100 * sim.progress.done) / sim.progress.total) : null,
);

const visKey = ref(0);
function reloadVis() {
    visKey.value++;
}

function isErrorLine(entry) {
    return /\b(error|Error 1|undefined reference|Traceback)\b/.test(entry.line);
}

function formatSize(bytes) {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} kB`;
}

const downloading = ref("");
async function download(artifact) {
    downloading.value = artifact.name;
    try {
        const blob = await sim.fetchArtifact(artifact.name);
        const ext = artifact.name.includes(".") ? `.${artifact.name.split(".").pop()}` : "";
        const file = await FileSystem.pickSaveFile(artifact.name, $t("simulationLogFiles"), ext);
        if (file) {
            await FileSystem.writeFile(file, blob);
        }
    } catch (e) {
        gui_log(`${$t("simulationDownloadFailed")}: ${escapeHtml(e.message)}`);
    } finally {
        downloading.value = "";
    }
}

// Blackbox logs the viewer can parse (the SIL writes .BFL; .BBL/.TXT for completeness)
const viewerLogs = computed(() => (job.value.artifacts ?? []).filter((a) => ["bfl", "bbl", "txt"].includes(a.kind)));

const opening = ref("");
async function openInViewer(artifact) {
    opening.value = artifact.name;
    try {
        const blob = await sim.fetchArtifact(artifact.name);
        openLogInBlackboxViewer(new Uint8Array(await blob.arrayBuffer()), artifact.name);
        switchTab("blackbox_viewer", { mode: "shared" });
    } catch (e) {
        gui_log(`${$t("simulationDownloadFailed")}: ${escapeHtml(e.message)}`);
    } finally {
        opening.value = "";
    }
}

const flightPlotter = useFlightPlotterStore();
async function openInFlightPlotter(artifact) {
    opening.value = `plot-${artifact.name}`;
    try {
        const blob = await sim.fetchArtifact(artifact.name);
        flightPlotter.openLog(new Uint8Array(await blob.arrayBuffer()), artifact.name);
        switchTab("flight_plotter", { mode: "shared" });
    } catch (e) {
        gui_log(`${$t("simulationDownloadFailed")}: ${escapeHtml(e.message)}`);
    } finally {
        opening.value = "";
    }
}

// Keep the log scrolled to the bottom while new lines arrive
const logEl = ref(null);
watch(
    () => sim.log.length,
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
</script>
