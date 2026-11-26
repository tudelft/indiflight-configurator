<template>
    <span :class="STYLE[upload.state].class" :title="upload.error">{{ $t(STYLE[upload.state].key) }}</span>
</template>

<script setup>
defineProps({
    /** @type {import("vue").PropType<{state: "queued"|"uploading"|"uploaded"|"skipped"|"partial"|"failed", error?: string}>} */
    upload: { type: Object, required: true },
});

const STYLE = {
    queued: { key: "blackboxLogsUploadStateQueued", class: "text-dimmed" },
    uploading: { key: "blackboxLogsUploadStateUploading", class: "text-primary" },
    uploaded: { key: "blackboxLogsUploadStateUploaded", class: "text-success" },
    skipped: { key: "blackboxLogsUploadStateSkipped", class: "text-dimmed" },
    partial: { key: "blackboxLogsUploadStatePartial", class: "text-warning" },
    failed: { key: "blackboxLogsUploadStateFailed", class: "text-error" },
};
</script>
