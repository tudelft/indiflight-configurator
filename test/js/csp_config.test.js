import { afterEach, describe, expect, it } from "vitest";
import { cspDirectives, cspPlugin, cspString } from "../../csp.config.js";

describe("Content-Security-Policy", () => {
    afterEach(() => {
        delete process.env.INDIFLIGHT_CSP;
    });

    // The point of the policy: injected markup or strings must not be able to run as script.
    it("keeps script-src free of inline script, eval and broad sources", () => {
        const scriptSrc = cspDirectives["script-src"];
        expect(scriptSrc).toEqual(["'self'"]);
        expect(cspDirectives["script-src-attr"]).toBeUndefined();
        expect(cspDirectives["script-src-elem"]).toBeUndefined();
    });

    it.each([["default-src"], ["worker-src"], ["frame-src"]])("does not allow inline or eval in %s", (name) => {
        const values = cspDirectives[name];
        expect(values.some((v) => /unsafe-(inline|eval)|wasm-unsafe-eval/.test(v))).toBe(false);
        expect(values).not.toContain("*");
        expect(values).not.toContain("https:");
        expect(values).not.toContain("http:");
    });

    it("blocks plugins, base rewriting and form posts", () => {
        expect(cspDirectives["object-src"]).toEqual(["'none'"]);
        expect(cspDirectives["base-uri"]).toEqual(["'self'"]);
        expect(cspDirectives["form-action"]).toEqual(["'none'"]);
    });

    it("allows plain http only to loopback", () => {
        for (const values of Object.values(cspDirectives)) {
            for (const v of values.filter((x) => /^(http|ws):/.test(x))) {
                expect(v).toMatch(/^(http|ws):\/\/(127\.0\.0\.1|localhost):\*$/);
            }
        }
    });

    it("serialises to one header value with no stray separators", () => {
        const csp = cspString();
        expect(csp).toContain("script-src 'self'; ");
        expect(csp).not.toMatch(/;;|; ;|\n/);
        expect(csp.split("; ")).toHaveLength(Object.keys(cspDirectives).length);
    });
});

describe("cspPlugin", () => {
    afterEach(() => {
        delete process.env.INDIFLIGHT_CSP;
    });

    it("only runs in builds", () => {
        expect(cspPlugin().apply).toBe("build");
    });

    it("adds nothing unless INDIFLIGHT_CSP=1, so Tauri and Android builds stay unchanged", () => {
        expect(cspPlugin().transformIndexHtml()).toEqual([]);
        process.env.INDIFLIGHT_CSP = "true";
        expect(cspPlugin().transformIndexHtml()).toEqual([]);
    });

    it("prepends the meta tag for the web deploy", () => {
        process.env.INDIFLIGHT_CSP = "1";
        expect(cspPlugin().transformIndexHtml()).toEqual([
            {
                tag: "meta",
                attrs: { "http-equiv": "Content-Security-Policy", content: cspString() },
                injectTo: "head-prepend",
            },
        ]);
    });
});
