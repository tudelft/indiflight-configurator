<template>
    <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2 text-sm">
            <span>
                <strong>{{ $t("localBuildTarget") }}</strong>
                <span class="font-mono ml-1">{{ merged.target ?? "—" }}</span>
            </span>
            <UBadge v-if="store.boardModified" color="warning" variant="subtle" size="sm">
                {{ $t("localBuildBoardModified") }}
            </UBadge>
            <UBadge v-if="store.profileModified" color="warning" variant="subtle" size="sm">
                {{ $t("localBuildProfileModified") }}
            </UBadge>
            <UBadge v-if="duplicateCount" :color="hasConflict ? 'error' : 'warning'" variant="subtle" size="sm">
                {{ $t("localBuildDuplicateDefines", { count: duplicateCount }) }}
            </UBadge>
        </div>

        <SubtabNav v-model="view" :items="views" />

        <!-- Build flags: what make turns into -D options -->
        <div v-if="view === 'flags'" class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center gap-4 text-xs text-muted">
                <span class="flex items-center gap-1">
                    <UBadge color="neutral" variant="outline" size="sm">board</UBadge>
                    <UBadge color="primary" variant="outline" size="sm">profile</UBadge>
                    <UBadge color="info" variant="outline" size="sm">{{ $t("localBuildExtraFlags") }}</UBadge>
                </span>
                <label class="flex items-center gap-2">
                    <USwitch v-model="showDisabled" size="xs" />
                    {{ $t("localBuildShowDisabled", { count: merged.disabledDefines.length }) }}
                </label>
            </div>
            <div v-for="group in defineGroups" :key="group.section" class="flex flex-col gap-1">
                <div class="text-xs font-semibold text-muted">{{ group.section }}</div>
                <div class="flex flex-wrap gap-1">
                    <UBadge
                        v-for="item in group.items"
                        :key="`${item.source}:${item.line}`"
                        :color="item.color"
                        :variant="item.enabled ? 'subtle' : 'outline'"
                        size="sm"
                        :class="['font-mono', { 'opacity-50 line-through': !item.enabled }]"
                        :title="item.title"
                    >
                        {{ item.token }}
                    </UBadge>
                </div>
            </div>
            <div v-if="extraFlagTokens.length" class="flex flex-col gap-1">
                <div class="text-xs font-semibold text-muted">{{ $t("localBuildExtraFlags") }}</div>
                <div class="flex flex-wrap gap-1">
                    <UBadge
                        v-for="flag in extraFlagTokens"
                        :key="flag"
                        color="info"
                        variant="subtle"
                        size="sm"
                        class="font-mono"
                    >
                        {{ flag }}
                    </UBadge>
                </div>
            </div>
        </div>

        <!-- Runtime settings: sent through the CLI after flashing, not compiled in -->
        <div v-else-if="view === 'cli'" class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-xs text-muted">{{ $t(cliNote) }}</p>
                <UButton size="xs" variant="soft" icon="i-lucide-copy" @click="copyCliScript">
                    {{ $t("localBuildCopyCli") }}
                </UButton>
            </div>
            <div v-for="group in settingGroups" :key="group.context" class="flex flex-col gap-1">
                <div class="text-xs font-semibold text-muted">{{ group.context || $t("localBuildGlobalContext") }}</div>
                <table class="w-full text-xs font-mono">
                    <tbody>
                        <tr
                            v-for="setting in group.items"
                            :key="setting.key"
                            class="border-b border-default"
                            :title="setting.command.comment"
                        >
                            <td class="py-0.5 pr-3">{{ setting.key }}</td>
                            <td class="py-0.5 pr-3">
                                {{ setting.value }}
                                <span
                                    v-for="old in setting.overridden"
                                    :key="`${old.source}:${old.line}`"
                                    class="ml-2 text-dimmed line-through"
                                    :title="`${old.source}:${old.line}`"
                                    >{{ old.command.replace(/^set\s+\S+\s*=\s*/, "") }}</span
                                >
                            </td>
                            <td class="py-0.5 text-right">
                                <UBadge
                                    :color="setting.command.source === 'board' ? 'neutral' : 'primary'"
                                    variant="outline"
                                    size="sm"
                                >
                                    {{ setting.command.source }}:{{ setting.command.line }}
                                </UBadge>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <details v-for="group in commandGroups" :key="group.name" class="text-xs">
                <summary class="cursor-pointer text-muted">
                    <span class="font-mono">{{ group.name }}</span> ({{ group.items.length }})
                </summary>
                <ul class="font-mono pl-4 pt-1">
                    <li v-for="cmd in group.items" :key="`${cmd.source}:${cmd.line}`" :title="cmd.comment">
                        <span v-if="cmd.context" class="text-dimmed">[{{ cmd.context }}] </span>{{ cmd.command }}
                    </li>
                </ul>
            </details>
        </div>

        <!-- Raw files, editable; edits are mounted over the repo file for the build only -->
        <div v-else class="grid gap-3 md:grid-cols-2">
            <div v-for="file in files" :key="file.kind" class="flex flex-col gap-1">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-semibold">
                        {{ $t(file.labelKey) }}
                        <span class="font-mono font-normal text-muted">{{ file.name }}</span>
                    </span>
                    <span class="flex gap-1">
                        <UButton
                            size="xs"
                            variant="ghost"
                            icon="i-lucide-file-up"
                            :disabled="readonly"
                            @click="importFile(file)"
                        >
                            {{ $t("localBuildImport") }}
                        </UButton>
                        <UButton
                            size="xs"
                            variant="ghost"
                            icon="i-lucide-undo-2"
                            :disabled="readonly || !file.modified"
                            @click="store.setText(file.kind, null)"
                        >
                            {{ $t("localBuildRevert") }}
                        </UButton>
                    </span>
                </div>
                <UTextarea
                    :model-value="store.effectiveText(file.kind)"
                    :rows="18"
                    :disabled="readonly"
                    autoresize
                    :maxrows="30"
                    spellcheck="false"
                    class="w-full"
                    :ui="{ base: 'font-mono text-xs' }"
                    @update:model-value="store.setText(file.kind, $event)"
                />
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import SubtabNav from "@/components/elements/SubtabNav.vue";
import { useLocalBuildStore } from "@/stores/localBuild";
import FileSystem from "@/js/FileSystem";
import Clipboard from "@/js/Clipboard";
import { gui_log } from "@/js/gui_log";
import { i18n } from "@/js/localization";

