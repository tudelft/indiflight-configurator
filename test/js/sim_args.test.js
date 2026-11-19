import { describe, expect, it } from "vitest";
import { parseSimFlags, splitSimArgs } from "../../src/js/indiflight/simArgs";

// Excerpt of support/simulation/exampleQuadSim.py
const QUAD_SIM = `
    parser = ArgumentParser(formatter_class=ArgumentDefaultsHelpFormatter)
    parser.add_argument("--sil", required=False, type=str, metavar="LIBRARY", default=None, help="Load INDIflight interface as shared library.")
    parser.add_argument("--sil-profile-txt", required=False, type=str, metavar="PROFILE.txt", help="Import these profile settings into the SIL")
    parser.add_argument("--hil", required=False, type=str, metavar="DEVICE", help="Use INDIflight hardware interface. Use either --hil or --sil")
    parser.add_argument("--hil-baud", required=False, choices=SUPPORTED_BAUDS, type=int, default=921600, help="HIL baudrate ")
    parser.add_argument("--mocap", required=False, nargs=2, metavar=("IP", "PORT"), help="Stream mocap UDP packets to this IP/hostname and port")
    parser.add_argument("--no-vis", required=False, action="store_true", help="Do not launch visualization webserver")
    parser.add_argument("--no-real-time", required=False, action="store_true", help="Run as fast as possible")
    parser.add_argument("--catapult", required=False, action="store_true", help="Use catapult (sil-only)")
    parser.add_argument("--throw", required=False, action="store_true", help="Use throwing")
    parser.add_argument("--learn", required=False, action="store_true", help="Learn after throw/catapult (sil-only)")
    args = parser.parse_args()
`;

describe("parseSimFlags", () => {
    it("lists store_true options in order, with help", () => {
        expect(parseSimFlags(QUAD_SIM)).toEqual([
            { flag: "--no-vis", help: "Do not launch visualization webserver" },
            { flag: "--no-real-time", help: "Run as fast as possible" },
            { flag: "--catapult", help: "Use catapult (sil-only)" },
            { flag: "--throw", help: "Use throwing" },
            { flag: "--learn", help: "Learn after throw/catapult (sil-only)" },
        ]);
    });

    it("skips options with values, even with a tuple metavar before the closing paren", () => {
        const flags = parseSimFlags(QUAD_SIM).map((f) => f.flag);
        expect(flags).not.toContain("--mocap");
        expect(flags).not.toContain("--sil");
    });

    it("handles single quotes, multi-line calls and short aliases", () => {
        const text = `p.add_argument(
            '-f', '--fast',
            action='store_true',
            help='go fast')`;
        expect(parseSimFlags(text)).toEqual([{ flag: "--fast", help: "go fast" }]);
    });

    it("ignores HIL-only switches", () => {
        expect(parseSimFlags(`p.add_argument("--hil-debug", action="store_true")`)).toEqual([]);
    });

    it("returns nothing for empty or unrelated text", () => {
        expect(parseSimFlags("")).toEqual([]);
        expect(parseSimFlags("print('hello')")).toEqual([]);
    });
});

describe("splitSimArgs", () => {
    it("splits on whitespace", () => {
        expect(splitSimArgs("  --no-real-time   --mocap 10.0.0.1 5005 ")).toEqual({
            args: ["--no-real-time", "--mocap", "10.0.0.1", "5005"],
            invalid: [],
        });
    });

    it("flags shell-ish tokens and arguments the daemon sets itself", () => {
        expect(splitSimArgs("--x;rm --sil=foo.so --sil-profile-txt a $(id)").invalid).toEqual([
            "--x;rm",
            "--sil=foo.so",
            "--sil-profile-txt",
            "$(id)",
        ]);
    });
});
