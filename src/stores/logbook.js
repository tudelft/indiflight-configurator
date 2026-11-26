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
    // Simulation tab: attach the script and profile that produced a log to it.
    const attachSimulationSetup = ref(saved.attachSimulationSetup ?? true);

    // Blackbox tab: the flight controller's configuration, read just before downloading logs it flew with.
    // Held in memory only and used once, so it can never end up on a log it did not fly.
    /** @type {import("vue").Ref<{text: string, at: Date}|null>} */
    const configDump = ref(null);

    const configured = computed(() => normalizeServerUrl(url.value) !== "" && token.value.trim() !== "");

    function persist() {
        setConfig({
            [STORAGE_KEY]: {
                url: url.value,
                token: token.value,
                autoUpload: autoUpload.value,
                folder: folder.value,
                attachSimulationSetup: attachSimulationSetup.value,
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

    /** The held configuration dump as an attachment, forgetting it. Null when there is none. */
    function takeConfigDump() {
        const dump = configDump.value;
        configDump.value = null;
        if (!dump) {
            return null;
        }
        return {
            name: "config_dump_all.txt",
            data: new Blob([dump.text], { type: "text/plain" }),
            description: `CLI "dump all" of the flight controller, read ${dump.at.toISOString()} before this log was downloaded`,
        };
    }

    /**
     * Upload one log; never throws, so a caller can queue uploads without handling each failure.
     *
     * @param {string} name  file name, before the folder is applied
     * @param {Blob|Uint8Array} bytes
     * @param {import("@/js/indiflight/logbookClient").LogAttachment[]} [attachments]
     * @returns {Promise<{state: "uploaded"|"skipped"|"partial"|"failed", error?: string}>}
     *   partial: the log is on the server, the attachments are not
     */
    async function upload(name, bytes, attachments = []) {
        try {
            const { status, attachError } = await client().upload(storedName(name), bytes, attachments);
            if (attachError) {
                return { state: "partial", error: attachError };
            }
            return { state: status === "skipped" ? "skipped" : "uploaded" };
        } catch (error) {
            console.error("Upload to the log database failed", error);
            return { state: "failed", error: error.message };
        }
    }

    return {
        url,
        token,
        autoUpload,
        folder,
        attachSimulationSetup,
        configured,
        configDump,
        takeConfigDump,
        persist,
        client,
        storedName,
        upload,
    };
});
