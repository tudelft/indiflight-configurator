/**
 * Command line options of a PyNDIflight simulation script (`support/simulation/*.py`), read from
 * its argparse calls so the Simulation tab can offer them without running the script.
 */

/** Set by the SIL container's entrypoint (or HIL-only); the daemon rejects them, see start.py */
export const RESERVED_SIM_ARGS = ["--sil", "--sil-profile-txt", "--hil"];

/** What the daemon accepts per argv entry */
const SIM_ARG_RE = /^[A-Za-z0-9_.:/=+,-]+$/;

/**
 * @typedef {object} SimFlag
 * @property {string} flag  e.g. "--throw"
 * @property {string} help
 */

/**
 * Boolean (`action="store_true"`) options of a sim script, in declaration order.
 * @param {string} text  Python source
 * @returns {SimFlag[]}
 */
export function parseSimFlags(text) {
    const flags = [];
    // add_argument( ... ) up to the closing paren of the call; help strings don't contain parens here,
    // and a call this misreads only costs a missing switch (the option can still go in "extra args")
    const callRe = /\.add_argument\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
    for (const [, args] of text.matchAll(callRe)) {
        if (!/\baction\s*=\s*["']store_true["']/.test(args)) {
            continue;
        }
        const flag = args.match(/["'](--[A-Za-z0-9][A-Za-z0-9-]*)["']/)?.[1];
        if (
            !flag ||
            flag.startsWith("--hil") ||
            RESERVED_SIM_ARGS.includes(flag) ||
            flags.some((f) => f.flag === flag)
        ) {
            continue;
        }
        const help = args.match(/\bhelp\s*=\s*(["'])(.*?)\1/)?.[2] ?? "";
        flags.push({ flag, help });
    }
    return flags;
}

/**
 * Split free-text extra arguments into argv entries and check them like the daemon does.
 * @param {string} text
 * @returns {{args: string[], invalid: string[]}}
 */
export function splitSimArgs(text) {
    const args = text.split(/\s+/).filter(Boolean);
    const invalid = args.filter((a) => !SIM_ARG_RE.test(a) || RESERVED_SIM_ARGS.includes(a.split("=")[0]));
    return { args, invalid };
}
