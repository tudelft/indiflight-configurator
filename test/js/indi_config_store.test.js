import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * A fake FC speaking MSP2_CLI_SETTING(_INFO) and MSP2_(SET_)INDI_PROFILE_INDEX as msp.c / cli.c do: replies are
 * "name = v1,v2", unknown names and out-of-range writes are refused, setting info is windowed by offset.
 */
const fc = vi.hoisted(() => {
    const SCHEMA = {
        indi_act_num: { type: "uint8", min: 0, max: 8, def: 4 },
        indi_attitude_gains: { type: "uint16[]", length: 3, def: [2000, 2000, 1000] },
        indi_use_increment: { type: "uint8", min: 0, max: 1, def: 1 },
        indi_act_g1_fz: { type: "int16[]", length: 8, def: [0, 0, 0, 0, 0, 0, 0, 0] },
        indi_act_type: { type: "uint8[]", length: 8, def: [1, 1, 1, 1, 1, 1, 1, 1] },
    };
    const state = {
        profiles: [],
        active: 0,
        eepromWrites: 0,
        log: [],
        infoChunk: 1000,
        armed: false,
        onSet: null,
        stock: false,
    };
    const fresh = () => Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, structuredClone(s.def)]));
    const fmt = (v) => (Array.isArray(v) ? v.join(",") : String(v));
    const reply = (text) => ({ data: new DataView(new TextEncoder().encode(text).buffer), unsupported: 0 });
    const bytes = (arr) => ({ data: new DataView(new Uint8Array(arr).buffer), unsupported: 0 });
    const refused = { data: new DataView(new ArrayBuffer(0)), unsupported: 1 };
    const inRange = (s, v) => {
        const lim = { uint8: [0, 255], uint16: [0, 65535], int16: [-32768, 32767] }[s.type.replace("[]", "")];
        const lo = s.min ?? lim[0];
        const hi = s.max ?? lim[1];
        return (Array.isArray(v) ? v : [v]).every((x) => Number.isInteger(x) && x >= lo && x <= hi);
    };
    function infoText(name) {
        const s = SCHEMA[name];
        let t = `pgn=1000\ntype=${s.type}\n`;
        t += s.length ? `length=${s.length}\n` : `min=${s.min}\nmax=${s.max}\n`;
        return `${t}default=${fmt(s.def)}`;
    }
    function handle(code, payload = []) {
        const text = new TextDecoder().decode(new Uint8Array(payload));
        state.log.push({ code, text });
        if (state.stock && code !== 250) {
            return refused;
        }
        switch (code) {
            case 0x400a:
                return bytes([state.active, state.profiles.length]);
            case 0x400b:
                if (state.armed || payload[0] >= state.profiles.length) {
                    return refused;
                }
                state.active = payload[0];
                return bytes([]);
            case 0x3010: {
                const eq = text.indexOf("=");
                const name = (eq < 0 ? text : text.slice(0, eq)).trim();
                const s = SCHEMA[name];
                if (!s) {
                    return refused;
                }
                const p = state.profiles[state.active];
                if (eq >= 0) {
                    const raw = text.slice(eq + 1).trim();
                    const v = s.length ? raw.split(",").map(Number) : Number(raw);
                    if ((s.length && v.length !== s.length) || !inRange(s, v)) {
                        return refused;
                    }
                    p[name] = v;
                    state.onSet?.(name);
                }
                return reply(`${name} = ${fmt(p[name])}`);
            }
            case 0x3011: {
                const nul = payload.indexOf(0);
                const name = text.slice(0, nul);
                if (!SCHEMA[name]) {
                    return refused;
                }
                const offset = payload[nul + 1] | (payload[nul + 2] << 8);
                const full = infoText(name);
                const chunk = new TextEncoder().encode(full.slice(offset, offset + state.infoChunk));
                const out = new Uint8Array(2 + chunk.length);
                out[0] = full.length & 0xff;
                out[1] = full.length >> 8;
                out.set(chunk, 2);
                return { data: new DataView(out.buffer), unsupported: 0 };
            }
            case 250: // MSP_EEPROM_WRITE
                state.eepromWrites++;
                return bytes([]);
            default:
                return refused;
        }
    }
    function reset() {
        state.profiles = [fresh(), fresh(), fresh()];
        state.active = 0;
        state.eepromWrites = 0;
        state.log = [];
        state.infoChunk = 1000;
        state.armed = false;
        state.onSet = null;
        state.stock = false;
    }
    return { state, handle, reset, sets: () => state.log.filter((e) => e.code === 0x3010 && e.text.includes("=")) };
});

vi.mock("../../src/js/msp", () => ({ default: { promise: async (code, payload) => fc.handle(code, payload) } }));
vi.mock("../../src/js/msp/MSPHelper", () => ({ mspHelper: { setArmingEnabled: () => {} } }));
vi.mock("../../src/js/fc", () => ({
    default: {
        CONFIG: { deviceIdentifier: "x", flightControllerVersion: "5", gitRevision: "g", armingDisabled: true },
    },
}));

import { useIndiConfigStore } from "../../src/stores/indiConfig.ts";

async function loadedStore() {
    const store = useIndiConfigStore();
    expect(await store.probe()).toBe(true);
    await store.load();
    return store;
}

