import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FileSystem, { buildAcceptTypes, normalizeExtensions } from "../../src/js/FileSystem";

describe("normalizeExtensions", () => {
    it("expands a single extension to both lower and upper case", () => {
        expect(normalizeExtensions(".txt")).toEqual([".txt", ".TXT"]);
    });

    it("adds a leading dot when missing", () => {
        expect(normalizeExtensions("json")).toEqual([".json", ".JSON"]);
    });

    it("expands every entry of an array", () => {
        expect(normalizeExtensions([".hex", ".uf2", ".bin"])).toEqual([".hex", ".HEX", ".uf2", ".UF2", ".bin", ".BIN"]);
    });

    it("deduplicates extensions already supplied in both cases", () => {
        expect(normalizeExtensions([".bbl", ".BBL"])).toEqual([".bbl", ".BBL"]);
    });

    it("returns an empty array for empty input", () => {
        expect(normalizeExtensions(undefined)).toEqual([]);
        expect(normalizeExtensions([])).toEqual([]);
        expect(normalizeExtensions("")).toEqual([]);
    });
});

describe("buildAcceptTypes", () => {
    it("groups case-expanded extensions under their MIME type", () => {
        expect(buildAcceptTypes("Files", ".txt")).toEqual([
            {
                description: "Files",
                accept: { "text/plain": [".txt", ".TXT"] },
            },
        ]);
    });

    it("groups multiple extensions by their respective MIME types", () => {
        const [type] = buildAcceptTypes("images", ["png", "bmp"]);
        expect(type.accept).toEqual({
            "image/png": [".png", ".PNG"],
            "image/bmp": [".bmp", ".BMP"],
        });
    });

    it("falls back to application/octet-stream for unknown extensions (never */*)", () => {
        const [type] = buildAcceptTypes("custom", ".xyz");
        expect(type.accept).toEqual({ "application/octet-stream": [".xyz", ".XYZ"] });
    });

    it("returns an empty types array when no extension is given", () => {
        expect(buildAcceptTypes("anything", undefined)).toEqual([]);
    });
});

