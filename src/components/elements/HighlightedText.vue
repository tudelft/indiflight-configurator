<template>
    <div
        class="highlighted-text w-full overflow-auto rounded-md bg-muted px-2.5 py-1.5 text-sm leading-5 font-mono ring ring-inset ring-accented select-text"
        :style="{ maxHeight: `${maxrows * 1.25 + 0.75}rem` }"
        role="region"
        :aria-label="label"
        tabindex="0"
        v-html="html"
    />
</template>

<script setup>
import { ref, watch } from "vue";
import { highlightCode } from "@/js/utils/codeHighlight";

const props = defineProps({
    text: { type: String, default: "" },
    /** @type {import("vue").PropType<"python" | "config">} */
    lang: { type: String, default: "config" },
    label: { type: String, default: undefined },
    maxrows: { type: Number, default: 30 },
});

const html = ref("");

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

let seq = 0;
async function render() {
    const mine = ++seq;
    // Plain text until shiki has loaded, and if it fails.
    html.value = `<pre class="shiki">${escapeHtml(props.text)}</pre>`;
    try {
        const out = await highlightCode(props.text, props.lang);
        if (mine === seq) html.value = out.replace(/ tabindex="0"/, "");
    } catch (e) {
        console.error("Syntax highlighting failed", e);
    }
}

watch(() => [props.text, props.lang], render, { immediate: true });
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
