<template>
    <div>
        <div>
            <p class="mb-3 text-sm">{{ $t("blackboxLogsNote") }}</p>

            <div class="flex flex-col gap-2">
                <UAlert
                    v-if="storageIssueKey && !downloading && !erasing && !message"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-alert-triangle"
                    :description="$t(storageIssueKey)"
                />
                <UAlert
                    v-if="message"
                    :color="alertColor"
                    variant="subtle"
                    :icon="alertIcon"
                    :description="$t(message.key, message.params ?? {})"
                />
            </div>

            <UiBox v-if="erasing" :title="$t('blackboxLogsEraseProgressTitle')" class="mt-4">
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-alert-triangle"
                    :description="$t('blackboxLogsEraseKeepOpen')"
                />
                <div class="flex justify-between gap-2 text-sm">
                    <span>{{ $t("blackboxLogsErasing", { storage: storageLabel }) }}</span>
                    <span v-if="eraseProgress !== null" class="text-muted">{{ eraseProgress }}%</span>
                </div>
                <UProgress :model-value="eraseProgress" :max="100" color="error" />
            </UiBox>

            <UiBox v-if="progress" :title="$t('blackboxLogsProgressTitle')" class="mt-4">
                <div class="flex flex-col gap-1">
                    <div class="flex justify-between gap-2 text-sm">
                        <span>
                            {{
                                $t("blackboxLogsProgressFile", {
                                    index: progress.fileIndex + 1,
                                    count: progress.fileCount,
                                    name: progress.fileName,
                                })
                            }}
                        </span>
                        <span class="text-muted">
                            {{
                                $t("blackboxLogsProgressBytes", {
                                    done: bytesToSize(progress.fileBytes),
                                    total: bytesToSize(progress.fileSize),
                                })
                            }}
                        </span>
                    </div>
                    <UProgress :model-value="percent(progress.fileBytes, progress.fileSize)" :max="100" />
                </div>
                <div v-if="progress.fileCount > 1" class="flex flex-col gap-1">
                    <div class="flex justify-between gap-2 text-sm">
                        <span>{{ $t("blackboxLogsProgressOverall") }}</span>
                        <span class="text-muted">
                            {{
                                $t("blackboxLogsProgressBytes", {
                                    done: bytesToSize(progress.doneBytes),
                                    total: bytesToSize(progress.totalBytes),
                                })
                            }}
                        </span>
                    </div>
                    <UProgress :model-value="percent(progress.doneBytes, progress.totalBytes)" :max="100" />
                </div>
                <div class="flex items-center justify-between gap-2">
                    <span class="text-sm text-muted">
                        {{ $t("blackboxLogsProgressRate", { rate: bytesToSize(Math.round(progress.rate)) }) }}
                    </span>
                    <UButton
                        color="error"
                        variant="soft"
                        icon="i-lucide-x"
                        :label="$t('blackboxLogsCancel')"
                        @click="cancel"
                    />
                </div>
            </UiBox>

            <UiBox :title="$t('blackboxLogsFilesTitle')" class="mt-4">
                <div v-if="storage" class="flex flex-wrap items-center gap-2 text-sm">
                    <UIcon :name="storage === 'flash' ? 'i-lucide-cpu' : 'i-lucide-hard-drive'" class="size-4" />
                    <span class="font-semibold">{{ $t("blackboxLogsStorage", { storage: storageLabel }) }}</span>
                    <span v-if="storageUsage" class="text-muted">
                        {{
                            $t("blackboxLogsStorageUsage", {
                                used: bytesToSize(storageUsage.used),
                                total: bytesToSize(storageUsage.total),
                            })
                        }}
                    </span>
                </div>
                <p v-if="storage === 'flash'" class="text-sm text-muted">{{ $t("blackboxLogsFlashNote") }}</p>
                <div v-if="scanProgress !== null" class="flex flex-col gap-1">
                    <span class="text-sm">{{ $t("blackboxLogsScanning", { progress: scanProgress }) }}</span>
                    <UProgress :model-value="scanProgress" :max="100" />
                </div>
                <div class="flex flex-wrap items-center gap-3">
                    <UCheckbox
                        :model-value="selectAllState"
                        :disabled="busy || files.length === 0"
                        :label="$t('blackboxLogsSelectAll')"
                        @update:model-value="setAllSelected(!!$event)"
                    />
                    <span class="text-sm text-muted">
                        {{
                            $t("blackboxLogsSelectedSummary", {
                                count: selectedFiles.length,
                                total: files.length,
                                size: bytesToSize(selectedBytes),
                            })
                        }}
                    </span>
                </div>
                <UTable
                    :data="files"
                    :columns="columns"
                    :loading="listing"
                    :empty="listed ? $t('blackboxLogsNoFiles') : $t('blackboxLogsNotListed')"
                    sticky
                    :ui="{ root: 'max-h-96 overflow-y-auto', th: 'text-xs', td: 'py-1 text-sm' }"
                >
                    <template #select-cell="{ row }">
                        <UCheckbox
                            :model-value="selectedNames.includes(row.original.name)"
                            :disabled="busy"
                            :aria-label="$t('blackboxLogsSelectFile', { name: row.original.name })"
                            @update:model-value="setSelected(row.original.name, !!$event)"
                        />
                    </template>
                    <template #name-cell="{ row }">
                        <span class="font-mono">{{ row.original.name }}</span>
                    </template>
                    <template #size-cell="{ row }">
                        <span :title="`${row.original.size} B`">{{ bytesToSize(row.original.size) }}</span>
                    </template>
                    <template #timestamp-cell="{ row }">
                        <span v-if="row.original.timestamp">{{ formatTimestamp(row.original.timestamp) }}</span>
                        <span v-else class="text-dimmed">{{ $t("blackboxLogsDateUnknown") }}</span>
                    </template>
                    <template #open-cell="{ row }">
                        <div class="flex gap-1">
                            <UTooltip :text="$t('blackboxLogsOpenInViewer', { name: row.original.name })">
                                <UButton
                                    size="xs"
                                    variant="soft"
                                    icon="i-lucide-line-chart"
                                    :aria-label="$t('blackboxLogsOpenInViewer', { name: row.original.name })"
                                    :loading="opening === `viewer-${row.original.name}`"
                                    :disabled="busy"
                                    @click="openIn('viewer', row.original)"
                                />
                            </UTooltip>
                            <UTooltip :text="$t('blackboxLogsOpenInFlightPlotter', { name: row.original.name })">
                                <UButton
                                    size="xs"
                                    variant="soft"
                                    icon="i-lucide-activity"
                                    :aria-label="$t('blackboxLogsOpenInFlightPlotter', { name: row.original.name })"
                                    :loading="opening === `plotter-${row.original.name}`"
                                    :disabled="busy"
                                    @click="openIn('plotter', row.original)"
                                />
                            </UTooltip>
                        </div>
                    </template>
                    <template #state-cell="{ row }">
                        <span v-if="results[row.original.name]" :class="stateClass(results[row.original.name].state)">
                            {{ stateLabel(results[row.original.name]) }}
                        </span>
                        <span
                            v-if="uploads[row.original.name]"
                            class="ml-2"
                            :class="UPLOAD_STYLE[uploads[row.original.name].state].class"
                            :title="uploads[row.original.name].error"
                        >
                            {{ $t(UPLOAD_STYLE[uploads[row.original.name].state].key) }}
                        </span>
                    </template>
                </UTable>
            </UiBox>

            <UiBox :title="$t('blackboxLogsUploadTitle')" collapsible :default-open="false" class="mt-4">
                <p class="text-sm text-muted">{{ $t("blackboxLogsUploadNote") }}</p>
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-key-round"
                    :description="$t('blackboxLogsUploadKeyWarning')"
                />
                <UFormField :label="$t('blackboxLogsUploadUrl')">
                    <UInput
                        v-model="logbook.url"
                        class="w-full"
                        placeholder="https://logs.example.org"
                        @change="logbook.persist()"
                    />
                </UFormField>
                <UFormField :label="$t('blackboxLogsUploadToken')">
                    <UInput
                        v-model="logbook.token"
                        type="password"
                        class="w-full"
                        placeholder="logdb_..."
                        autocomplete="off"
                        @change="logbook.persist()"
                    />
                </UFormField>
                <UFormField :label="$t('blackboxLogsUploadFolder')" :help="$t('blackboxLogsUploadFolderHelp')">
                    <UInput v-model="logbook.folder" class="w-full" @change="logbook.persist()" />
                </UFormField>
                <USwitch
                    v-model="logbook.autoUpload"
                    :label="$t('blackboxLogsUploadAuto')"
                    :disabled="!logbook.configured"
                    @update:model-value="logbook.persist()"
                />
                <div class="flex items-center gap-3">
                    <UButton
                        variant="soft"
                        icon="i-lucide-plug-zap"
                        :label="$t('blackboxLogsUploadTest')"
                        :loading="testing"
                        :disabled="!logbook.configured"
                        @click="testConnection"
                    />
                    <span v-if="testResult" class="text-sm" :class="testResult.ok ? 'text-success' : 'text-error'">
                        {{
                            testResult.ok
                                ? $t("blackboxLogsUploadTestOk")
                                : $t("blackboxLogsUploadTestFailed", { error: testResult.error })
                        }}
                    </span>
                </div>
            </UiBox>
        </div>

        <UModal
            :open="confirmEraseOpen"
            :title="$t('blackboxLogsEraseConfirmTitle')"
            :ui="{ content: 'w-[36rem] max-w-[calc(100vw-2rem)]' }"
            @update:open="confirmEraseOpen = $event"
        >
            <template #body>
                <p>{{ $t("blackboxLogsEraseConfirmText", { storage: storageLabel }) }}</p>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        variant="outline"
                        color="neutral"
                        :label="$t('blackboxLogsEraseConfirmCancel')"
                        @click="confirmEraseOpen = false"
                    />
                    <UButton
                        color="error"
                        icon="i-lucide-trash-2"
                        :label="$t('blackboxLogsEraseConfirmOk')"
                        @click="confirmErase"
                    />
                </div>
            </template>
        </UModal>

        <div class="mt-4 flex flex-wrap items-center gap-2">
            <UButton
                variant="soft"
                icon="i-lucide-refresh-cw"
                :label="$t('blackboxLogsRefresh')"
                :loading="listing"
                :disabled="busy"
                @click="refresh"
            />
            <UButton
                color="error"
                variant="soft"
                icon="i-lucide-trash-2"
                :label="$t('blackboxLogsEraseAll')"
                :loading="erasing"
                :disabled="busy || !storage || unsupported"
                @click="confirmEraseOpen = true"
            />
            <UButton
                icon="i-lucide-download"
                :label="$t('blackboxLogsDownload')"
                :loading="downloading"
                :disabled="busy || selectedFiles.length === 0"
                @click="downloadSelected"
            />
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useTranslation } from "i18next-vue";
import UiBox from "@/components/elements/UiBox.vue";
import { bytesToSize } from "@/js/utils/common";
import { useBlackboxLogs } from "@/composables/useBlackboxLogs";
import { switchTab } from "@/js/tab_switch";
import { openLogInBlackboxViewer } from "@/blackbox-viewer/vue_init";
import { useFlightPlotterStore } from "@/stores/flightPlotter";
import { useLogbookStore } from "@/stores/logbook";

