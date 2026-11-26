<template>
    <BaseTab tab-name="flight_plotter" extra-class="h-full">
        <div
            class="relative flex h-full flex-col"
            @dragover.prevent="dragging = true"
            @dragleave.self="dragging = false"
            @drop.prevent="onDrop"
        >
            <div v-if="!fileName" class="flex flex-1 items-center justify-center p-6">
                <button
                    type="button"
                    class="w-full max-w-xl rounded-xl border-2 border-dashed p-10 text-center"
                    :class="dragging ? 'border-primary bg-elevated' : 'border-default hover:border-accented'"
                    @click="fileInput.click()"
                >
                    <span class="block text-lg font-semibold">{{ $t("flightPlotterDrop") }}</span>
                    <span class="mt-2 block text-sm text-muted">{{ $t("flightPlotterDropHint") }}</span>
                </button>
            </div>
            <div v-show="fileName" ref="plotEl" class="min-h-0 flex-1" />

            <!-- file controls inside the plotter's toolbar -->
            <Teleport v-if="toolbarSlot" :to="toolbarSlot">
                <span class="max-w-60 truncate font-semibold" :title="fileName">{{ fileName }}</span>
                <USelect
                    v-if="logItems.length > 1"
                    v-model="logIndex"
                    :items="logItems"
                    size="xs"
                    class="w-56"
                    :aria-label="$t('flightPlotterLog')"
                />
                <UButton size="xs" variant="soft" icon="i-lucide-folder-open" @click="fileInput.click()">
                    {{ $t("flightPlotterOpen") }}
                </UButton>
            </Teleport>

            <div
                v-if="loading || error"
                class="absolute inset-x-0 top-0 z-10 flex justify-center p-3"
                :class="{ 'pointer-events-none': loading }"
            >
                <div
                    class="flex items-center gap-2 rounded-md border border-default bg-default px-3 py-2 text-sm shadow"
                >
                    <UIcon v-if="loading" name="i-lucide-loader-circle" class="animate-spin" />
                    <span :class="{ 'text-error': error }">{{ error || $t("flightPlotterLoading") }}</span>
                    <UButton v-if="error" size="xs" variant="ghost" icon="i-lucide-x" @click="error = ''" />
                </div>
            </div>
        </div>
        <input ref="fileInput" type="file" accept=".bfl,.BFL,.bbl,.BBL,.txt,.TXT" hidden @change="onPick" />
    </BaseTab>
</template>

