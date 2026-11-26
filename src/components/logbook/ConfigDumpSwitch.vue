<template>
    <div class="flex flex-col gap-1">
        <USwitch
            :model-value="logbook.configDump !== null"
            :label="$t('logbookConfigDump')"
            :description="$t('logbookConfigDumpHelp')"
            :disabled="disabled || capturing || !logbook.configured || !logbook.autoUpload"
            @update:model-value="toggle"
        />
        <span v-if="capturing" class="text-xs text-muted">{{ $t("logbookConfigDumpReading") }}</span>
        <span v-else-if="logbook.configDump" class="text-xs text-success">
            {{ $t("logbookConfigDumpHeld", { time: logbook.configDump.at.toLocaleTimeString() }) }}
        </span>
        <span v-if="error" class="text-xs text-error">{{ $t("logbookConfigDumpFailed", { error }) }}</span>

        <UModal
            :open="confirmOpen"
            :title="$t('logbookConfigDumpConfirmTitle')"
            :ui="{ content: 'w-[36rem] max-w-[calc(100vw-2rem)]' }"
            @update:open="confirmOpen = $event"
        >
            <template #body>
                <p>{{ $t("logbookConfigDumpConfirmText") }}</p>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        variant="outline"
                        color="neutral"
                        :label="$t('logbookConfigDumpConfirmCancel')"
                        @click="confirmOpen = false"
                    />
                    <UButton icon="i-lucide-file-text" :label="$t('logbookConfigDumpConfirmOk')" @click="capture" />
                </div>
            </template>
        </UModal>
    </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { readCliDump } from "@/js/indiflight/cliDump";
import { useConnectionStore } from "@/stores/connection";
import { useLogbookStore } from "@/stores/logbook";

/**
 * "Attach current config dump": reads the flight controller's configuration for the next log upload, and
 * switches itself off once that upload has taken it (see takeConfigDump in the logbook store).
 */
defineProps({
    // No dump while the link is in use, for example during a download
    disabled: { type: Boolean, default: false },
});

const logbook = useLogbookStore();
const connectionStore = useConnectionStore();
const confirmOpen = ref(false);
const capturing = ref(false);
const error = ref("");

// Without automatic uploads nothing would take the dump, and it would wait for some later, unrelated log
watch(
    () => logbook.configured && logbook.autoUpload,
    (uploading) => {
        if (!uploading) {
            logbook.configDump = null;
        }
    },
);

function toggle(on) {
    error.value = "";
    if (on) {
        confirmOpen.value = true;
    } else {
        logbook.configDump = null;
    }
}

async function capture() {
    confirmOpen.value = false;
    capturing.value = true;
    connectionStore.pauseLiveData();
    try {
        // The FC reboots after the read, so this ends the session's current link
        logbook.configDump = { text: await readCliDump("dump all"), at: new Date() };
    } catch (e) {
        console.error("Could not read the configuration", e);
        error.value = e.message;
    } finally {
        connectionStore.resumeLiveData();
        capturing.value = false;
    }
}
</script>