const { t } = useTranslation();
const {
    files,
    selectedNames,
    selectedFiles,
    allSelected,
    listing,
    listed,
    scanProgress,
    downloading,
    erasing,
    eraseProgress,
    busy,
    unsupported,
    storage,
    storageUsage,
    message,
    results,
    uploads,
    progress,
    storageIssueKey,
    setSelected,
    setAllSelected,
    refresh,
    downloadSelected,
    readLog,
    eraseAll,
    load,
    cancel,
    dispose,
} = useBlackboxLogs();

const logbook = useLogbookStore();
const testing = ref(false);
const testResult = ref(null);

async function testConnection() {
    testing.value = true;
    testResult.value = null;
    try {
        await logbook.client().status();
        testResult.value = { ok: true };
    } catch (error) {
        testResult.value = { ok: false, error: error.message };
    } finally {
        testing.value = false;
    }
}

const UPLOAD_STYLE = {
    queued: { key: "blackboxLogsUploadStateQueued", class: "text-dimmed" },
    uploading: { key: "blackboxLogsUploadStateUploading", class: "text-primary" },
    uploaded: { key: "blackboxLogsUploadStateUploaded", class: "text-success" },
    skipped: { key: "blackboxLogsUploadStateSkipped", class: "text-dimmed" },
    failed: { key: "blackboxLogsUploadStateFailed", class: "text-error" },
};

