<template>
    <UTextarea
        v-if="editing && !readonly"
        ref="textarea"
        :model-value="modelValue"
        :rows="rows"
        :maxrows="maxrows"
        autoresize
        spellcheck="false"
        class="w-full"
        :ui="{ base: 'font-mono text-xs' }"
        @update:model-value="emit('update:modelValue', $event)"
        @blur="editing = false"
    />
    <div
        v-else
        class="highlighted-text w-full overflow-auto rounded-md bg-muted p-2 text-xs font-mono"
        :class="readonly ? 'opacity-75' : 'cursor-text focus-visible:outline-2 outline-primary'"
        :style="{ maxHeight: `${maxrows * 1.5}em`, minHeight: `${Math.min(rows, 3) * 1.5}em` }"
        :tabindex="readonly ? undefined : 0"
        :role="readonly ? undefined : 'textbox'"
        :aria-label="label"
        @click="startEditing"
        @keydown.enter.self.prevent="startEditing"
        @focus="startEditing"
        v-html="html"
    />
</template>

<script setup>
import { nextTick, ref, watch } from "vue";
import { highlightCode } from "@/js/utils/codeHighlight";

const props = defineProps({
    modelValue: { type: String, default: "" },
    /** @type {import("vue").PropType<"python" | "config">} */
    lang: { type: String, default: "config" },
    readonly: { type: Boolean, default: false },
    label: { type: String, default: undefined },
    rows: { type: Number, default: 18 },
    maxrows: { type: Number, default: 30 },
});
const emit = defineEmits(["update:modelValue"]);

const editing = ref(false);
const textarea = ref(null);
const html = ref("");

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

let seq = 0;
async function render() {
    const mine = ++seq;
    const text = props.modelValue;
    // Plain text until shiki has loaded, and if it fails.
    html.value = `<pre class="shiki">${escapeHtml(text)}</pre>`;
    try {
        const out = await highlightCode(text, props.lang);
        if (mine === seq) html.value = out.replace(/ tabindex="0"/, "");
    } catch (e) {
        console.error("Syntax highlighting failed", e);
    }
}

// Only re-highlight while the highlighted view is shown, not on every keystroke.
watch(
    [editing, () => props.modelValue, () => props.lang],
    () => {
        if (!editing.value) render();
    },
    { immediate: true },
);

async function startEditing() {
    if (props.readonly || editing.value) return;
    editing.value = true;
    await nextTick();
    textarea.value?.textareaRef?.focus();
}
</script>

<style>
.highlighted-text pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    background: transparent !important;
}
.highlighted-text .shiki span {
    color: var(--shiki-light);
}
.dark .highlighted-text .shiki span {
    color: var(--shiki-dark);
}
</style>
