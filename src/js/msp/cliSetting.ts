/**
 * Encode/decode for MSP2_CLI_SETTING and MSP2_CLI_SETTING_INFO, which get and set any CLI setting by name.
 * Free of app imports so it can be unit-tested and used by stores without an import cycle through MSPHelper.
 *
 *  - MSP2_CLI_SETTING: request "name" (get) or "name = value" (set), reply "name = value". Arrays are
 *    comma-separated. Settings of a profile apply to the active profile.
 *  - MSP2_CLI_SETTING_INFO: request "name\0" plus an optional u16 byte offset, reply u16 total length plus the
 *    window of "key=value\n" lines starting at that offset (pgn, type, min, max or length, values, default).
 */

export type SettingValue = number | number[] | string;

export interface SettingInfo {
    pgn: number;
    /** "uint8", "int16", ..., "uint8[]", ..., "lookup", "bitset" or "string" */
    type: string;
    isArray: boolean;
    /** Array length, 1 for scalars */
    length: number;
    min: number | null;
    max: number | null;
    /** Lookup / bitset names */
    values: string[] | null;
    default: SettingValue | null;
}

const TYPE_RANGES: Record<string, [number, number]> = {
    uint8: [0, 255],
    int8: [-128, 127],
    uint16: [0, 65535],
    int16: [-32768, 32767],
    uint32: [0, 4294967295],
    int32: [-2147483648, 2147483647],
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesOf = (text: string): number[] => Array.from(encoder.encode(text));

const textOf = (view: DataView, offset = 0): string =>
    decoder.decode(new Uint8Array(view.buffer, view.byteOffset + offset, view.byteLength - offset));

export function encodeSettingGet(name: string): number[] {
    return bytesOf(name);
}

export function formatSettingValue(value: SettingValue): string {
    return Array.isArray(value) ? value.join(",") : String(value);
}

export function encodeSettingSet(name: string, value: SettingValue): number[] {
    return bytesOf(`${name} = ${formatSettingValue(value)}`);
}

/** The "name = value" reply, or null when it isn't one. */
export function decodeSettingReply(view: DataView): { name: string; value: string } | null {
    const text = textOf(view);
    const eq = text.indexOf("=");
    if (eq < 0) {
        return null;
    }
    return { name: text.slice(0, eq).trim(), value: text.slice(eq + 1).trim() };
}

export function encodeSettingInfoRequest(name: string, offset = 0): number[] {
    return [...bytesOf(name), 0, offset & 0xff, (offset >> 8) & 0xff];
}

export function decodeSettingInfoReply(view: DataView): { totalLength: number; chunk: string } {
    if (view.byteLength < 2) {
        throw new Error("Truncated setting info reply");
    }
    return { totalLength: view.getUint16(0, true), chunk: textOf(view, 2) };
}

/** Parse a raw value string by the setting's type: numbers (or number arrays) for numeric types. */
export function parseSettingValue(raw: string, info: Pick<SettingInfo, "type" | "isArray">): SettingValue {
    const base = info.type.replace("[]", "");
    if (!(base in TYPE_RANGES)) {
        return raw;
    }
    if (info.isArray) {
        return raw.split(",").map((v) => Number(v.trim()));
    }
    return Number(raw);
}

export function parseSettingInfo(text: string): SettingInfo {
    const fields: Record<string, string> = {};
    for (const line of text.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) {
            fields[line.slice(0, eq)] = line.slice(eq + 1);
        }
    }
    const type = fields.type ?? "";
    const isArray = type.endsWith("[]");
    const range = TYPE_RANGES[type.replace("[]", "")];
    const info: SettingInfo = {
        pgn: Number(fields.pgn),
        type,
        isArray,
        length: isArray ? Number(fields.length) : 1,
        // Arrays report no limits, so they get their element type's range
        min: fields.min !== undefined ? Number(fields.min) : (range?.[0] ?? null),
        max: fields.max !== undefined ? Number(fields.max) : (range?.[1] ?? null),
        values: fields.values !== undefined ? fields.values.split(",") : null,
        default: null,
    };
    if (fields.default !== undefined) {
        info.default = parseSettingValue(fields.default, info);
    }
    return info;
}
