import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useLogStore } from "../../src/stores/log";

function logged(message) {
    const store = useLogStore();
    store.add(message);
    return store.entries.at(-1).message;
}

// Parse the stored HTML the way LogDialog's v-html does, to check what would end up in the DOM.
function render(html) {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
}

describe("log store sanitising", () => {
    beforeEach(() => setActivePinia(createPinia()));

    it.each([
        ["<script>window.pwned = 1</script>LOG.BFL"],
        ['<img src="x" onerror="window.pwned = 1">'],
        ['<svg onload="window.pwned = 1"></svg>'],
        ['<iframe src="https://evil.example"></iframe>'],
        ['<a href="javascript:window.pwned = 1">click</a>'],
        ['<span onclick="window.pwned = 1" style="position:fixed;inset:0">x</span>'],
        ['<strong onmouseover="window.pwned = 1">x</strong>'],
        ['<form action="https://evil.example"><input name="token"></form>'],
        ["<style>body{display:none}</style>"],
        ['"><img src=x onerror=alert(1)>'],
        ['<a href="https://ok.example" onclick="window.pwned = 1">ok</a>'],
    ])("removes anything that could run script or change the page: %s", (message) => {
        const el = render(logged(message));
        expect(el.querySelector("script, img, svg, iframe, form, input, style")).toBeNull();
        for (const node of el.querySelectorAll("*")) {
            for (const attr of node.attributes) {
                expect(["class", "href", "target", "rel"]).toContain(attr.name);
            }
        }
        for (const a of el.querySelectorAll("a[href]")) {
            expect(a.getAttribute("href")).not.toMatch(/^\s*javascript:/i);
        }
    });

    it("keeps the formatting that translations use", () => {
        const message =
            '<strong>Note:</strong> <span class="message-negative">failed</span><br><b>x</b> <code>y</code> ' +
            '<a href="https://github.com/tudelft/indiflight" target="_blank" rel="noopener noreferrer">repo</a>';
        const el = render(logged(message));
        expect(el.querySelector("strong").textContent).toBe("Note:");
        expect(el.querySelector("span.message-negative").textContent).toBe("failed");
        expect(el.querySelector("br")).not.toBeNull();
        const a = el.querySelector("a");
        expect(a.getAttribute("href")).toBe("https://github.com/tudelft/indiflight");
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("shows plain text with angle brackets as text", () => {
        expect(render(logged("1 < 2 && 3 > 2")).textContent).toBe("1 < 2 && 3 > 2");
    });

    it("accepts non-string messages", () => {
        expect(logged(42)).toBe("42");
        expect(logged(new Error("boom"))).toBe("Error: boom");
    });
});