<script setup>
import { inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import "flightplotter/style.css";
import "uplot/dist/uPlot.min.css";
import BaseTab from "./BaseTab.vue";
import GUI from "@/js/gui";
import { i18n } from "@/js/localization";
import { useFlightPlotterStore } from "@/stores/flightPlotter";
import { FlightLog } from "@/blackbox-viewer/flightlog";
import { flightLogToSI } from "@/blackbox-viewer/flightlog_si";
import { FLIGHT_LOG_FLIGHT_MODE_NAME } from "@/blackbox-viewer/flightlog_fielddefs";
import { isAndroid, isIOS, isTauri } from "@/js/utils/checkCompatibility";

// tabs pop out into browser windows; the native shells don't open those
const POPOUT_URL =
    isTauri() || isAndroid() || isIOS()
        ? null
        : new URL("components/tabs/flight-plotter-popout/flight_plotter_popout.html", document.baseURI).href;

const $t = inject("$t", (key, params) => i18n.getMessage(key, params));
const store = useFlightPlotterStore();

const plotEl = ref(null);
const fileInput = ref(null);
const toolbarSlot = shallowRef(null);
const fileName = ref("");
const logItems = ref([]);
const logIndex = ref(null);
const loading = ref(false);
const error = ref("");
const dragging = ref(false);

let flightLog = null;
let plotter = null;
let themeObserver = null;

const hostTheme = () => (document.documentElement.classList.contains("dark") ? "dark" : "light");
// let the overlay paint before the synchronous parse
const yieldToBrowser = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function openBytes(data, name) {
    loading.value = true;
    error.value = "";
    await yieldToBrowser();
    try {
        const log = new FlightLog(data);
        const items = [];
        let best = null;
        let bestDuration = -1;
        for (let i = 0; i < log.getLogCount(); i++) {
            const failed = log.getLogError(i);
            const duration = failed ? 0 : (log.getMaxTime(i) - log.getMinTime(i)) / 1e6;
            items.push({
                label: failed ? `${i + 1}: ${failed}` : `${i + 1}: ${duration.toFixed(1)} s`,
                value: i,
                disabled: !!failed,
            });
            if (!failed && duration > bestDuration) {
                best = i;
                bestDuration = duration;
            }
        }
        if (best === null) {
            throw new Error($t("flightPlotterNoData"));
        }
        flightLog = log;
        fileName.value = name;
        logItems.value = items;
        // the watcher on logIndex shows it; force it for a repeated index
        if (logIndex.value === best) {
            await showLog(best);
        } else {
            logIndex.value = best;
        }
    } catch (e) {
        console.error(e);
        error.value = `${$t("flightPlotterLoadFailed")}: ${e.message || e}`;
        loading.value = false;
    }
}

/** file name and comment block of the CSV export: what the file is and where it came from */
function csvOptions(index) {
    const cfg = flightLog.getSysConfig();
    const stem = fileName.value.replace(/\.[^.]*$/, "");
    const info = [
        ["Source file", fileName.value + (logItems.value.length > 1 ? `, log ${index + 1}` : "")],
        ["Firmware", cfg["Firmware revision"]],
        ["Board", cfg["Board information"]],
        ["Craft name", cfg["Craft name"]],
        ["Log start", cfg["Log start datetime"]],
    ];
    return {
        filename: `${stem}${logItems.value.length > 1 ? `-log${index + 1}` : ""}.si.csv`,
        header: [
            "Indiflight Configurator, Flight Plotter: decoded flight log in SI units",
            ...info.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
            "Logged signals are scaled to SI (angles in rad, rates in rad/s, m, m/s, V, A; motor and stick signals " +
                "normalized to [0, 1] or [-1, 1]). Signals without a known unit, such as counters and bit masks " +
                "(loopIteration, flightModeFlags, stateFlags), are the logged values.",
        ],
    };
}

async function showLog(index) {
    if (!flightLog || index == null) {
        return;
    }
    loading.value = true;
    await yieldToBrowser();
    try {
        if (!flightLog.openLog(index)) {
            throw new Error(flightLog.getLogError(index) || $t("flightPlotterNoData"));
        }
        // uPlot and three.js load with the first log, not with the app
        const [{ FlightPlotter }, { indiflightPlot, extraHeaders, adaptSavedLayout }] = await Promise.all([
            import("flightplotter"),
            import("@/js/indiflight/flightPlotterLayout"),
        ]);
        const plot = indiflightPlot(
            flightLogToSI(flightLog),
            FLIGHT_LOG_FLIGHT_MODE_NAME,
            extraHeaders(flightLog.getSysConfig()),
        );
        // detach the teleported controls before their target goes away
        toolbarSlot.value = null;
        await nextTick();
        plotter?.destroy();
        plotter = new FlightPlotter(plotEl.value, {
            data: plot.data,
            tabs: plot.tabs,
            viewport: plot.viewport,
            crafts: plot.crafts,
            signals: plot.signals,
            popoutUrl: POPOUT_URL,
            csv: csvOptions(index),
            layoutName: `indiflight-${plot.craft.type}-layout`,
            // the user's edits, kept per craft type; the toolbar's reset returns to the built-in layout
            layout: adaptSavedLayout(store.savedLayout(plot.craft.type), plot),
            onLayoutChange: (layout) => {
                if (JSON.stringify(layout) === JSON.stringify(plotter?.initialLayout)) {
                    store.forgetLayout(plot.craft.type);
                } else {
                    store.saveLayout(plot.craft.type, layout);
                }
            },
            theme: hostTheme(),
        });
        toolbarSlot.value = plotter.toolbarSlot;
    } catch (e) {
        console.error(e);
        error.value = `${$t("flightPlotterLoadFailed")}: ${e.message || e}`;
    } finally {
        loading.value = false;
    }
}

watch(logIndex, (i) => showLog(i));

async function openFile(file) {
    if (file) {
        await openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    }
}

function onPick(e) {
    openFile(e.target.files[0]);
    e.target.value = "";
}

function onDrop(e) {
    dragging.value = false;
    openFile(e.dataTransfer?.files?.[0]);
}

function openPending() {
    const log = store.takePendingLog();
    if (log) {
        openBytes(log.data, log.name);
    }
}
watch(() => store.pendingLog, openPending);

onMounted(() => {
    themeObserver = new MutationObserver(() => plotter?.setTheme(hostTheme()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    openPending();
    GUI.content_ready();
});

onBeforeUnmount(() => {
    themeObserver?.disconnect();
    toolbarSlot.value = null;
    plotter?.destroy();
    plotter = null;
    flightLog = null;
});
</script>
