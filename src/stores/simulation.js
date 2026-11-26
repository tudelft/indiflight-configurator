import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { get as getConfig, set as setConfig } from "@/js/ConfigStorage";
import { parseConfig, mergeConfigs } from "@/js/indiflight/configParser";
import { parseSimFlags, splitSimArgs } from "@/js/indiflight/simArgs";
import { useLocalBuildStore } from "@/stores/localBuild";
import { useLogbookStore } from "@/stores/logbook";

const STORAGE_KEY = "simulation";
const MAX_LOG_LINES = 5000;
const FINISHED_STATES = ["success", "failed", "cancelled", "stopped"];
// Artifact kinds the blackbox tooling can parse (the SIL writes .BFL; .BBL/.TXT for completeness)
const BLACKBOX_KINDS = ["bfl", "bbl", "txt"];
const SAFE_ARTIFACT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** @typedef {"sims" | "profiles"} SimFileKind */

/**
 * SIL simulations (support/simulation in the Indiflight repo) run by the local build daemon.
 * Shares the daemon connection with the local build store.
 */
export const useSimulationStore = defineStore("simulation", () => {
    const daemon = useLocalBuildStore();
    const logbook = useLogbookStore();
    const saved = getConfig(STORAGE_KEY)[STORAGE_KEY] ?? {};

    const sim = ref(saved.sim ?? "");
    const profile = ref(saved.profile ?? "");
    const repoText = reactive({ sims: "", profiles: "" });
    /** User edits; null means "use the repo file unchanged" */
    const editedText = reactive({ sims: null, profiles: null });

    const options = reactive({
        // GDB matches support/simulation/README.md: -O0 keeps the SIL debuggable
        debug: saved.debug === undefined ? "GDB" : saved.debug,
        /** @type {string[]} */
        flags: saved.flags ?? ["--throw", "--learn"],
        extraArgs: saved.extraArgs ?? "",
        gdbserver: false,
        hostNetwork: saved.hostNetwork ?? false,
    });

    const job = ref(null);
    const log = ref([]);
    const progress = reactive({ done: 0, total: null, status: "" });
    const starting = ref(false);
    // Upload to the log database per artifact name: {state: "queued"|"uploading"|"uploaded"|"skipped"|"partial"|"failed", error?}
    const uploads = ref({});
    // Script and profile text of the simulation started here, which the job summary does not carry
    let launched = null;
    let closeStream = null;

    const running = computed(() => starting.value || (!!job.value && !FINISHED_STATES.includes(job.value.state)));

    function effectiveText(kind) {
        return editedText[kind] ?? repoText[kind];
    }

    const simModified = computed(() => editedText.sims !== null && editedText.sims !== repoText.sims);
    const profileModified = computed(() => editedText.profiles !== null && editedText.profiles !== repoText.profiles);

    const parsedProfile = computed(() => parseConfig(effectiveText("profiles"), "profile"));
    // The SIL build is TARGET=MOCKUP without a board file; the profile's defines still apply
    const merged = computed(() => ({ ...mergeConfigs(null, parsedProfile.value), target: "MOCKUP" }));

    /** Editable files, in the shape BuildConfigPreview expects */
    const files = computed(() => [
        { kind: "sims", labelKey: "simulationScript", name: sim.value, modified: simModified.value, ext: ".py" },
        { kind: "profiles", labelKey: "localBuildProfile", name: profile.value, modified: profileModified.value },
    ]);

    const availableFlags = computed(() => parseSimFlags(effectiveText("sims")));
    const extraArgs = computed(() => splitSimArgs(options.extraArgs));
    const args = computed(() => {
        const known = new Set(availableFlags.value.map((f) => f.flag));
        return [...options.flags.filter((f) => known.has(f)), ...extraArgs.value.args];
    });

    function persist() {
        setConfig({
            [STORAGE_KEY]: {
                sim: sim.value,
                profile: profile.value,
                debug: options.debug,
                flags: options.flags,
                extraArgs: options.extraArgs,
                hostNetwork: options.hostNetwork,
            },
        });
    }

    /** Pick valid selections from the daemon's lists and load their files. */
    async function refresh() {
        if (!daemon.sims.includes(sim.value)) {
            sim.value = daemon.sims[0] ?? "";
        }
        if (!daemon.profiles.includes(profile.value)) {
            profile.value = daemon.profiles[0] ?? "";
        }
        await Promise.all([loadFile("sims"), loadFile("profiles")]);
        if (!job.value && daemon.info?.activeJobKind === "sim") {
            await attachJob(daemon.info.activeJob);
        }
    }

    async function rescan() {
        await daemon.refreshConfigs();
        await refresh();
    }

    /** Reload a file from the repo; discards edits to it. */
    async function loadFile(kind) {
        const name = kind === "sims" ? sim.value : profile.value;
        editedText[kind] = null;
        repoText[kind] = name ? await daemon.client.configFile(kind, name) : "";
    }

    async function selectSim(name) {
        sim.value = name;
        persist();
        await loadFile("sims");
    }

    async function selectProfile(name) {
        profile.value = name;
        persist();
        await loadFile("profiles");
    }

    /**
     * @param {SimFileKind} kind
     * @param {string | null} text  null reverts to the repo file
     */
    function setText(kind, text) {
        editedText[kind] = text === null || text === repoText[kind] ? null : text;
    }

    function toggleFlag(flag, enabled) {
        options.flags = enabled ? [...new Set([...options.flags, flag])] : options.flags.filter((f) => f !== flag);
        persist();
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
        log.value = [];
        Object.assign(progress, { done: 0, total: null, status: "" });
        return new Promise((resolve) => {
            closeStream = daemon.client.subscribe(id, {
                log: appendLog,
                // the daemon reuses the build's progress "file" field for the tqdm status line
                progress: (p) => Object.assign(progress, { done: p.done, total: p.total, status: p.file ?? "" }),
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
                        job.value = await daemon.client.job(id);
                    } catch {
                        // daemon gone: keep the last known state
                    }
                    resolve(job.value);
                },
            });
        });
    }

    /** Start the selected simulation; resolves with the final job summary once it ends. */
    async function start() {
        if (extraArgs.value.invalid.length) {
            throw new Error(`Unsupported argument: ${extraArgs.value.invalid.join(" ")}`);
        }
        persist();
        const request = {
            sim: sim.value || null,
            profile: profile.value || null,
            debug: options.debug,
            args: args.value,
            gdbserver: options.gdbserver,
            hostNetwork: options.hostNetwork,
        };
        if (simModified.value) {
            request.simText = editedText.sims;
        }
        if (profileModified.value) {
            request.profileText = editedText.profiles;
        }
        uploads.value = {};
        const setup = { sims: effectiveText("sims"), profiles: effectiveText("profiles") };
        starting.value = true;
        let id;
        try {
            ({ id } = await daemon.client.startSim(request));
            launched = { id, ...setup };
            job.value = await daemon.client.job(id);
        } finally {
            starting.value = false;
        }
        const final = await attachJob(id);
        await daemon.refreshInfo().catch(() => {});
        return final;
    }

    async function stop() {
        if (job.value) {
            job.value = await daemon.client.cancel(job.value.id);
        }
    }

    /** @returns {Promise<Blob>} a log file the last job wrote */
    async function fetchArtifact(name) {
        // The name ends up in a save dialog and file name
        if (!SAFE_ARTIFACT_RE.test(name) || !job.value?.artifacts?.some((a) => a.name === name)) {
            throw new Error("Daemon returned an unexpected artifact name");
        }
        return daemon.client.artifactBlob(job.value.id, name);
    }

    /** Blackbox logs of the last job */
    const blackboxLogs = computed(() => (job.value?.artifacts ?? []).filter((a) => BLACKBOX_KINDS.includes(a.kind)));

    function setUpload(name, state, error) {
        uploads.value = { ...uploads.value, [name]: { state, error } };
    }

    /** Text of the script or profile a job ran with, or null when it is no longer known. */
    async function setupText(current, kind, name, edited) {
        if (launched?.id === current.id) {
            return launched[kind];
        }
        // After a page reload only the daemon's repo file is left: the run's file, unless the run used an edited one
        return edited ? null : daemon.client.configFile(kind, name);
    }

    /**
     * The script and profile the current job ran with, to attach to its logs.
     * @returns {Promise<import("@/js/indiflight/logbookClient").LogAttachment[]>}
     */
    async function setupAttachments() {
        const current = job.value;
        const files = [];
        for (const [kind, name, edited, ext, description] of [
            ["sims", current.sim, current.custom?.sim, ".py", "Simulation script this log was made with"],
            ["profiles", current.profile, current.custom?.profile, ".txt", "Profile this log was made with"],
        ]) {
            if (!name) {
                continue;
            }
            const text = await setupText(current, kind, name, edited);
            if (text) {
                files.push({
                    name: `${name.split("/").pop()}${ext}`,
                    data: new Blob([text], { type: "text/plain" }),
                    description,
                });
            }
        }
        return files;
    }

    /** Upload artifacts of the current job to the log database, one at a time. */
    async function uploadLogs(names) {
        const id = job.value?.id;
        for (const name of names) {
            setUpload(name, "queued");
        }
        let attachments = [];
        try {
            attachments = logbook.attachSimulationSetup ? await setupAttachments() : [];
        } catch (error) {
            console.error("Could not read the simulation setup for upload", error);
            for (const name of names) {
                setUpload(name, "failed", error.message);
            }
            return;
        }
        for (const name of names) {
            // A newer job replaced the one these names belong to
            if (job.value?.id !== id) {
                return;
            }
            setUpload(name, "uploading");
            try {
                const { state, error } = await logbook.upload(name, await fetchArtifact(name), attachments);
                setUpload(name, state, error);
            } catch (error) {
                console.error("Could not fetch the log for upload", error);
                setUpload(name, "failed", error.message);
            }
        }
    }

    /** Loopback URL of the job's Three.js visualization, once it answers */
    const visUrl = computed(() => {
        const port = job.value?.visPort;
        // The port comes from the daemon; anything but a plain port number could point the iframe elsewhere
        if (!job.value?.visReady || !Number.isInteger(port) || port < 1 || port > 65535) {
            return null;
        }
        let host = "127.0.0.1";
        try {
            host = new URL(daemon.url).hostname || host;
        } catch {
            // malformed daemon URL: the connection would have failed anyway
        }
        // URL.hostname keeps the brackets of an IPv6 literal
        return `http://${host}:${port}/`;
    });

    return {
        sim,
        profile,
        repoText,
        editedText,
        simModified,
        profileModified,
        effectiveText,
        parsedProfile,
        merged,
        files,
        options,
        availableFlags,
        extraArgs,
        args,
        job,
        log,
        progress,
        starting,
        running,
        visUrl,
        blackboxLogs,
        uploads,
        uploadLogs,
        refresh,
        rescan,
        loadFile,
        selectSim,
        selectProfile,
        setText,
        toggleFlag,
        start,
        stop,
        fetchArtifact,
        persist,
    };
});
