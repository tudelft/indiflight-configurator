import { describe, expect, it } from "vitest";
import {
    decodeSettingInfoReply,
    decodeSettingReply,
    encodeSettingInfoRequest,
    encodeSettingSet,
    parseSettingInfo,
    parseSettingValue,
} from "../../src/js/msp/cliSetting.ts";

const view = (bytes) => new DataView(new Uint8Array(bytes).buffer);
const text = (s) => view(Array.from(new TextEncoder().encode(s)));

describe("cliSetting", () => {
    it("encodes a write as the CLI's set syntax", () => {
        expect(new TextDecoder().decode(new Uint8Array(encodeSettingSet("indi_rate_gains", [200, 210, 1])))).toBe(
            "indi_rate_gains = 200,210,1",
        );
    });

    it("decodes a reply and its values", () => {
        expect(decodeSettingReply(text("indi_act_min = -100,0,5"))).toEqual({
            name: "indi_act_min",
            value: "-100,0,5",
        });
        expect(decodeSettingReply(text(""))).toBeNull();
        expect(parseSettingValue("-100,0,5", { type: "int8[]", isArray: true })).toEqual([-100, 0, 5]);
        expect(parseSettingValue("17", { type: "uint8", isArray: false })).toBe(17);
        expect(parseSettingValue("ON", { type: "lookup", isArray: false })).toBe("ON");
    });

    it("puts the offset after the name's terminator, little-endian", () => {
        expect(encodeSettingInfoRequest("ab", 0x1234)).toEqual([0x61, 0x62, 0, 0x34, 0x12]);
    });

    it("parses setting info as cli.c writes it", () => {
        const scalar = parseSettingInfo("pgn=1000\ntype=int16\nmin=-32768\nmax=32767\ndefault=0");
        expect(scalar).toMatchObject({ type: "int16", isArray: false, length: 1, min: -32768, max: 32767, default: 0 });
        const array = parseSettingInfo("pgn=1000\ntype=uint32[]\nlength=8\ndefault=40000,40000");
        // arrays carry no limits: the element type's range applies
        expect(array).toMatchObject({ isArray: true, length: 8, min: 0, max: 4294967295, default: [40000, 40000] });
        const lookup = parseSettingInfo("pgn=1\ntype=lookup\nvalues=OFF,ON\ndefault=ON\n");
        expect(lookup).toMatchObject({ values: ["OFF", "ON"], default: "ON", min: null, max: null });
    });

    it("reads the total length ahead of the chunk", () => {
        expect(decodeSettingInfoReply(view([10, 1, 0x61]))).toEqual({ totalLength: 266, chunk: "a" });
        expect(() => decodeSettingInfoReply(view([1]))).toThrow();
    });
});
