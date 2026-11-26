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

    describe("attachments", () => {
        const setup = () => [
            { name: "exampleQuadSim.py", data: new Blob(["print(1)"]), description: "script" },
            { name: "my profile.txt", data: new Blob(["set a = 1"]) },
        ];

        /** A server that stores an upload after `pending` ingest polls. */
        function server({ known = {}, pending = 0, ingest = { status: "stored" }, attachStatus = 201 } = {}) {
            const calls = [];
            let polls = 0;
            vi.stubGlobal(
                "fetch",
                vi.fn(async (url, init) => {
                    calls.push({ url, init });
                    if (url.endsWith("/api/logs/check")) {
                        return json({ known });
                    }
                    if (url.endsWith("/api/upload")) {
                        return json({ results: [{ status: "accepted", ingest_id: 7 }] });
                    }
                    if (url.endsWith("/api/ingest/7")) {
                        return json(
                            ++polls > pending
                                ? { ...ingest, log_id: ingest.status === "stored" ? 42 : null }
                                : { status: "hashing", log_id: null },
                        );
                    }
                    return json({ id: 1, duplicate: false }, attachStatus);
                }),
            );
            return calls;
        }

        const attachCalls = (calls) => calls.filter((c) => c.url.endsWith("/api/attachments"));
        const client = () => Object.assign(new LogbookClient("https://s", "k"), { ingestPollMs: 0 });

        it("attaches the files to the new log once the server has stored it", async () => {
            const calls = server({ pending: 2 });
            const result = await client().upload("Hex 1/LOG00001.BFL", new Uint8Array([1]), setup());

            expect(result).toEqual({ status: "accepted", ingestId: 7, logId: 42 });
            expect(calls.filter((c) => c.url.endsWith("/api/ingest/7"))).toHaveLength(3);
            const sent = attachCalls(calls);
            expect(sent).toHaveLength(2);
            expect(sent[0].init.headers.get("Authorization")).toBe("Bearer k");
            const metadata = JSON.parse(decodeURIComponent(sent[0].init.headers.get("X-Attachment-Metadata")));
            expect(metadata).toEqual({
                filename: "exampleQuadSim.py",
                description: "script",
                targets: [{ kind: "log", id: 42 }],
            });
            // names with spaces survive the header
            expect(JSON.parse(decodeURIComponent(sent[1].init.headers.get("X-Attachment-Metadata"))).filename).toBe(
                "my profile.txt",
            );
            expect(await sent[0].init.body.text()).toBe("print(1)");
        });

        it("attaches to a log the server already had without uploading or polling", async () => {
            const known = { has_log: true, mine: true, id: 5 };
            const calls = server({ known: { [await sha256Hex(new Uint8Array([9]))]: known } });
            const result = await client().upload("a.BFL", new Uint8Array([9]), setup());

            expect(result).toEqual({ status: "skipped", logId: 5 });
            expect(calls.some((c) => c.url.endsWith("/api/upload") || c.url.includes("/api/ingest/"))).toBe(false);
            expect(
                JSON.parse(decodeURIComponent(attachCalls(calls)[0].init.headers.get("X-Attachment-Metadata"))).targets,
            ).toEqual([{ kind: "log", id: 5 }]);
        });

        it("keeps the upload and reports when the server rejects the log or the attachment", async () => {
            server({ ingest: { status: "rejected", error: "empty log file" } });
            expect(await client().upload("a.BFL", new Uint8Array([1]), setup())).toMatchObject({
                status: "accepted",
                attachError: "empty log file",
            });

            const calls = server({ attachStatus: 403 });
            const result = await client().upload("a.BFL", new Uint8Array([1]), setup());
            expect(result.status).toBe("accepted");
            expect(result.attachError).toBeTruthy();
            expect(attachCalls(calls)).toHaveLength(1); // stops at the first refusal
        });

        it("gives up waiting for a log that is never stored", async () => {
            server({ pending: Infinity });
            const c = client();
            c.ingestTimeoutMs = 5;
            c.ingestPollMs = 2;
            expect((await c.upload("a.BFL", new Uint8Array([1]), setup())).attachError).toMatch(/still processing/);
        });

        it("does not poll or attach without attachments", async () => {
            const calls = server();
            await client().upload("a.BFL", new Uint8Array([1]));
            expect(calls.some((c) => c.url.includes("/api/ingest/") || c.url.endsWith("/api/attachments"))).toBe(false);
        });
    });
});
