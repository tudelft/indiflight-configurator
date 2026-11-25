import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import MSP from "@/js/msp";
import MSPCodes from "@/js/msp/MSPCodes";
import FC from "@/js/fc";
import { mspHelper } from "@/js/msp/MSPHelper";
import {
    decodeSettingInfoReply,
    decodeSettingReply,
    encodeSettingGet,
    encodeSettingInfoRequest,
    encodeSettingSet,
    formatSettingValue,
    parseSettingInfo,
    parseSettingValue,
    type SettingInfo,
    type SettingValue,
} from "@/js/msp/cliSetting";
import { ALL_SETTING_NAMES } from "@/js/indiflight/indiSettings";
import { useDirtyState } from "@/composables/useDirtyState";

type Values = Record<string, SettingValue>;

/** An MSP request the FC answered with an error: unknown command, unknown setting, out of range, or armed. */
export class IndiSettingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "IndiSettingError";
    }
}

async function request(code: number, payload: number[] = []): Promise<DataView | null> {
    const response = await MSP.promise(code, payload);
    if (!response || response.unsupported) {
        return null;
    }
    return response.data;
}

/**
 * INDI profile settings, read and written by name over MSP2_CLI_SETTING (the firmware has no fixed INDI MSP
 * payload), and the INDI profile selection over MSP2_(SET_)INDI_PROFILE_INDEX.
 *
 * Like the PID tab's store there are two kinds of unsaved work: edited values (`hasEdits`), re-baselined by every
 * load, and what the FC holds in RAM only (`profileDirty`): a profile switch, or a profile written by a copy. Both
 * stay unsaved until the EEPROM write.
 */
