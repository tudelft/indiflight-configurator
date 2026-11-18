import { describe, expect, it } from "vitest";
import { mergeConfigs, parseConfig } from "../../src/js/indiflight/configParser";

const BOARD = `# header comment
## ----- Basic info
#define TARGET=STM32H743
#define USE_GYRO   ## inline comment
#define\tUSE_BARO
  #define INDENTED_IS_IGNORED_BY_MAKE

defaults nosave
#board_name MATEKH743
resource MOTOR 1 B00
set gyro_1_spibus = 1
set beeper_od = OFF
`;

const PROFILE = `## ----- Features
#define USE_GYRO
## #define USE_LED_STRIP
## #define USE_BARO
#define PI_STATS             ## needs USE_TELEMETRY_PI

feature GPS
set beeper_od = ON   # profile wins
#set ignored = 1
profile 0
set p_roll = 40
profile 1
set p_roll = 50
rateprofile 2
set rate = 1
`;

describe("parseConfig", () => {
    const board = parseConfig(BOARD, "board");
    const profile = parseConfig(PROFILE, "profile");

    it("takes defines exactly as make would pass them to -D", () => {
        expect(board.defines.filter((d) => d.enabled).map((d) => d.token)).toEqual([
            "TARGET=STM32H743",
            "USE_GYRO",
            "USE_BARO",
        ]);
        expect(board.target).toBe("STM32H743");
    });

    it("splits name and value and keeps comments and sections", () => {
        const [target, gyro] = board.defines;
        expect(target).toMatchObject({ name: "TARGET", value: "STM32H743", section: "Basic info", line: 3 });
        expect(gyro).toMatchObject({ name: "USE_GYRO", value: null, comment: "inline comment" });
    });

    it("recognises commented-out defines as disabled options", () => {
        const disabled = profile.defines.filter((d) => !d.enabled).map((d) => d.name);
        expect(disabled).toEqual(["USE_LED_STRIP", "USE_BARO"]);
    });

    it("produces the CLI lines uploadProfile.py would send", () => {
        expect(board.commands.map((c) => c.command)).toEqual([
            "defaults nosave",
            "resource MOTOR 1 B00",
            "set gyro_1_spibus = 1",
            "set beeper_od = OFF",
        ]);
        expect(profile.commands.find((c) => c.command.startsWith("set beeper_od")).comment).toBe("profile wins");
    });

    it("tracks the profile context of set commands", () => {
        const contexts = profile.commands.filter((c) => c.command.startsWith("set ")).map((c) => c.context);
        expect(contexts).toEqual(["", "profile 0", "profile 1", "profile 1, rateprofile 2"]);
    });

    it("handles CRLF line endings", () => {
        const parsed = parseConfig("#define A\r\nset x = 1\r\n", "board");
        expect(parsed.defines[0].token).toBe("A");
        expect(parsed.commands[0].command).toBe("set x = 1");
    });
});

describe("mergeConfigs", () => {
    const merged = mergeConfigs(parseConfig(BOARD, "board"), parseConfig(PROFILE, "profile"));

    it("lists enabled defines once, in board-then-profile order, flagging duplicates", () => {
        expect(merged.defines.map((d) => d.define.token)).toEqual([
            "TARGET=STM32H743",
            "USE_GYRO",
            "USE_BARO",
            "PI_STATS",
        ]);
        const gyro = merged.defines.find((d) => d.define.name === "USE_GYRO");
        expect(gyro.define.source).toBe("board");
        expect(gyro.duplicates.map((d) => d.source)).toEqual(["profile"]);
    });

    it("hides disabled options that are enabled elsewhere", () => {
        expect(merged.disabledDefines.map((d) => d.name)).toEqual(["USE_LED_STRIP"]);
    });

    it("resolves later set commands over earlier ones within the same context", () => {
        const beeper = merged.settings.find((s) => s.key === "beeper_od");
        expect(beeper.value).toBe("ON");
        expect(beeper.command.source).toBe("profile");
        expect(beeper.overridden.map((c) => c.source)).toEqual(["board"]);

        const roll = merged.settings.filter((s) => s.key === "p_roll").map((s) => [s.context, s.value]);
        expect(roll).toEqual([
            ["profile 0", "40"],
            ["profile 1", "50"],
        ]);
    });

    it("keeps non-set commands and builds the full CLI script", () => {
        expect(merged.otherCommands.map((c) => c.command.split(" ")[0])).toEqual([
            "defaults",
            "resource",
            "feature",
            "profile",
            "profile",
            "rateprofile",
        ]);
        expect(merged.cliScript[0]).toBe("defaults nosave");
        expect(merged.cliScript.at(-1)).toBe("set rate = 1");
    });

    it("takes the target from the board even if the profile defines one", () => {
        const conflicting = mergeConfigs(
            parseConfig(BOARD, "board"),
            parseConfig("#define TARGET=STM32F405\n", "profile"),
        );
        expect(conflicting.target).toBe("STM32H743");
        const target = conflicting.defines.find((d) => d.define.name === "TARGET");
        expect(target.duplicates.map((d) => d.token)).toEqual(["TARGET=STM32F405"]);
    });

    it("works with only a board", () => {
        const boardOnly = mergeConfigs(parseConfig(BOARD, "board"), null);
        expect(boardOnly.target).toBe("STM32H743");
        expect(boardOnly.settings).toHaveLength(2);
    });
});