const props = defineProps({
    /**
     * Config source with the local build store's shape (merged, effectiveText, setText, ...);
     * may add `files` to choose the editable files. Defaults to the local build store.
     */
    source: { type: Object, default: null },
    /** i18n key of the note on how CLI settings reach the flight controller */
    cliNote: { type: String, default: "localBuildCliNote" },
    readonly: { type: Boolean, default: false },
});

const $t = inject("$t", (key, params) => i18n.getMessage(key, params));
const localBuild = useLocalBuildStore();
// Not reactive to a later prop change: each tab passes one fixed store
const store = props.source ?? localBuild;
const merged = computed(() => store.merged);

const view = ref("flags");
const views = computed(() => [
    { label: $t("localBuildViewFlags"), value: "flags" },
    { label: $t("localBuildViewCli"), value: "cli" },
    { label: $t("localBuildViewFiles"), value: "files" },
]);
const showDisabled = ref(false);

const duplicateCount = computed(() => merged.value.defines.filter((d) => d.duplicates.length).length);
const hasConflict = computed(() =>
    merged.value.defines.some(({ define, duplicates }) => duplicates.some((d) => d.token !== define.token)),
);

const SOURCE_COLOR = { board: "neutral", profile: "primary" };

function defineColor({ define, duplicates }) {
    // Identical redefinitions compile fine; differing values are a compiler error
    if (duplicates.some((d) => d.token !== define.token)) {
        return "error";
    }
    return duplicates.length ? "warning" : SOURCE_COLOR[define.source];
}

const defineGroups = computed(() => {
    const items = merged.value.defines.map(({ define, duplicates }) => ({
        ...define,
        color: defineColor({ define, duplicates }),
        title: [
            `${define.source}:${define.line}`,
            define.comment,
            ...duplicates.map((d) => `also ${d.source}:${d.line} (${d.token})`),
        ]
            .filter(Boolean)
            .join("\n"),
    }));
    if (showDisabled.value) {
        items.push(
            ...merged.value.disabledDefines.map((d) => ({
                ...d,
                color: SOURCE_COLOR[d.source],
                title: [`${d.source}:${d.line} (disabled)`, d.comment].filter(Boolean).join("\n"),
            })),
        );
    }
    const groups = new Map();
    for (const item of items) {
        const key = `${item.source}: ${item.section}`;
        if (!groups.has(key)) {
            groups.set(key, { section: item.section ? key : item.source, items: [] });
        }
        groups.get(key).items.push(item);
    }
    return [...groups.values()];
});

const extraFlagTokens = computed(() => (store.options.extraFlags ?? "").split(/\s+/).filter(Boolean));

function groupBy(list, keyOf) {
    const groups = new Map();
    for (const item of list) {
        const key = keyOf(item);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(item);
    }
    return groups;
}

const settingGroups = computed(() =>
    [...groupBy(merged.value.settings, (s) => s.context)].map(([context, items]) => ({ context, items })),
);

const commandGroups = computed(() =>
    [...groupBy(merged.value.otherCommands, (c) => c.command.split(/\s+/)[0])].map(([name, items]) => ({
        name,
        items,
    })),
);

const files = computed(
    () =>
        store.files ?? [
            { kind: "boards", labelKey: "localBuildBoard", name: store.board, modified: store.boardModified },
            { kind: "profiles", labelKey: "localBuildProfile", name: store.profile, modified: store.profileModified },
        ],
);

function copyCliScript() {
    Clipboard.writeText([...merged.value.cliScript, "save"].join("\n"), () => gui_log($t("localBuildCliCopied")));
}

async function importFile({ kind, ext = ".txt" }) {
    const file = await FileSystem.pickOpenFile($t("localBuildConfigFiles"), [ext]);
    if (file) {
        store.setText(kind, await FileSystem.readFile(file));
    }
}
</script>
