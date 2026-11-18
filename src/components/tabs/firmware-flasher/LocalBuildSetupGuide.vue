<template>
    <div class="flex flex-col gap-2">
        <SubtabNav v-model="os" :items="osItems" />
        <ol class="flex flex-col gap-3 pl-5 list-decimal text-sm">
            <!-- li stays display:list-item so it keeps its number; layout goes on the inner div -->
            <li v-for="step in guides[os]" :key="step.text">
                <div class="flex flex-col gap-1">
                    <span>{{ $t(step.text) }}</span>
                    <span v-if="step.links" class="flex flex-wrap gap-x-4 gap-y-1">
                        <a
                            v-for="link in step.links"
                            :key="link.href"
                            :href="link.href"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-primary underline"
                            >{{ $t(link.label) }}</a
                        >
                    </span>
                    <div v-if="step.command" class="flex items-start gap-1">
                        <pre class="grow overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono text-xs">{{
                            step.command
                        }}</pre>
                        <UButton
                            size="xs"
                            variant="ghost"
                            icon="i-lucide-copy"
                            :aria-label="$t('localBuildSetupCopy')"
                            :title="$t('localBuildSetupCopy')"
                            @click="copy(step.command)"
                        />
                    </div>
                </div>
            </li>
        </ol>
    </div>
</template>

<script setup>
import { inject, ref } from "vue";
import SubtabNav from "@/components/elements/SubtabNav.vue";
import Clipboard from "@/js/Clipboard";
import { gui_log } from "@/js/gui_log";
import { i18n } from "@/js/localization";

const $t = inject("$t", (key, params) => i18n.getMessage(key, params));

const REPO_URL = "https://github.com/tudelft/indiflight.git";
const CLONE = `git clone --recurse-submodules ${REPO_URL}\ncd indiflight`;
const START = "python3 start.py";

const LINKS = {
    dockerEngine: { href: "https://docs.docker.com/engine/install/", label: "localBuildSetupLinkDockerEngine" },
    dockerPostInstall: {
        href: "https://docs.docker.com/engine/install/linux-postinstall/",
        label: "localBuildSetupLinkDockerPostInstall",
    },
    dockerMac: {
        href: "https://docs.docker.com/desktop/setup/install/mac-install/",
        label: "localBuildSetupLinkDockerMac",
    },
    dockerWindows: {
        href: "https://docs.docker.com/desktop/setup/install/windows-install/",
        label: "localBuildSetupLinkDockerWindows",
    },
    dockerWsl: { href: "https://docs.docker.com/desktop/features/wsl/", label: "localBuildSetupLinkDockerWsl" },
    wsl: { href: "https://learn.microsoft.com/en-us/windows/wsl/install", label: "localBuildSetupLinkWsl" },
};

const tokenStep = { text: "localBuildSetupToken" };

const guides = {
    linux: [
        {
            text: "localBuildSetupLinuxDocker",
            links: [LINKS.dockerEngine, LINKS.dockerPostInstall],
            command: "sudo usermod -aG docker $USER",
        },
        { text: "localBuildSetupLinuxTools", command: "sudo apt update && sudo apt install -y git python3" },
        { text: "localBuildSetupClone", command: CLONE },
        { text: "localBuildSetupStart", command: START },
        tokenStep,
    ],
    mac: [
        { text: "localBuildSetupMacDocker", links: [LINKS.dockerMac] },
        { text: "localBuildSetupMacTools", command: "xcode-select --install" },
        { text: "localBuildSetupClone", command: CLONE },
        { text: "localBuildSetupMacStart", command: START },
        tokenStep,
    ],
    windows: [
        { text: "localBuildSetupWslInstall", links: [LINKS.wsl], command: "wsl --install" },
        { text: "localBuildSetupWinDocker", links: [LINKS.dockerWindows, LINKS.dockerWsl] },
        { text: "localBuildSetupWslTools", command: "sudo apt update && sudo apt install -y git python3" },
        { text: "localBuildSetupWslClone", command: `cd ~\n${CLONE}` },
        { text: "localBuildSetupStart", command: START },
        { text: "localBuildSetupWslToken" },
    ],
};

const osItems = [
    { label: "Linux", value: "linux" },
    { label: "macOS", value: "mac" },
    { label: "Windows (WSL2)", value: "windows" },
];

function detectOs() {
    const platform = navigator.userAgentData?.platform ?? navigator.platform ?? "";
    if (/win/i.test(platform)) {
        return "windows";
    }
    if (/mac/i.test(platform)) {
        return "mac";
    }
    return "linux";
}

const os = ref(detectOs());

function copy(text) {
    Clipboard.writeText(text, () => gui_log($t("localBuildSetupCopied")));
}
</script>