// In jsdom, window.showOpenFilePicker / showSaveFilePicker are undefined and
// isAndroid() is false, so the FileSystem wrapper takes its <input>/<a download>
// fallback paths (the same ones used by Firefox and WebKit-based Tauri webviews).
describe("FileSystem fallback (no File System Access API)", () => {
    let clickSpy;
    let downloaded;
    let originalCreateObjectURL;
    let originalRevokeObjectURL;

    beforeEach(() => {
        // jsdom does not implement object URLs; save the originals so they can be
        // restored (vi.restoreAllMocks() does not touch direct global assignment).
        originalCreateObjectURL = URL.createObjectURL;
        originalRevokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = vi.fn(() => "blob:mock");
        URL.revokeObjectURL = vi.fn();
        downloaded = [];
        clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
            downloaded.push({ download: this.download });
        });
    });

    afterEach(() => {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        vi.restoreAllMocks();
    });

    it("uses the fallback path because the pickers are unavailable in jsdom", () => {
        expect(window.showOpenFilePicker).toBeUndefined();
        expect(window.showSaveFilePicker).toBeUndefined();
    });

    it("pickSaveFile returns a download descriptor instead of an OS save dialog", async () => {
        const file = await FileSystem.pickSaveFile("config.txt", "Text", ".txt");
        expect(file.name).toBe("config.txt");
        expect(file._download).toMatchObject({ name: "config.txt", chunks: [] });
    });

    it("pickSaveFile appends the extension when the suggested name has none", async () => {
        const file = await FileSystem.pickSaveFile("config", "Text", ".txt");
        expect(file.name).toBe("config.txt");
    });

    it("writeFile triggers a browser download for a fallback descriptor", async () => {
        const file = await FileSystem.pickSaveFile("dump.txt", "Text", ".txt");
        await FileSystem.writeFile(file, "hello");
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(downloaded[0].download).toBe("dump.txt");
    });

    it("buffers streamed chunks and downloads them on close", async () => {
        const file = await FileSystem.pickSaveFile("log.csv", "CSV", ".csv");
        const writable = await FileSystem.openFile(file);
        await FileSystem.writeChunck(writable, new Blob(["a"]));
        await FileSystem.writeChunck(writable, new Blob(["b"]));
        expect(clickSpy).not.toHaveBeenCalled();
        await FileSystem.closeFile(writable);
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(downloaded[0].download).toBe("log.csv");
    });

    it("reads a fallback (input-selected) file straight from its blob", async () => {
        // jsdom's Blob lacks .text(); real browser/WebKit File objects have it,
        // so stub the blob to verify the descriptor routing and delegation.
        const blob = { text: vi.fn().mockResolvedValue("chirp") };
        const descriptor = { name: "x.txt", _blob: blob };
        expect(await FileSystem.readFile(descriptor)).toBe("chirp");
        expect(blob.text).toHaveBeenCalledTimes(1);
        expect(await FileSystem.readFileAsBlob(descriptor)).toBe(blob);
    });

    it("aborts the open fallback when focus returns with no selection (cancel-less webviews)", async () => {
        vi.useFakeTimers();
        try {
            // Don't trigger a real file dialog when the input is clicked.
            vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});

            const pending = FileSystem.pickOpenFile("Text", ".txt");

            // Simulate the dialog closing with no file: focus returns to the
            // window and the dismissal timer elapses.
            globalThis.dispatchEvent(new Event("focus"));
            vi.advanceTimersByTime(500);

            await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("FileSystem directory saving", () => {
    function fakeDirectory(existing) {
        const names = new Set(existing);
        const notFound = () => Object.assign(new Error("missing"), { name: "NotFoundError" });
        return {
            names,
            getFileHandle: vi.fn(async (name, options) => {
                if (!names.has(name) && !options?.create) {
                    throw notFound();
                }
                names.add(name);
                return { name };
            }),
            removeEntry: vi.fn(async (name) => names.delete(name)),
        };
    }

    afterEach(() => {
        delete globalThis.showDirectoryPicker;
    });

    it("reports directory picking only where showDirectoryPicker exists", async () => {
        expect(FileSystem.canPickSaveDirectory()).toBe(false);
        const dirHandle = fakeDirectory([]);
        globalThis.showDirectoryPicker = vi.fn().mockResolvedValue(dirHandle);
        expect(FileSystem.canPickSaveDirectory()).toBe(true);
        await expect(FileSystem.pickSaveDirectory()).resolves.toMatchObject({ _dirHandle: dirHandle });
        expect(globalThis.showDirectoryPicker).toHaveBeenCalledWith({ mode: "readwrite" });
    });

    it("creates files with their own name and never overwrites existing ones", async () => {
        const dirHandle = fakeDirectory(["LOG00001.BFL", "LOG00001 (1).BFL"]);
        const directory = { name: "logs", _dirHandle: dirHandle };

        const fresh = await FileSystem.createFileInDirectory(directory, "LOG00002.BFL");
        expect(fresh.name).toBe("LOG00002.BFL");

        const renamed = await FileSystem.createFileInDirectory(directory, "LOG00001.BFL");
        expect(renamed.name).toBe("LOG00001 (2).BFL");
        expect(dirHandle.getFileHandle).toHaveBeenLastCalledWith("LOG00001 (2).BFL", { create: true });
    });

    it("abortFile discards the writable and removes a file created in a directory", async () => {
        const dirHandle = fakeDirectory([]);
        const file = await FileSystem.createFileInDirectory({ _dirHandle: dirHandle }, "LOG00003.BFL");
        const writable = { abort: vi.fn().mockResolvedValue(), close: vi.fn() };

        await FileSystem.abortFile(writable, file);

        expect(writable.abort).toHaveBeenCalled();
        expect(writable.close).not.toHaveBeenCalled();
        expect(dirHandle.removeEntry).toHaveBeenCalledWith("LOG00003.BFL");
        expect(dirHandle.names.has("LOG00003.BFL")).toBe(false);
    });

    it("abortFile drops buffered chunks of the download fallback without downloading", async () => {
        const target = FileSystem._fallbackPickSaveFile("LOG00004.BFL", ".BFL");
        const writable = await FileSystem.openFile(target);
        await FileSystem.writeChunck(writable, new Blob([new Uint8Array([1, 2, 3])]));
        const createObjectURL = vi.fn();
        const original = URL.createObjectURL;
        URL.createObjectURL = createObjectURL;
        try {
            await FileSystem.abortFile(writable, target);
        } finally {
            URL.createObjectURL = original;
        }
        expect(writable.chunks).toEqual([]);
        expect(createObjectURL).not.toHaveBeenCalled();
    });
});
