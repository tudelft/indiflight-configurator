<template>
    <BaseTab tab-name="simulation">
        <div class="content_wrapper">
            <div class="tab_title">{{ $t("tabSimulation") }}</div>

            <UiBox :title="$t('simulationSetupTitle')" collapsible class="mt-4">
                <p class="text-xs text-muted">{{ $t("simulationIntro") }}</p>
                <DaemonConnection :busy="sim.running" image="simDocker" />
                <SimulationSetup v-if="daemon.connected && daemon.info" />
            </UiBox>

            <SimulationRun v-if="daemon.connected && sim.job" class="mt-4" />
        </div>
    </BaseTab>
</template>

<script setup>
import { onMounted, watch } from "vue";
import BaseTab from "./BaseTab.vue";
import UiBox from "@/components/elements/UiBox.vue";
import DaemonConnection from "./firmware-flasher/DaemonConnection.vue";
import SimulationSetup from "./simulation/SimulationSetup.vue";
import SimulationRun from "./simulation/SimulationRun.vue";
import { useLocalBuildStore } from "@/stores/localBuild";
import { useSimulationStore } from "@/stores/simulation";
import GUI from "@/js/gui";

const daemon = useLocalBuildStore();
const sim = useSimulationStore();

// Load the selected files (and re-attach to a running simulation) once the daemon's lists arrive;
// connect() marks the store connected before it has fetched them
watch(
    () => [daemon.connected, daemon.sims, daemon.profiles],
    ([connected]) => {
        if (connected) {
            sim.refresh().catch(() => {});
        }
    },
    { immediate: true },
);

onMounted(() => {
    if (daemon.status === "disconnected") {
        daemon.connect({ silent: true });
    }
    GUI.content_ready();
});
</script>