const confirmEraseOpen = ref(false);

function confirmErase() {
    confirmEraseOpen.value = false;
    eraseAll();
}

const flightPlotter = useFlightPlotterStore();
const opening = ref("");

// Read the log into memory and hand it over, without saving it to disk.
async function openIn(target, entry) {
    opening.value = `${target}-${entry.name}`;
    try {
        const bytes = await readLog(entry);
        if (!bytes) {
            return;
        }
        if (target === "viewer") {
            openLogInBlackboxViewer(bytes, entry.name);
            switchTab("blackbox_viewer", { mode: "shared" });
        } else {
            flightPlotter.openLog(bytes, entry.name);
            switchTab("flight_plotter", { mode: "shared" });
        }
    } finally {
        opening.value = "";
    }
}

const storageLabel = computed(() => {
    if (storage.value === "flash") {
        return t("blackboxLogsStorageFlash");
    }
    return storage.value === "sdcard" ? t("blackboxLogsStorageSdcard") : t("blackboxLogsStorageUnknown");
});

const columns = computed(() => [
    { id: "select", header: "" },
    { accessorKey: "name", header: t("blackboxLogsColumnName") },
    { accessorKey: "size", header: t("blackboxLogsColumnSize") },
    { accessorKey: "timestamp", header: t("blackboxLogsColumnDate") },
    { id: "open", header: t("blackboxLogsColumnOpen") },
    { id: "state", header: t("blackboxLogsColumnStatus") },
]);

