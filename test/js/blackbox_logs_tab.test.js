import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import i18next from "i18next";
import I18NextVue from "i18next-vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BlackboxLogsTab from "../../src/components/tabs/BlackboxLogsTab.vue";
import CONFIGURATOR from "../../src/js/data_storage";
import FileSystem from "../../src/js/FileSystem";

async function flush() {
    for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await nextTick();
    }
}

describe("BlackboxLogsTab (virtual mode)", () => {
    let container;
    let app;

    beforeEach(async () => {
        await i18next.init({ lng: "en", resources: { en: { translation: {} } } });
        CONFIGURATOR.virtualMode = true;
        container = document.createElement("div");
        document.body.appendChild(container);
        const pinia = createPinia();
        setActivePinia(pinia);
        app = createApp(BlackboxLogsTab);
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
        expect(create).toHaveBeenCalledWith(directory, "LOG00001.BFL");
        expect(abortFile).toHaveBeenCalledWith("writable", { name: "LOG00001.BFL" });
        expect(closeFile).not.toHaveBeenCalled();
        expect(container.textContent).toContain("blackboxLogsCancelled");
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
