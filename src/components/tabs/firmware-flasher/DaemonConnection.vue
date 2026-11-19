<template>
    <!-- Connection to the local build daemon (start.py), shared by local builds and simulations -->
    <div class="flex flex-wrap items-end gap-2">
        <UFormField :label="$t('localBuildDaemonUrl')" size="sm">
            <UInput v-model="store.url" size="sm" class="w-56 font-mono" :disabled="locked" />
        </UFormField>
        <UFormField :label="$t('localBuildToken')" size="sm">
            <UInput
                v-model="store.token"
                type="password"
                size="sm"
                class="w-56 font-mono"
                :disabled="locked"
                @keydown.enter="store.connect()"
            />
        </UFormField>
        <UButton
            size="sm"
            :icon="store.connected ? 'i-lucide-refresh-cw' : 'i-lucide-plug'"
            :loading="store.status === 'connecting'"
            :disabled="locked"
            @click="store.connect()"
        >
            {{ store.connected ? $t("localBuildReconnect") : $t("localBuildConnect") }}
        </UButton>
    </div>

    <UAlert v-if="store.status === 'error'" color="error" variant="subtle" :title="store.error" />

    <!-- Keyed on connection state so it re-opens by default after a disconnect -->
    <details :key="String(store.connected)" :open="!store.connected" class="text-sm">
        <summary class="cursor-pointer text-muted">{{ $t("localBuildSetupTitle") }}</summary>
        <div class="pt-2">
            <LocalBuildSetupGuide />
        </div>
    </details>

    <template v-if="store.connected && store.info">
        <!-- Working directory and docker image state -->
        <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="font-mono text-muted">{{ store.info.repo }}</span>
            <UBadge color="neutral" variant="subtle" size="sm" class="font-mono">
                {{ store.info.git.branch ?? "detached" }} @ {{ store.info.git.describe }}
            </UBadge>
            <UBadge v-if="store.info.git.dirty" color="warning" variant="subtle" size="sm">
                {{ $t("localBuildDirty") }}
            </UBadge>
            <UBadge
                v-if="docker"
                :color="dockerBadge.color"
                variant="subtle"
                size="sm"
                :title="docker.error ?? docker.image"
            >
                {{ dockerBadge.label }}
            </UBadge>
        </div>
        <UAlert
            v-if="store.info.git.submodulesMissing?.length"
            color="warning"
            variant="subtle"
            :title="$t('localBuildSubmodulesMissing')"
            :description="store.info.git.submodulesMissing.join(', ')"
        />
    </template>
</template>

<script setup>
import { computed, inject } from "vue";
import LocalBuildSetupGuide from "./LocalBuildSetupGuide.vue";
import { useLocalBuildStore } from "@/stores/localBuild";
import { i18n } from "@/js/localization";

const props = defineProps({
    /** A job is running: connection settings stay as they are */
    busy: { type: Boolean, default: false },
    /** Which image state of /api/info to show: the firmware builder or the SIL runner */
    image: { type: String, default: "docker", validator: (v) => ["docker", "simDocker"].includes(v) },
});

const $t = inject("$t", (key, params) => i18n.getMessage(key, params));
const store = useLocalBuildStore();

const locked = computed(() => props.busy || store.status === "connecting");
const docker = computed(() => store.info?.[props.image] ?? null);

const BADGE_KEYS = {
    docker: { outdated: "localBuildDockerOutdated", ready: "localBuildDockerReady" },
    simDocker: { outdated: "simulationDockerOutdated", ready: "simulationDockerReady" },
};

const dockerBadge = computed(() => {
    if (!docker.value.available) {
        return { color: "error", label: $t("localBuildDockerUnavailable") };
    }
    if (!docker.value.exists || !docker.value.upToDate) {
        return { color: "warning", label: $t(BADGE_KEYS[props.image].outdated) };
    }
    return { color: "success", label: $t(BADGE_KEYS[props.image].ready) };
});
</script>
