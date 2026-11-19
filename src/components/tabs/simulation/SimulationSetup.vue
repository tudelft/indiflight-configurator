<template>
    <!-- Script / profile selection -->
    <div class="flex flex-wrap items-end gap-2">
        <UFormField :label="$t('simulationScript')" size="sm">
            <USelect
                :model-value="sim.sim"
                :items="daemon.sims"
                size="sm"
                class="min-w-48"
                :disabled="sim.running"
                @update:model-value="sim.selectSim"
            />
        </UFormField>
        <UFormField :label="$t('localBuildProfile')" size="sm">
            <USelect
                :model-value="sim.profile"
                :items="daemon.profiles"
                size="sm"
                class="min-w-48"
                :disabled="sim.running"
                @update:model-value="sim.selectProfile"
            />
        </UFormField>
        <UButton
            size="sm"
            variant="ghost"
            icon="i-lucide-folder-sync"
            :disabled="sim.running"
            :title="$t('localBuildRescanTitle')"
            @click="sim.rescan()"
        >
            {{ $t("localBuildRescan") }}
        </UButton>
        <UBadge v-if="sim.simModified" color="warning" variant="subtle" size="sm" class="mb-1">
            {{ $t("simulationScriptModified") }}
        </UBadge>
    </div>
    <UAlert v-if="!daemon.sims.length" color="warning" variant="subtle" :title="$t('simulationNoScripts')" />

    <UAlert
        v-if="sim.simModified && !daemon.tokenRequired"
        color="warning"
        variant="subtle"
        :title="$t('simulationEditNeedsToken')"
    />

    <BuildConfigPreview :source="sim" cli-note="simulationCliNote" :readonly="sim.running" />

    <!-- Script options, read from its argparse calls -->
    <div v-if="sim.availableFlags.length" class="flex flex-col gap-1">
        <div class="text-xs font-semibold text-muted">{{ $t("simulationOptions") }}</div>
        <div class="flex flex-wrap gap-x-4 gap-y-1">
            <label
                v-for="f in sim.availableFlags"
                :key="f.flag"
                class="flex items-center gap-2 text-sm"
                :title="f.help"
            >
                <USwitch
                    :model-value="sim.options.flags.includes(f.flag)"
                    size="xs"
                    :disabled="sim.running"
                    @update:model-value="(on) => sim.toggleFlag(f.flag, on)"
                />
                <span class="font-mono">{{ f.flag }}</span>
            </label>
        </div>
    </div>

    <div class="flex flex-wrap items-end gap-3">
        <UFormField :label="$t('localBuildDebug')" size="sm">
            <USelect
                :model-value="sim.options.debug ?? 'NONE'"
                :items="debugItems"
                size="sm"
                class="min-w-40"
                :disabled="sim.running"
                @update:model-value="(v) => (sim.options.debug = v === 'NONE' ? null : v)"
            />
        </UFormField>
        <UFormField
            :label="$t('simulationExtraArgs')"
            size="sm"
            class="grow"
            :error="sim.extraArgs.invalid.length ? sim.extraArgs.invalid.join(' ') : false"
        >
            <UInput
                v-model="sim.options.extraArgs"
                size="sm"
                class="w-full font-mono"
                placeholder="--no-real-time"
                :disabled="sim.running"
            />
        </UFormField>
        <label class="flex items-center gap-2 text-sm pb-1" :title="$t('simulationGdbserverTitle')">
            <USwitch v-model="sim.options.gdbserver" size="sm" :disabled="sim.running || !sim.options.debug" />
            {{ $t("simulationGdbserver") }}
        </label>
        <label class="flex items-center gap-2 text-sm pb-1" :title="$t('simulationHostNetworkTitle')">
            <USwitch v-model="sim.options.hostNetwork" size="sm" :disabled="sim.running" />
            {{ $t("simulationHostNetwork") }}
        </label>
    </div>

    <div class="flex flex-wrap items-center gap-2">
        <UButton
            color="success"
            icon="i-lucide-play"
            :loading="sim.starting"
            :disabled="sim.running || !sim.sim || !sim.profile"
            @click="onStart"
        >
            {{ $t("simulationStart") }}
        </UButton>
        <UButton v-if="sim.running" color="error" variant="soft" icon="i-lucide-square" @click="sim.stop()">
            {{ $t("simulationStop") }}
        </UButton>
        <code class="text-xs text-muted">{{ commandPreview }}</code>
        <span v-if="startError" class="text-xs text-error">{{ startError }}</span>
    </div>
</template>

<script setup>
import { computed, inject, ref, watch } from "vue";
import BuildConfigPreview from "../firmware-flasher/BuildConfigPreview.vue";
import { useLocalBuildStore } from "@/stores/localBuild";
import { useSimulationStore } from "@/stores/simulation";
import { gui_log } from "@/js/gui_log";
import { i18n } from "@/js/localization";
import { escapeHtml } from "@/js/utils/common";

const $t = inject("$t", (key, params) => i18n.getMessage(key, params));
const daemon = useLocalBuildStore();
const sim = useSimulationStore();

const debugItems = [
    { label: "Release", value: "NONE" },
    { label: "INFO (-O2 + symbols)", value: "INFO" },
    { label: "GDB (-O0 + symbols)", value: "GDB" },
];

const startError = ref("");

// gdbserver needs debug symbols
watch(
    () => sim.options.debug,
    (debug) => {
        if (!debug) {
            sim.options.gdbserver = false;
        }
    },
);

/** What the run boils down to, in the README's terms */
const commandPreview = computed(() =>
    [
        `SIM=${sim.simModified ? "(edited)" : sim.sim}`,
        `PROFILE=${sim.profileModified ? "(edited)" : sim.profile}`,
        ...sim.args,
    ].join(" "),
);

async function onStart() {
    startError.value = "";
    try {
        await sim.start();
    } catch (e) {
        startError.value = e.message;
        // The log renders HTML and the message can come from the daemon
        gui_log(`${$t("simulationFailedToStart")}: ${escapeHtml(e.message)}`);
    }
}
</script>
