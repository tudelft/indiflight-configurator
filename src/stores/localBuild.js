import { defineStore } from "pinia";
import { computed, reactive, ref, shallowRef } from "vue";
import { get as getConfig, set as setConfig } from "@/js/ConfigStorage";
import { parseConfig, mergeConfigs } from "@/js/indiflight/configParser";
import { LocalBuilderClient, DEFAULT_BUILDER_URL } from "@/js/indiflight/localBuilderClient";

const STORAGE_KEY = "localBuilder";
const MAX_LOG_LINES = 5000;
const FINISHED_STATES = ["success", "failed", "cancelled", "stopped"];
const SAFE_ARTIFACT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.hex$/;

/** @typedef {"boards" | "profiles"} ConfigKind */

/**
 * Local firmware compilation through the `start.py` build daemon in an Indiflight working directory.
 */
export const useLocalBuildStore = defineStore("localBuild", () => {
    const saved = getConfig(STORAGE_KEY)[STORAGE_KEY] ?? {};

    // Connection
    const url = ref(saved.url ?? DEFAULT_BUILDER_URL);
    // Capability token for a localhost-only daemon; persisted so the user pastes it once per machine
    const token = ref(saved.token ?? "");
    /** @type {import("vue").Ref<"disconnected" | "connecting" | "connected" | "error">} */
    const status = ref("disconnected");
    const error = ref("");
    const info = ref(null);
    const tokenRequired = ref(false);
    /** @type {import("vue").ShallowRef<LocalBuilderClient | null>} */
    const client = shallowRef(null);

    // Configuration selection
    const boards = ref([]);
    const profiles = ref([]);
    // SIL simulation scripts; listed here because the simulation store shares this connection
    const sims = ref([]);
    const board = ref(saved.board ?? "");
    const profile = ref(saved.profile ?? "");
    /** Text as stored in the working directory */
    const repoText = reactive({ boards: "", profiles: "" });
    /** User edits; null means "use the repo file unchanged" */
    const editedText = reactive({ boards: null, profiles: null });

    // Build options
    const options = reactive({ debug: null, extraFlags: "", clean: false });

    // Current job
    const job = ref(null);
    const log = ref([]);
    const progress = reactive({ done: 0, total: null, file: "" });
    // True while the build request is in flight; the daemon takes a few seconds to snapshot git state
    const starting = ref(false);
    let closeStream = null;

    const connected = computed(() => status.value === "connected");
    const building = computed(() => starting.value || (!!job.value && !FINISHED_STATES.includes(job.value.state)));

    function effectiveText(kind) {
        return editedText[kind] ?? repoText[kind];
    }

    const boardModified = computed(() => editedText.boards !== null && editedText.boards !== repoText.boards);
    const profileModified = computed(() => editedText.profiles !== null && editedText.profiles !== repoText.profiles);

    const parsedBoard = computed(() => (board.value ? parseConfig(effectiveText("boards"), "board") : null));
    const parsedProfile = computed(() =>
        profile.value || editedText.profiles ? parseConfig(effectiveText("profiles"), "profile") : null,
    );
    const merged = computed(() => mergeConfigs(parsedBoard.value, parsedProfile.value));

    function persist() {
        setConfig({
            [STORAGE_KEY]: { url: url.value, token: token.value, board: board.value, profile: profile.value },
        });
    }

    /**
     * @param {{silent?: boolean}} [opts]  silent: an unreachable daemon leaves the state "disconnected"
     *                                     instead of showing an error (used for auto-connect on tab open)
     */
    async function connect({ silent = false } = {}) {
        persist();
        closeStream?.();
        status.value = "connecting";
        error.value = "";
        const candidate = new LocalBuilderClient(url.value, token.value);
        try {
            const ping = await candidate.ping();
            tokenRequired.value = !!ping.tokenRequired;
            info.value = await candidate.info();
            client.value = candidate;
            status.value = "connected";
            await refreshConfigs();
            // A running simulation is attached by the simulation store; older daemons send no kind
            if (info.value.activeJob && (info.value.activeJobKind ?? "build") === "build") {
                await attachJob(info.value.activeJob);
            }
        } catch (e) {
            client.value = null;
            if (silent && e.status === 0) {
                status.value = "disconnected";
                return;
            }
            status.value = "error";
            error.value = e.status === 401 ? "Invalid or missing token" : e.message;
        }
    }

    function disconnect() {
        closeStream?.();
        closeStream = null;
        client.value = null;
        status.value = "disconnected";
    }

    async function refreshInfo() {
        if (client.value) {
            info.value = await client.value.info();
        }
    }

    async function refreshConfigs() {
        const lists = await client.value.configs();
        boards.value = lists.boards;
        profiles.value = lists.profiles;
        sims.value = lists.sims ?? [];
        if (!boards.value.includes(board.value)) {
            board.value = boards.value[0] ?? "";
        }
        if (profile.value && !profiles.value.includes(profile.value)) {
            profile.value = "";
        }
        await Promise.all([loadFile("boards"), loadFile("profiles")]);
    }

    /** Reload a config file from disk; discards edits to it. */
    async function loadFile(kind) {
        const name = kind === "boards" ? board.value : profile.value;
        editedText[kind] = null;
        repoText[kind] = name ? await client.value.configFile(kind, name) : "";
    }

    /** Re-read a config file from disk, keeping an imported override: picks up edits made in an external editor. */
    async function refreshFromDisk(kind) {
        const name = kind === "boards" ? board.value : profile.value;
        if (!name) return;
        const text = await client.value.configFile(kind, name);
        if (name === (kind === "boards" ? board.value : profile.value)) {
            repoText[kind] = text;
        }
    }

    async function selectBoard(name) {
        board.value = name;
        persist();
        await loadFile("boards");
    }

    async function selectProfile(name) {
        profile.value = name;
        persist();
        await loadFile("profiles");
    }

    /**
     * @param {ConfigKind} kind
     * @param {string | null} text  null reverts to the repo file
     */
    function setText(kind, text) {
        editedText[kind] = text === repoText[kind] ? null : text;
    }

    function resetJobView() {
        log.value = [];
        Object.assign(progress, { done: 0, total: null, file: "" });
    }

    function appendLog(entry) {
        log.value.push(entry);
        if (log.value.length > MAX_LOG_LINES) {
            log.value.splice(0, log.value.length - MAX_LOG_LINES);
        }
    }

    /** Stream a job's events; resolves with the final job summary. */
    function attachJob(id) {
        closeStream?.();
        resetJobView();
        return new Promise((resolve) => {
            closeStream = client.value.subscribe(id, {
                log: appendLog,
                progress: (p) => Object.assign(progress, p),
                state: (summary) => {
                    job.value = summary;
                },
                end: (summary) => {
                    job.value = summary;
                    closeStream = null;
                    resolve(summary);
                },
                error: async (e) => {
                    closeStream = null;
                    appendLog({ line: e.message, stream: "meta" });
                    try {
                        job.value = await client.value.job(id);
                    } catch {
                        // daemon gone: keep the last known state
                    }
                    resolve(job.value);
                },
            });
        });
    }

    /** Start a build of the current selection; resolves with the final job summary. */
    async function build() {
        const request = {
            board: board.value,
            profile: profile.value || null,
            debug: options.debug,
            extraFlags: options.extraFlags.trim(),
            clean: options.clean,
        };
        if (boardModified.value) {
            request.boardText = editedText.boards;
        }
        if (profileModified.value || (!profile.value && editedText.profiles)) {
            request.profileText = editedText.profiles;
        }
        starting.value = true;
        let id;
        try {
            ({ id } = await client.value.startBuild(request));
            job.value = await client.value.job(id);
        } finally {
            starting.value = false;
        }
        const final = await attachJob(id);
        await refreshInfo().catch(() => {});
        return final;
    }

    async function cancel() {
        if (job.value) {
            job.value = await client.value.cancel(job.value.id);
        }
    }

    /** @returns {Promise<{name: string, text: string} | null>} the hex of the last successful job */
    async function fetchHex() {
        const hex = job.value?.artifacts?.find((a) => a.kind === "hex");
        if (job.value?.state !== "success" || !hex) {
            return null;
        }
        // The flasher shows the name in messages it renders as HTML
        if (!SAFE_ARTIFACT_RE.test(hex.name)) {
            throw new Error("Daemon returned an unexpected artifact name");
        }
        return { name: hex.name, text: await client.value.artifactText(job.value.id, hex.name) };
    }

    return {
        url,
        token,
        status,
        error,
        info,
        tokenRequired,
        /** shared with the simulation store */
        client,
        connected,
        boards,
        profiles,
        sims,
        board,
        profile,
        repoText,
        editedText,
        boardModified,
        profileModified,
        effectiveText,
        parsedBoard,
        parsedProfile,
        merged,
        options,
        job,
        log,
        progress,
        building,
        connect,
        disconnect,
        refreshInfo,
        refreshConfigs,
        loadFile,
        refreshFromDisk,
        selectBoard,
        selectProfile,
        setText,
        build,
        cancel,
        fetchHex,
    };
});
