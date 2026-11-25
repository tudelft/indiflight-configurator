import { afterEach, describe, expect, it, vi } from "vitest";
import { LogbookClient, LogbookError, normalizeServerUrl, sha256Hex } from "../../src/js/indiflight/logbookClient";

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("LogbookClient", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("normalises the server URL", () => {
        expect(normalizeServerUrl(" logs.example.org/ ")).toBe("https://logs.example.org");
        expect(normalizeServerUrl("http://127.0.0.1:5000//")).toBe("http://127.0.0.1:5000");
        expect(normalizeServerUrl("")).toBe("");
    });

    it("hashes like sha256sum", async () => {
        expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
        expect(await sha256Hex(new Blob(["abc"]))).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
    });

    it("uploads a log the server does not have, as multipart with the bearer key", async () => {
        const calls = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url, init) => {
                calls.push({ url, init });
                return url.endsWith("/api/logs/check")
                    ? json({ known: {} })
                    : json({ results: [{ status: "accepted", ingest_id: 7 }] });
            }),
        );
        const client = new LogbookClient("logs.example.org", " logdb_x ");
        const result = await client.upload("Hex 1/LOG00001.BFL", new Uint8Array([1, 2, 3]));

        expect(result).toEqual({ status: "accepted", ingestId: 7 });
        expect(calls[1].url).toBe("https://logs.example.org/api/upload");
        expect(calls[1].init.headers.get("Authorization")).toBe("Bearer logdb_x");
        const form = calls[1].init.body;
        expect(form.get("names")).toBe("Hex 1/LOG00001.BFL");
        expect(form.get("files").name).toBe("LOG00001.BFL");
        expect(form.get("files").size).toBe(3);
    });

    it("skips a log the user already uploaded, but re-sends one stored without its file", async () => {
        const known = { has_log: true, mine: true };
        const fetchMock = vi.fn(async (url) =>
            url.endsWith("/api/logs/check")
                ? json({ known: { [await sha256Hex(new Uint8Array([9]))]: known } })
                : json({ results: [{ status: "accepted", ingest_id: 1 }] }),
        );
        vi.stubGlobal("fetch", fetchMock);
        const client = new LogbookClient("https://s", "k");
        expect(await client.upload("a.BFL", new Uint8Array([9]))).toEqual({ status: "skipped" });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        known.has_log = false;
        expect((await client.upload("a.BFL", new Uint8Array([9]))).status).toBe("accepted");
    });

    it("reports server messages and network failures", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => json({ error: "invalid API key" }, 401)),
        );
        await expect(new LogbookClient("https://s", "k").status()).rejects.toMatchObject({
            name: "LogbookError",
            status: 401,
            message: "invalid API key",
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
        );
        await expect(new LogbookClient("https://s", "k").status()).rejects.toBeInstanceOf(LogbookError);
    });

    it("rejects a refused upload", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url) =>
                url.endsWith("/api/logs/check")
                    ? json({ known: {} })
                    : json({ results: [{ status: "rejected", reason: "bad" }] }),
            ),
        );
        await expect(new LogbookClient("https://s", "k").upload("a.BFL", new Uint8Array([1]))).rejects.toThrow("bad");
    });
});
