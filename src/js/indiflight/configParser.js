/**
 * Parser for Indiflight board/profile config files (`configs/boards/*.txt`, `configs/profiles/*.txt`).
 *
 * The same file feeds two consumers, and this parser mirrors both:
 *  - the Makefile takes lines matching `^#define` and passes their 2nd whitespace token as `-D<token>`;
 *  - `support/scripts/uploadProfile.py` sends everything before the first `#` of each line to the CLI.
 */

/**
 * @typedef {"board" | "profile"} ConfigSource
 *
 * @typedef {object} ConfigDefine
 * @property {string} name
 * @property {string | null} value   value after `=`, null for a plain flag
 * @property {string} token          exactly what make passes as `-D<token>`
 * @property {boolean} enabled       false for commented-out `## #define X` lines
 * @property {string} comment
 * @property {string} section        last `## ----- Title` heading seen
 * @property {number} line           1-based
 * @property {ConfigSource} source
 *
 * @typedef {object} ConfigCommand
 * @property {string} command        the text sent to the CLI
 * @property {string} context        e.g. "" (global), "profile 0", "rateprofile 1"
 * @property {string} comment
 * @property {number} line
 * @property {ConfigSource} source
 *
 * @typedef {object} ParsedConfig
 * @property {ConfigDefine[]} defines
 * @property {ConfigCommand[]} commands
 * @property {string | null} target  value of `#define TARGET=`
 */

const SECTION_RE = /^##\s*-+\s*(.+?)\s*$/;
const DEFINE_RE = /^#define\s+(\S+)(.*)$/;
const DISABLED_DEFINE_RE = /^#+\s*#define\s+(\S+)(.*)$/;
// CLI commands that switch which profile subsequent `set` lines apply to
const CONTEXT_RE = /^(profile|rateprofile|indiprofile|positionprofile)\s+(\d+)$/;

function stripCommentMarker(rest) {
    return rest.replace(/^\s*#*\s*/, "").trim();
}

/**
 * @param {string} text
 * @param {ConfigSource} source
 * @returns {ParsedConfig}
 */
export function parseConfig(text, source) {
    /** @type {ConfigDefine[]} */
    const defines = [];
    /** @type {ConfigCommand[]} */
    const commands = [];
    let section = "";
    const contexts = {};

    text.split(/\r?\n/).forEach((raw, idx) => {
        const line = idx + 1;
        const trimmed = raw.trim();

        const sectionMatch = SECTION_RE.exec(trimmed);
        if (sectionMatch) {
            section = sectionMatch[1];
            return;
        }

        // make greps `^#define`, so only column-0 defines count
        const defineMatch = DEFINE_RE.exec(raw);
        const disabledMatch = defineMatch ? null : DISABLED_DEFINE_RE.exec(trimmed);
        const match = defineMatch ?? disabledMatch;
        if (match) {
            const token = match[1];
            const eq = token.indexOf("=");
            defines.push({
                name: eq >= 0 ? token.slice(0, eq) : token,
                value: eq >= 0 ? token.slice(eq + 1) : null,
                token,
                enabled: !!defineMatch,
                comment: stripCommentMarker(match[2]),
                section,
                line,
                source,
            });
            return;
        }

        const hash = raw.indexOf("#");
        const command = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
        if (!command) {
            return;
        }
        const contextMatch = CONTEXT_RE.exec(command);
        if (contextMatch) {
            contexts[contextMatch[1]] = command;
        }
        commands.push({
            command,
            context: contextMatch ? "" : Object.values(contexts).join(", "),
            comment: hash >= 0 ? stripCommentMarker(raw.slice(hash)) : "",
            line,
            source,
        });
    });

    const target = defines.find((d) => d.enabled && d.name === "TARGET")?.value ?? null;
    return { defines, commands, target };
}

/**
 * @typedef {object} EffectiveDefine
 * @property {ConfigDefine} define
 * @property {ConfigDefine[]} duplicates  other enabled definitions of the same name (board+profile)
 *
 * @typedef {object} EffectiveSetting
 * @property {string} context
 * @property {string} key
 * @property {string} value
 * @property {ConfigCommand} command
 * @property {ConfigCommand[]} overridden  earlier `set` lines of the same key/context
 *
 * @typedef {object} MergedConfig
 * @property {string | null} target
 * @property {EffectiveDefine[]} defines        enabled defines in make's `-D` order (board, then profile)
 * @property {ConfigDefine[]} disabledDefines   commented-out options, not enabled anywhere
 * @property {EffectiveSetting[]} settings      effective `set` values
 * @property {ConfigCommand[]} otherCommands    non-`set` CLI commands (resource, aux, serial, ...)
 * @property {string[]} cliScript               lines uploadProfile.py would send (before `save`)
 */

const SET_RE = /^set\s+(\S+)\s*=\s*(.*)$/;

/**
 * Combine board and profile the way the build and the CLI upload see them.
 * @param {ParsedConfig | null} board
 * @param {ParsedConfig | null} profile
 * @returns {MergedConfig}
 */
export function mergeConfigs(board, profile) {
    const parts = [board, profile].filter(Boolean);

    /** @type {Map<string, EffectiveDefine>} */
    const defineMap = new Map();
    for (const define of parts.flatMap((p) => p.defines).filter((d) => d.enabled)) {
        const existing = defineMap.get(define.name);
        if (existing) {
            existing.duplicates.push(define);
        } else {
            defineMap.set(define.name, { define, duplicates: [] });
        }
    }

    const disabledDefines = parts
        .flatMap((p) => p.defines)
        .filter((d) => !d.enabled && !defineMap.has(d.name))
        .filter((d, i, all) => all.findIndex((o) => o.name === d.name) === i);

    /** @type {Map<string, EffectiveSetting>} */
    const settingMap = new Map();
    const otherCommands = [];
    const cliScript = [];
    for (const command of parts.flatMap((p) => p.commands)) {
        cliScript.push(command.command);
        const setMatch = SET_RE.exec(command.command);
        if (!setMatch) {
            otherCommands.push(command);
            continue;
        }
        const [, key, value] = setMatch;
        const mapKey = `${command.context}\u0000${key}`;
        const previous = settingMap.get(mapKey);
        settingMap.set(mapKey, {
            context: command.context,
            key,
            value: value.trim(),
            command,
            overridden: previous ? [...previous.overridden, previous.command] : [],
        });
    }

    return {
        // make reads TARGET from the board file only
        target: board?.target ?? null,
        defines: [...defineMap.values()],
        disabledDefines,
        settings: [...settingMap.values()],
        otherCommands,
        cliScript,
    };
}