describe("indiConfig store", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        fc.reset();
    });

    it("probe says no to a firmware without the INDI MSP", async () => {
        fc.state.stock = true;
        const store = useIndiConfigStore();
        expect(await store.probe()).toBe(false);
        expect(store.supported).toBe(false);
    });

    it("loads the settings the firmware has, and only those", async () => {
        const store = await loadedStore();
        expect(store.profileCount).toBe(3);
        expect(store.values.indi_attitude_gains).toEqual([2000, 2000, 1000]);
        expect(store.values.indi_act_num).toBe(4);
        // indi_rate_gains is in the tab's list but not in this firmware
        expect("indi_rate_gains" in store.values).toBe(false);
        expect("indi_rate_gains" in store.info).toBe(false);
        expect(store.info.indi_act_num).toMatchObject({ min: 0, max: 8, default: 4 });
        expect(store.hasChanges).toBe(false);
    });

    it("reads setting info in windows when it doesn't fit one reply", async () => {
        fc.state.infoChunk = 7;
        const store = await loadedStore();
        expect(store.info.indi_act_g1_fz).toMatchObject({ isArray: true, length: 8, min: -32768, max: 32767 });
        expect(store.info.indi_act_g1_fz.default).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it("saves only what changed, persists, and is clean afterwards", async () => {
        const store = await loadedStore();
        store.values.indi_attitude_gains = [2100, 2000, 1000];
        expect(store.hasChanges).toBe(true);
        await store.save();
        expect(fc.sets().map((e) => e.text)).toEqual(["indi_attitude_gains = 2100,2000,1000"]);
        expect(fc.state.eepromWrites).toBe(1);
        expect(fc.state.profiles[0].indi_attitude_gains).toEqual([2100, 2000, 1000]);
        expect(store.hasChanges).toBe(false);
        // Saving again sends nothing new
        await store.save();
        expect(fc.sets()).toHaveLength(1);
    });

    it("keeps an edit made while the save is in flight dirty", async () => {
        const store = await loadedStore();
        store.values.indi_act_num = 6;
        fc.state.onSet = () => {
            store.values.indi_use_increment = 0;
        };
        await store.save();
        expect(fc.state.profiles[0].indi_act_num).toBe(6);
        expect(fc.state.profiles[0].indi_use_increment).toBe(1);
        expect(store.hasEdits).toBe(true);
    });

    it("stays dirty and writes nothing to EEPROM when the FC refuses a value", async () => {
        const store = await loadedStore();
        store.values.indi_act_num = 9; // above max
        await expect(store.save()).rejects.toThrow(/indi_act_num/);
        expect(fc.state.eepromWrites).toBe(0);
        expect(store.hasEdits).toBe(true);
    });

    it("switches profiles, and the switch is unsaved until saved", async () => {
        const store = await loadedStore();
        fc.state.profiles[2].indi_attitude_gains = [1, 2, 3];
        await store.selectProfile(2);
        expect(fc.state.active).toBe(2);
        expect(store.profileIndex).toBe(2);
        expect(store.values.indi_attitude_gains).toEqual([1, 2, 3]);
        expect(store.hasEdits).toBe(false);
        expect(store.hasChanges).toBe(true);
        await store.save();
        expect(store.hasChanges).toBe(false);
        expect(fc.state.eepromWrites).toBe(1);
        await store.selectProfile(0);
        expect(store.hasChanges).toBe(true);
    });

    it("rejects a refused profile switch", async () => {
        const store = await loadedStore();
        fc.state.armed = true;
        await expect(store.selectProfile(1)).rejects.toThrow();
        expect(store.profileIndex).toBe(0);
    });

    it("copies the profile as the FC holds it, not the unsaved edits, and returns to it", async () => {
        const store = await loadedStore();
        fc.state.profiles[0].indi_act_g1_fz = [-700, -700, -700, -700, 0, 0, 0, 0];
        await store.load();
        store.values.indi_act_num = 7; // unsaved edit, must not travel
        await store.copyProfileTo(1);
        expect(fc.state.active).toBe(0);
        expect(fc.state.profiles[1].indi_act_g1_fz).toEqual([-700, -700, -700, -700, 0, 0, 0, 0]);
        expect(fc.state.profiles[1].indi_act_num).toBe(4);
        expect(fc.state.profiles[0].indi_act_num).toBe(4);
        expect(store.profileDirty).toBe(true);
    });

    it("refuses a copy when the FC refuses the switch, writing nothing", async () => {
        const store = await loadedStore();
        fc.state.armed = true;
        await expect(store.copyProfileTo(1)).rejects.toThrow();
        expect(fc.sets()).toHaveLength(0);
        expect(store.profileDirty).toBe(false);
    });

    it("resets to the firmware defaults as edits", async () => {
        fc.state.profiles[0].indi_attitude_gains = [5, 5, 5];
        fc.state.profiles[0].indi_act_num = 6;
        const store = await loadedStore();
        store.resetToDefaults();
        expect(store.values.indi_attitude_gains).toEqual([2000, 2000, 1000]);
        expect(store.values.indi_act_num).toBe(4);
        expect(store.hasEdits).toBe(true);
        expect(fc.state.profiles[0].indi_act_num).toBe(6);
    });

    it("merges shorter arrays and ignores settings the firmware lacks", async () => {
        const store = await loadedStore();
        store.applyValues({ indi_act_g1_fz: [-1, -2], indi_rate_gains: [1, 2, 3] });
        expect(store.values.indi_act_g1_fz).toEqual([-1, -2, 0, 0, 0, 0, 0, 0]);
        expect("indi_rate_gains" in store.values).toBe(false);
    });
});
