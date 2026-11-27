import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * TextMate grammar for Indiflight board/profile files: `#` comments, `#define`/`#undef`
 * build flags, and CLI lines such as `set name = value`.
 */
const configLang = {
    name: "indiflight-config",
    scopeName: "source.indiflight-config",
    patterns: [
        {
            match: "^\\s*(#)\\s*(define|undef)\\b",
            captures: { 1: { name: "keyword.control" }, 2: { name: "keyword.control" } },
        },
        { match: "^\\s*#.*$", name: "comment.line" },
        {
            match: "^\\s*(set)\\s+(\\S+)\\s*(=)?",
            captures: {
                1: { name: "keyword.control" },
                2: { name: "variable.other" },
                3: { name: "keyword.operator" },
            },
        },
        { match: "^\\s*(feature|resource|timer|dma|serial|aux|map|mixer|rxrange|beeper)\\b", name: "keyword.control" },
        { match: "\\b[A-Z][A-Z0-9_]{2,}\\b", name: "constant.other" },
        { match: "-?\\b\\d+(\\.\\d+)?\\b", name: "constant.numeric" },
    ],
};

/** Shiki language ids offered by the UI, mapped to their loader. */
const LANGS = {
    python: () => import("@shikijs/langs/python"),
    config: () => Promise.resolve([configLang]),
};

let highlighterPromise = null;

function getHighlighter() {
    // Loaded on first use so shiki stays out of the main chunk.
    highlighterPromise ??= Promise.all([
        import("@shikijs/themes/github-light"),
        import("@shikijs/themes/github-dark"),
    ]).then(([light, dark]) =>
        createHighlighterCore({
            themes: [light.default, dark.default],
            langs: [],
            engine: createJavaScriptRegexEngine(),
        }),
    );
    return highlighterPromise;
}

/**
 * Highlight text as HTML. Token colors are the CSS variables `--shiki-light` and `--shiki-dark`;
 * the consumer picks one by theme.
 * @param {string} code
 * @param {"python" | "config"} lang
 * @returns {Promise<string>} a `<pre class="shiki">` string
 */
export async function highlightCode(code, lang) {
    const highlighter = await getHighlighter();
    const id = lang === "config" ? configLang.name : lang;
    if (!highlighter.getLoadedLanguages().includes(id)) {
        await highlighter.loadLanguage(...(await LANGS[lang]().then((m) => m.default ?? m)));
    }
    return highlighter.codeToHtml(code, {
        lang: id,
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
    });
}
