import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { get as getConfig, set as setConfig } from "@/js/ConfigStorage";
import { LogbookClient, normalizeServerUrl } from "@/js/indiflight/logbookClient";

const STORAGE_KEY = "logbook";

/** Connection to the log database and the choice to upload downloaded blackbox logs to it. */
export const useLogbookStore = defineStore("logbook", () => {
    const saved = getConfig(STORAGE_KEY)[STORAGE_KEY] ?? {};

    const url = ref(saved.url ?? "");
    // Stays in the browser's storage, like the local build daemon's token.
    const token = ref(saved.token ?? "");
    const autoUpload = ref(saved.autoUpload ?? false);
    // Optional leading folder of the stored name; the server links a folder named after a fleet aircraft.
    const folder = ref(saved.folder ?? "");

    const configured = computed(() => normalizeServerUrl(url.value) !== "" && token.value.trim() !== "");

    function persist() {
        setConfig({
            [STORAGE_KEY]: {
                url: url.value,
                token: token.value,
                autoUpload: autoUpload.value,
                folder: folder.value,
            },
        });
    }

    function client() {
        return new LogbookClient(url.value, token.value);
    }

    /** Stored name on the server for a log file name. */
    function storedName(fileName) {
        const dir = folder.value.trim().replace(/^\/+|\/+$/g, "");
        return dir ? `${dir}/${fileName}` : fileName;
    }

    return { url, token, autoUpload, folder, configured, persist, client, storedName };
});