const selectAllState = computed(() => {
    if (allSelected.value) {
        return true;
    }
    return selectedFiles.value.length > 0 ? "indeterminate" : false;
});

const selectedBytes = computed(() => selectedFiles.value.reduce((sum, f) => sum + f.size, 0));

const ALERT_STYLE = {
    success: { color: "success", icon: "i-lucide-check-circle" },
    warning: { color: "warning", icon: "i-lucide-alert-triangle" },
    error: { color: "error", icon: "i-lucide-circle-x" },
    info: { color: "info", icon: "i-lucide-info" },
};
const alertColor = computed(() => ALERT_STYLE[message.value?.type]?.color ?? "info");
const alertIcon = computed(() => ALERT_STYLE[message.value?.type]?.icon ?? "i-lucide-info");

const STATE_STYLE = {
    queued: { key: "blackboxLogsStateQueued", class: "text-dimmed" },
    downloading: { key: "blackboxLogsStateDownloading", class: "text-primary" },
    done: { key: "blackboxLogsStateDone", class: "text-success" },
    mismatch: { key: "blackboxLogsStateMismatch", class: "text-warning" },
    failed: { key: "blackboxLogsStateFailed", class: "text-error" },
    cancelled: { key: "blackboxLogsStateCancelled", class: "text-dimmed" },
};

function stateLabel(result) {
    return t(STATE_STYLE[result.state]?.key ?? "blackboxLogsStateFailed", { received: result.received });
}

function stateClass(state) {
    return STATE_STYLE[state]?.class ?? "";
}

function percent(done, total) {
    return total > 0 ? Math.min(100, (done / total) * 100) : 0;
}

const pad = (n) => String(n).padStart(2, "0");
function formatTimestamp(ts) {
    return `${ts.year}-${pad(ts.month)}-${pad(ts.day)} ${pad(ts.hours)}:${pad(ts.minutes)}:${pad(ts.seconds)}`;
}

onMounted(load);

onUnmounted(() => {
    dispose();
});
</script>
