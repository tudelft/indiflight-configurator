import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useLocalBuildStore } from "../../src/stores/localBuild";
import { useLogbookStore } from "../../src/stores/logbook";
import { useSimulationStore } from "../../src/stores/simulation";
import { LogbookClient } from "../../src/js/indiflight/logbookClient";

const LOGS = [
    { name: "LOG00001.BFL", kind: "bfl", size: 10 },
    { name: "LOG00002.BFL", kind: "bfl", size: 20 },
    { name: "build.log", kind: "log", size: 5 },
];

function setup({ autoUpload = false, attach = true, custom = { sim: false, profile: false } } = {}) {
    setActivePinia(createPinia());
    const daemon = useLocalBuildStore();
    const summary = {
        id: "job1",
        kind: "sim",
        state: "stopped",
        artifacts: LOGS,
        sim: "exampleQuadSim",
        profile: "racer",
        custom,
    };
    daemon.client = {
        startSim: vi.fn(async () => ({ id: "job1" })),
        job: vi.fn(async () => ({ ...summary, state: "running", artifacts: [] })),
        subscribe: vi.fn((_id, handlers) => {
            queueMicrotask(() => handlers.end(summary));
            return () => {};
        }),
        artifactBlob: vi.fn(async (_id, name) => new Blob([name])),
        configFile: vi.fn(async (kind, name) => `repo ${kind} ${name}`),
    };
    daemon.refreshInfo = vi.fn(async () => {});
    const logbook = useLogbookStore();
    Object.assign(logbook, {
        url: "https://logs.example.org",
        token: "logdb_x",
        folder: "Hex 1",
        autoUpload,
        attachSimulationSetup: attach,
    });
    return { sim: useSimulationStore(), daemon, logbook };
}

describe("simulation log upload", () => {
    let upload;
    beforeEach(() => {
        upload = vi.spyOn(LogbookClient.prototype, "upload").mockResolvedValue({ status: "accepted", ingestId: 1 });
    });
    afterEach(() => vi.restoreAllMocks());

    it("does not upload when the simulation ends, even with auto-upload on for the Log Download tab", async () => {
        const { sim } = setup({ autoUpload: true });
        await sim.start();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(upload).not.toHaveBeenCalled();
        expect(sim.uploads).toEqual({});
    });

    it("uploads the requested blackbox logs with the folder applied", async () => {
        const { sim } = setup({ autoUpload: false });
        await sim.start();
        await sim.uploadLogs(sim.blackboxLogs.map((a) => a.name));

        expect(upload.mock.calls.map((c) => c[0])).toEqual(["Hex 1/LOG00001.BFL", "Hex 1/LOG00002.BFL"]);
        expect(sim.blackboxLogs.map((a) => a.name)).not.toContain("build.log");
    });

    it("marks a failed upload and goes on with the next log", async () => {
        upload.mockRejectedValueOnce(new Error("401 invalid API key")).mockResolvedValue({ status: "skipped" });
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { sim } = setup({ autoUpload: false });
        await sim.start();
        await sim.uploadLogs(["LOG00001.BFL", "LOG00002.BFL"]);

        expect(sim.uploads["LOG00001.BFL"]).toEqual({ state: "failed", error: "401 invalid API key" });
    });

    it("clears the upload status when the next simulation starts", async () => {
        const { sim } = setup({ autoUpload: false });
        await sim.start();
        await sim.uploadLogs(["LOG00001.BFL"]);
        expect(sim.uploads["LOG00001.BFL"]).toBeDefined();
        await sim.start();
        expect(sim.uploads).toEqual({});
    });

    describe("attached setup", () => {
        const files = () => upload.mock.calls.map((c) => c[2].map((f) => f.name));

        it("attaches the script and profile the run was started with, edits included", async () => {
            const { sim } = setup();
            sim.sim = "exampleQuadSim";
            sim.profile = "racer";
            sim.repoText.sims = "repo script";
            sim.repoText.profiles = "repo profile";
            sim.setText("profiles", "edited profile");
            await sim.start();
            // edited after the start: must not change what is attached
            sim.setText("profiles", "edited again");
            await sim.uploadLogs(["LOG00001.BFL"]);

            expect(files()).toEqual([["exampleQuadSim.py", "racer.txt"]]);
            const [script, profile] = upload.mock.calls[0][2];
            expect(await script.data.text()).toBe("repo script");
            expect(await profile.data.text()).toBe("edited profile");
        });

        it("attaches nothing when the option is off", async () => {
            const { sim } = setup({ attach: false });
            await sim.start();
            await sim.uploadLogs(["LOG00001.BFL"]);
            expect(files()).toEqual([[]]);
        });

        it("after a reload reads the repo files, except the ones the run had edited", async () => {
            const { sim, daemon } = setup({ custom: { sim: false, profile: true } });
            sim.job = {
                id: "job1",
                sim: "exampleQuadSim",
                profile: "racer",
                custom: { sim: false, profile: true },
                artifacts: LOGS,
            };
            await sim.uploadLogs(["LOG00001.BFL"]);

            expect(files()).toEqual([["exampleQuadSim.py"]]);
            expect(daemon.client.configFile).toHaveBeenCalledTimes(1);
            expect(await upload.mock.calls[0][2][0].data.text()).toBe("repo sims exampleQuadSim");
        });

        it("shows a partial upload when the server stored the log but not the files", async () => {
            const { sim } = setup();
            await sim.start();
            upload.mockResolvedValue({ status: "accepted", logId: 1, attachError: "403 no upload access" });
            await sim.uploadLogs(["LOG00001.BFL"]);
            expect(sim.uploads["LOG00001.BFL"]).toEqual({ state: "partial", error: "403 no upload access" });
        });
    });
});
