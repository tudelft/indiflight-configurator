import { createApp, h, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import i18next from "i18next";
import I18NextVue from "i18next-vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "reka-ui";
import BlackboxLogsPanel from "../../src/components/onboard-logging/BlackboxLogsPanel.vue";
import CONFIGURATOR from "../../src/js/data_storage";
import FileSystem from "../../src/js/FileSystem";
import { switchTab } from "../../src/js/tab_switch";
import { openLogInBlackboxViewer } from "../../src/blackbox-viewer/vue_init";
import { useFlightPlotterStore } from "../../src/stores/flightPlotter";
import { useLogbookStore } from "../../src/stores/logbook";
import { LogbookClient } from "../../src/js/indiflight/logbookClient";

vi.mock("../../src/js/tab_switch", () => ({ switchTab: vi.fn() }));
vi.mock("../../src/blackbox-viewer/vue_init", () => ({ openLogInBlackboxViewer: vi.fn() }));

async function flush() {
    for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await nextTick();
    }
}

describe("BlackboxLogsPanel (virtual mode)", () => {
    let container;
    let app;

    beforeEach(async () => {
        await i18next.init({ lng: "en", resources: { en: { translation: {} } } });
        CONFIGURATOR.virtualMode = true;
        container = document.createElement("div");
        document.body.appendChild(container);
        const pinia = createPinia();
        setActivePinia(pinia);
        // UTooltip needs the provider UApp gives it in the app
        app = createApp({ render: () => h(TooltipProvider, null, () => h(BlackboxLogsPanel)) });
        app.use(pinia).use(I18NextVue, { i18next });
        app.mount(container);
        // the virtual FC simulates a flash scan before the first listing succeeds
        await vi.waitFor(() => expect(container.textContent).toContain("LOG00001.BFL"), { timeout: 3000 });
        await flush();
    });

    afterEach(() => {
        app.unmount();
        container.remove();
        CONFIGURATOR.virtualMode = false;
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("lists the newest log first", () => {
        const names = [...container.querySelectorAll("tbody tr td:nth-child(2)")].map((td) => td.textContent.trim());
        expect(names).toEqual([...names].sort().reverse());
        expect(names[0]).toBe("LOG00003.BFL");
    });

    it("lists the virtual flash logs on mount and names the storage", () => {
        const text = container.textContent;
        expect(text).toContain("LOG00001.BFL");
        expect(text).toContain("LOG00003.BFL");
        expect(text).toContain("blackboxLogsDateUnknown");
        expect(text).toContain("blackboxLogsStorage");
        expect(text).toContain("blackboxLogsFlashNote");
    });

    it("downloads a selected file through FileSystem and verifies its size", async () => {
        const chunks = [];
        const file = { name: "LOG00003.BFL" };
        vi.spyOn(FileSystem, "pickSaveFile").mockResolvedValue(file);
        vi.spyOn(FileSystem, "openFile").mockResolvedValue("writable");
        vi.spyOn(FileSystem, "writeChunck").mockImplementation(async (_w, blob) => chunks.push(blob.size));
        const closeFile = vi.spyOn(FileSystem, "closeFile").mockResolvedValue();

        const rows = [...container.querySelectorAll("tbody tr")];
        const row = rows.find((r) => r.textContent.includes("LOG00003.BFL"));
        row.querySelector("button[role='checkbox']").click();
        await flush();

        const download = [...container.querySelectorAll("button")].find((b) =>
            b.textContent.includes("blackboxLogsDownload"),
        );
        expect(download.disabled).toBe(false);
        download.click();
        await vi.waitFor(() => expect(closeFile).toHaveBeenCalledWith("writable"), { timeout: 3000 });
        await flush();

        expect(FileSystem.pickSaveFile).toHaveBeenCalledWith("LOG00003.BFL", expect.any(String), ".BFL");
        expect(chunks.reduce((a, b) => a + b, 0)).toBe(42_123);
        expect(container.textContent).toContain("blackboxLogsDownloadDone");
    });

    it("uploads a completely downloaded log to the log database when auto-upload is on", async () => {
        const logbook = useLogbookStore();
        Object.assign(logbook, {
            url: "https://logs.example.org",
            token: "logdb_x",
            autoUpload: true,
            folder: "Hex 1/",
        });
        const upload = vi
            .spyOn(LogbookClient.prototype, "upload")
            .mockResolvedValue({ status: "accepted", ingestId: 3 });
        vi.spyOn(FileSystem, "pickSaveFile").mockResolvedValue({ name: "LOG00003.BFL" });
        vi.spyOn(FileSystem, "openFile").mockResolvedValue("writable");
        vi.spyOn(FileSystem, "writeChunck").mockResolvedValue();
        vi.spyOn(FileSystem, "closeFile").mockResolvedValue();

        const row = [...container.querySelectorAll("tbody tr")].find((r) => r.textContent.includes("LOG00003.BFL"));
        row.querySelector("button[role='checkbox']").click();
        await flush();
        [...container.querySelectorAll("button")].find((b) => b.textContent.includes("blackboxLogsDownload")).click();

        await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1), { timeout: 3000 });
        expect(upload.mock.calls[0][0]).toBe("Hex 1/LOG00003.BFL");
        expect(upload.mock.calls[0][1].size).toBe(42_123);
        await vi.waitFor(() => expect(container.textContent).toContain("blackboxLogsUploadStateUploaded"));
    });

    it("does not upload when auto-upload is off", async () => {
        const upload = vi.spyOn(LogbookClient.prototype, "upload");
        vi.spyOn(FileSystem, "pickSaveFile").mockResolvedValue({ name: "LOG00003.BFL" });
        vi.spyOn(FileSystem, "openFile").mockResolvedValue("writable");
        vi.spyOn(FileSystem, "writeChunck").mockResolvedValue();
        const closeFile = vi.spyOn(FileSystem, "closeFile").mockResolvedValue();
        const row = [...container.querySelectorAll("tbody tr")].find((r) => r.textContent.includes("LOG00003.BFL"));
        row.querySelector("button[role='checkbox']").click();
        await flush();
        [...container.querySelectorAll("button")].find((b) => b.textContent.includes("blackboxLogsDownload")).click();
        await vi.waitFor(() => expect(closeFile).toHaveBeenCalled(), { timeout: 3000 });
        await flush();
        expect(upload).not.toHaveBeenCalled();
    });

    it("saves several files into one picked directory and discards the partial file on cancel", async () => {
        const directory = { name: "logs" };
        vi.spyOn(FileSystem, "canPickSaveDirectory").mockReturnValue(true);
        vi.spyOn(FileSystem, "pickSaveDirectory").mockResolvedValue(directory);
        const pickSaveFile = vi.spyOn(FileSystem, "pickSaveFile");
        const create = vi
            .spyOn(FileSystem, "createFileInDirectory")
            .mockImplementation(async (_dir, name) => ({ name }));
        vi.spyOn(FileSystem, "openFile").mockResolvedValue("writable");
        const abortFile = vi.spyOn(FileSystem, "abortFile").mockResolvedValue();
        const closeFile = vi.spyOn(FileSystem, "closeFile").mockResolvedValue();
        let cancelButton;
        vi.spyOn(FileSystem, "writeChunck").mockImplementation(async () => {
            cancelButton ??= [...container.querySelectorAll("button")].find((b) =>
                b.textContent.includes("blackboxLogsCancel"),
            );
            cancelButton?.click();
        });

        // first checkbox in the tab is "select all"
        container.querySelector("button[role='checkbox']").click();
        await flush();
        [...container.querySelectorAll("button")].find((b) => b.textContent.includes("blackboxLogsDownload")).click();

        await vi.waitFor(() => expect(abortFile).toHaveBeenCalled(), { timeout: 3000 });
        await flush();

        expect(pickSaveFile).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledWith(directory, "LOG00003.BFL");
        expect(abortFile).toHaveBeenCalledWith("writable", { name: "LOG00003.BFL" });
        expect(closeFile).not.toHaveBeenCalled();
        expect(container.textContent).toContain("blackboxLogsCancelled");
        expect(container.textContent).toContain("blackboxLogsStateCancelled");
    });

    function openButton(name, label) {
        const row = [...container.querySelectorAll("tbody tr")].find((r) => r.textContent.includes(name));
        return row.querySelector(`button[aria-label^="${label}"]`);
    }

    it("reads a log into memory and opens it in the blackbox viewer without saving it", async () => {
        const pickSaveFile = vi.spyOn(FileSystem, "pickSaveFile");
        openButton("LOG00003.BFL", "blackboxLogsOpenInViewer").click();
        await vi.waitFor(() => expect(switchTab).toHaveBeenCalled(), { timeout: 3000 });

        expect(switchTab).toHaveBeenCalledWith("blackbox_viewer", { mode: "shared" });
        const [bytes, name] = openLogInBlackboxViewer.mock.calls[0];
        expect(name).toBe("LOG00003.BFL");
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.byteLength).toBe(42_123);
        expect(pickSaveFile).not.toHaveBeenCalled();
    });

    it("opens a log in the flight plotter", async () => {
        openButton("LOG00001.BFL", "blackboxLogsOpenInFlightPlotter").click();
        await vi.waitFor(() => expect(switchTab).toHaveBeenCalled(), { timeout: 3000 });

        expect(switchTab).toHaveBeenCalledWith("flight_plotter", { mode: "shared" });
        const pending = useFlightPlotterStore().pendingLog;
        expect(pending.name).toBe("LOG00001.BFL");
        expect(pending.data.byteLength).toBe(183_476);
        expect(openLogInBlackboxViewer).not.toHaveBeenCalled();
    });

    it("does not hand over a log whose read was cancelled", async () => {
        openButton("LOG00001.BFL", "blackboxLogsOpenInViewer").click();
        await vi.waitFor(() =>
            [...container.querySelectorAll("button")].find((b) => b.textContent.includes("blackboxLogsCancel")).click(),
        );
        await vi.waitFor(() => expect(container.textContent).toContain("blackboxLogsCancelled"), { timeout: 3000 });
        await flush();

        expect(openLogInBlackboxViewer).not.toHaveBeenCalled();
        expect(switchTab).not.toHaveBeenCalled();
        expect(container.textContent).toContain("blackboxLogsStateCancelled");
    });

    // Runs last: the virtual FC keeps its (now empty) log list for the rest of the file.
    it("deletes all logs after confirmation, then re-lists", async () => {
        const buttons = () => [...document.body.querySelectorAll("button")];
        const eraseButton = buttons().find((b) => b.textContent.includes("blackboxLogsEraseAll"));
        expect(eraseButton.disabled).toBe(false);
        eraseButton.click();
        await flush();

        const confirm = buttons().find((b) => b.textContent.includes("blackboxLogsEraseConfirmOk"));
        expect(document.body.textContent).toContain("blackboxLogsEraseConfirmText");
        confirm.click();
        await vi.waitFor(() => expect(container.textContent).toContain("blackboxLogsEraseProgressTitle"));
        const download = buttons().find((b) => b.textContent.includes("blackboxLogsDownload"));
        expect(download.disabled).toBe(true);

        await vi.waitFor(() => expect(container.textContent).toContain("blackboxLogsEraseDone"), { timeout: 5000 });
        expect(container.textContent).not.toContain("LOG00001.BFL");
        expect(container.textContent).not.toContain("blackboxLogsEraseProgressTitle");
    });
});
