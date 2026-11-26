<template>
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
            v-if="auto"
            v-model="logbook.autoUpload"
            :label="$t('blackboxLogsUploadAuto')"
            :disabled="!logbook.configured"
            @update:model-value="logbook.persist()"
        />
        <USwitch
            v-if="attachSetup"
            v-model="logbook.attachSimulationSetup"
            :label="$t('simulationUploadAttachSetup')"
            :description="$t('simulationUploadAttachSetupHelp')"
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
</template>

<script setup>
import { ref } from "vue";
import UiBox from "@/components/elements/UiBox.vue";
import { useLogbookStore } from "@/stores/logbook";

/** Connection settings of the log database upload, shared by every tab that uploads logs. */
defineProps({
    // Whether the tab can upload by itself; only downloading logs from the flight controller does.
    auto: { type: Boolean, default: true },
    // Whether the tab can attach the files a log was made with (the simulation's script and profile).
    attachSetup: { type: Boolean, default: false },
});

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
</script>