export const useIndiConfigStore = defineStore("indiConfig", () => {
    /** The connected firmware answers the INDI MSP commands. Set by `probe()` during connect. */
    const supported = ref(false);
    const profileIndex = ref(0);
    const profileCount = ref(0);
    /** Settings the firmware has, with their type, range and default */
    const info = shallowRef<Record<string, SettingInfo>>({});
    const values = ref<Values>({});
    /** What the FC held at the last load or save, to send only what changed */
    let fcValues: Values = {};
    let infoKey = "";

    const serializeEdits = () => JSON.stringify(values.value);
    const {
        dirty: hasEdits,
        markClean: markEditsClean,
        takeSnapshot: takeEditsSnapshot,
    } = useDirtyState(serializeEdits);
    const { dirty: profileChanged, markClean: markProfileSelectionClean } = useDirtyState(() =>
        String(profileIndex.value),
    );
    const profileUnsaved = ref(false);
    const profileDirty = computed(() => profileChanged.value || profileUnsaved.value);
    const hasChanges = computed(() => hasEdits.value || profileDirty.value);

    async function readProfileIndex(): Promise<boolean> {
        const data = await request(MSPCodes.MSP2_INDI_PROFILE_INDEX);
        if (!data || data.byteLength < 2) {
            return false;
        }
        profileIndex.value = data.getUint8(0);
        profileCount.value = data.getUint8(1);
        return true;
    }

    /** Whether the FC has the INDI MSP commands. Errors count as no, so a stock firmware connects as before. */
    async function probe(): Promise<boolean> {
        try {
            supported.value = await readProfileIndex();
        } catch (e) {
            console.warn("[indiConfig] INDI profile probe failed:", e);
            supported.value = false;
        }
        info.value = {};
        infoKey = "";
        if (supported.value) {
            markProfileSelectionClean();
            profileUnsaved.value = false;
        }
        return supported.value;
    }

    async function readInfo(name: string): Promise<SettingInfo | null> {
        let text = "";
        let total = Infinity;
        while (text.length < total) {
            const data = await request(MSPCodes.MSP2_CLI_SETTING_INFO, encodeSettingInfoRequest(name, text.length));
            if (!data) {
                return null;
            }
            const { totalLength, chunk } = decodeSettingInfoReply(data);
            total = totalLength;
            if (!chunk.length) {
                break;
            }
            text += chunk;
        }
        return parseSettingInfo(text);
    }

    async function readSetting(name: string, settingInfo: SettingInfo): Promise<SettingValue> {
        const data = await request(MSPCodes.MSP2_CLI_SETTING, encodeSettingGet(name));
        const reply = data && decodeSettingReply(data);
        if (!reply) {
            throw new IndiSettingError(`Reading ${name} failed`);
        }
        return parseSettingValue(reply.value, settingInfo);
    }

    /** Write one setting and return what the FC now holds (its echo). */
    async function writeSetting(name: string, value: SettingValue): Promise<SettingValue> {
        const settingInfo = info.value[name];
        const data = await request(MSPCodes.MSP2_CLI_SETTING, encodeSettingSet(name, value));
        if (!data) {
            throw new IndiSettingError(`${name} = ${formatSettingValue(value)} was refused`);
        }
        const reply = decodeSettingReply(data);
        // The FC acknowledges a write whose echo didn't fit its reply buffer with an empty reply
        return reply && settingInfo ? parseSettingValue(reply.value, settingInfo) : value;
    }

    /** Ranges and defaults don't change while connected to the same build, so they are read once. */
    async function loadInfo(): Promise<void> {
        const key = [FC.CONFIG.deviceIdentifier, FC.CONFIG.flightControllerVersion, FC.CONFIG.gitRevision].join("|");
        if (key === infoKey && Object.keys(info.value).length) {
            return;
        }
        const next: Record<string, SettingInfo> = {};
        for (const name of ALL_SETTING_NAMES) {
            const settingInfo = await readInfo(name);
            if (settingInfo) {
                next[name] = settingInfo;
            }
        }
        info.value = next;
        infoKey = key;
    }

    /** Read the active profile's settings. The loaded values become the clean baseline. */
    async function load(): Promise<void> {
        await readProfileIndex();
        await loadInfo();
        const next: Values = {};
        for (const name of Object.keys(info.value)) {
            next[name] = await readSetting(name, info.value[name]);
        }
        fcValues = structuredClone(next);
        values.value = next;
        markEditsClean();
    }

    function changedSettings(target: Values, reference: Values): string[] {
        return Object.keys(target).filter(
            (name) => formatSettingValue(target[name]) !== formatSettingValue(reference[name]),
        );
    }

    /** Write the edited settings and persist everything to EEPROM. */
    async function save(): Promise<void> {
        // Pin what this save writes: an edit made while the writes are in flight stays dirty
        const snapshot = takeEditsSnapshot();
        const pending: Values = JSON.parse(snapshot);
        for (const name of changedSettings(pending, fcValues)) {
            fcValues[name] = await writeSetting(name, pending[name]);
        }
        if (!FC.CONFIG.armingDisabled) {
            mspHelper.setArmingEnabled(false, false);
        }
        await MSP.promise(MSPCodes.MSP_EEPROM_WRITE);
        // A clamped write shows the value the FC kept
        const clamped = changedSettings(fcValues, pending);
        if (clamped.length) {
            for (const name of clamped) {
                values.value[name] = structuredClone(fcValues[name]);
            }
            markEditsClean(serializeEdits());
        } else {
            markEditsClean(snapshot);
        }
        markProfileSelectionClean();
        profileUnsaved.value = false;
    }

    async function activateProfile(index: number): Promise<void> {
        const data = await request(MSPCodes.MSP2_SET_INDI_PROFILE_INDEX, [index]);
        if (!data) {
            throw new IndiSettingError(`Selecting INDI profile ${index + 1} was refused`);
        }
    }

    async function selectProfile(index: number): Promise<void> {
        await activateProfile(index);
        await load();
    }

    /**
     * Copy the active profile, as the FC holds it, to another profile. The firmware has no copy command, so this
     * switches to the target, writes every setting and switches back. The copy is in RAM until saved.
     */
    async function copyProfileTo(target: number): Promise<void> {
        const source = profileIndex.value;
        const copy = structuredClone(fcValues);
        await activateProfile(target);
        try {
            for (const name of Object.keys(copy)) {
                await writeSetting(name, copy[name]);
            }
        } finally {
            profileUnsaved.value = true;
            await activateProfile(source);
        }
    }

    /** Put the firmware defaults into the form; they are written on save like any edit. */
    function resetToDefaults(): void {
        for (const [name, settingInfo] of Object.entries(info.value)) {
            if (settingInfo.default !== null) {
                values.value[name] = structuredClone(settingInfo.default);
            }
        }
    }

    /** Merge values into the form, e.g. computed effectiveness. Arrays may be shorter than the setting. */
    function applyValues(partial: Values): void {
        for (const [name, value] of Object.entries(partial)) {
            const current = values.value[name];
            if (!(name in info.value)) {
                continue;
            }
            if (Array.isArray(current) && Array.isArray(value)) {
                values.value[name] = current.map((v, i) => (i < value.length ? value[i] : v));
            } else {
                values.value[name] = value;
            }
        }
    }

    return {
        supported,
        profileIndex,
        profileCount,
        info,
        values,
        hasEdits,
        hasChanges,
        profileDirty,
        probe,
        load,
        save,
        selectProfile,
        copyProfileTo,
        resetToDefaults,
        applyValues,
    };
});
