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
        :ui="{ base: 'font-mono' }"
        @update:model-value="emit('update:modelValue', $event)"
        @blur="editing = false"
    />
    <div
        v-else
        ref="viewEl"
        class="highlighted-text w-full overflow-auto rounded-md bg-muted px-2.5 py-1.5 text-sm leading-5 font-mono ring ring-inset ring-accented"
        :class="readonly ? 'opacity-75' : 'cursor-text focus-visible:outline-2 outline-primary'"
        :style="{ maxHeight: `${maxrows * 1.25 + 0.75}rem`, minHeight: `${Math.min(rows, 3) * 1.25 + 0.75}rem` }"
        :tabindex="readonly ? undefined : 0"
        :role="readonly ? undefined : 'textbox'"
        :aria-label="label"
        @pointerdown="pointerDown = true"
        @click="startEditing(selectedRange())"
        @keydown.enter.self.prevent="startEditing()"
        @focus="onFocus"
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

// A mouse press focuses the div before the click lands; swapping the view then would lose the selection.
let pointerDown = false;
const viewEl = ref(null);

function onFocus() {
    if (pointerDown) return;
    startEditing();
}

/** Selection in the highlighted view as character offsets into the text, or null if outside it. */
function selectedRange() {
    const sel = window.getSelection();
    const root = viewEl.value;
    if (!root || !sel?.rangeCount || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
    const offset = (node, off) => {
        const r = document.createRange();
        r.selectNodeContents(root);
        r.setEnd(node, off);
        return r.toString().length;
    };
    const a = offset(sel.anchorNode, sel.anchorOffset);
    const f = offset(sel.focusNode, sel.focusOffset);
    return [Math.min(a, f), Math.max(a, f)];
}

/** @param {[number, number] | undefined} range caret or selection to restore; defaults to the end */
async function startEditing(range) {
    pointerDown = false;
    if (props.readonly || editing.value) return;
    editing.value = true;
    await nextTick();
    const el = textarea.value?.textareaRef;
    if (!el) return;
    el.focus();
    const [start, end] = range ?? [props.modelValue.length, props.modelValue.length];
    el.setSelectionRange(start, end);
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
