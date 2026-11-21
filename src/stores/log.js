import { defineStore } from "pinia";
import { ref } from "vue";
import DOMPurify from "dompurify";

const MAX_ENTRIES = 1000;

function pad(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

function formatTimestamp(date) {
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}-${month}-${day} @${hours}:${minutes}:${seconds}`;
}

// Messages are shown as HTML for the formatting in translations, but callers also interpolate text from FCs, files
// and other websites (log names). Keep the formatting tags only, so nothing interpolated can run script.
const SANITIZE_OPTIONS = {
    ALLOWED_TAGS: ["a", "b", "br", "code", "em", "h3", "i", "li", "p", "small", "span", "strong", "u", "ul"],
    ALLOWED_ATTR: ["class", "href", "target", "rel"],
};

export const useLogStore = defineStore("log", () => {
    const entries = ref([]);

    function add(message) {
        const entry = {
            id: entries.value.length ? entries.value[entries.value.length - 1].id + 1 : 1,
            timestamp: formatTimestamp(new Date()),
            message: DOMPurify.sanitize(String(message), SANITIZE_OPTIONS),
        };
        entries.value.push(entry);
        if (entries.value.length > MAX_ENTRIES) {
            entries.value.splice(0, entries.value.length - MAX_ENTRIES);
        }
    }

    function clear() {
        entries.value = [];
    }

    return { entries, add, clear };
});
