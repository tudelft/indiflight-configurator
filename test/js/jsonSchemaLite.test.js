import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateJsonSchema } from "../../src/js/utils/jsonSchemaLite";

const vtxSchema = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "resources/jsonschema/vtxconfig_schema-1.0.json"), "utf8"),
);

// A typical VTX table file as the VTX tab saves it.
function vtxFile() {
    return {
        description: "Betaflight VTX Config file",
        version: "1.0",
        vtx_table: {
            bands_list: [
                {
                    name: "BOSCAM_A",
                    letter: "A",
                    is_factory_band: true,
                    frequencies: [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725],
                },
                {
                    name: "RACEBAND",
                    letter: "R",
                    is_factory_band: false,
                    frequencies: [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917],
                },
            ],
            powerlevels_list: [
                { value: 25, label: "25 " },
                { value: 200, label: "200" },
            ],
        },
    };
}

describe("validateJsonSchema with the VTX config schema", () => {
    it("accepts a valid VTX table file", () => {
        expect(validateJsonSchema(vtxSchema, vtxFile())).toEqual([]);
    });

    it("accepts empty lists and extra properties (the schema allows them)", () => {
        const file = vtxFile();
        file.vtx_table.bands_list = [];
        file.vtx_table.powerlevels_list = [];
        file.vtx_table.extra = 1;
        file.comment = "x";
        expect(validateJsonSchema(vtxSchema, file)).toEqual([]);
    });

    it.each([
        ["missing description", (f) => delete f.description, '$: missing "description"'],
        ["missing vtx_table", (f) => delete f.vtx_table, '$: missing "vtx_table"'],
        ["numeric version", (f) => (f.version = 1), "$.version: expected string"],
        ["missing bands_list", (f) => delete f.vtx_table.bands_list, '$.vtx_table: missing "bands_list"'],
        ["bands_list not an array", (f) => (f.vtx_table.bands_list = {}), "$.vtx_table.bands_list: expected array"],
        [
            "band without letter",
            (f) => delete f.vtx_table.bands_list[1].letter,
            '$.vtx_table.bands_list[1]: missing "letter"',
        ],
        [
            "factory flag as string",
            (f) => (f.vtx_table.bands_list[0].is_factory_band = "true"),
            "$.vtx_table.bands_list[0].is_factory_band: expected boolean",
        ],
        [
            "fractional frequency",
            (f) => (f.vtx_table.bands_list[0].frequencies[3] = 5805.5),
            "$.vtx_table.bands_list[0].frequencies[3]: expected integer",
        ],
        [
            "frequency as string",
            (f) => (f.vtx_table.bands_list[0].frequencies[0] = "5865"),
            "$.vtx_table.bands_list[0].frequencies[0]: expected integer",
        ],
        [
            "power level without label",
            (f) => delete f.vtx_table.powerlevels_list[0].label,
            '$.vtx_table.powerlevels_list[0]: missing "label"',
        ],
        [
            "power value null",
            (f) => (f.vtx_table.powerlevels_list[1].value = null),
            "$.vtx_table.powerlevels_list[1].value: expected integer",
        ],
    ])("rejects %s", (_name, mutate, expected) => {
        const file = vtxFile();
        mutate(file);
        const errors = validateJsonSchema(vtxSchema, file);
        expect(
            errors.some((e) => e.startsWith(expected)),
            JSON.stringify(errors),
        ).toBe(true);
    });

    it.each([[[]], [null], ["{}"], [42]])("rejects a top level that is not an object: %j", (value) => {
        expect(validateJsonSchema(vtxSchema, value)[0]).toMatch(/^\$: expected object, got /);
    });

    it("does not count an inherited property as present", () => {
        const file = vtxFile();
        const proto = { description: "from prototype" };
        delete file.description;
        expect(validateJsonSchema(vtxSchema, Object.assign(Object.create(proto), file))).toContain(
            '$: missing "description"',
        );
    });
});

describe("validateJsonSchema keywords", () => {
    it("checks pattern on strings", () => {
        const schema = { type: "string", pattern: "^[A-Z]$" };
        expect(validateJsonSchema(schema, "A")).toEqual([]);
        expect(validateJsonSchema(schema, "AB")).toEqual(["$: does not match ^[A-Z]$"]);
    });

    it("accepts a list of types", () => {
        const schema = { type: ["integer", "null"] };
        expect(validateJsonSchema(schema, null)).toEqual([]);
        expect(validateJsonSchema(schema, 3)).toEqual([]);
        expect(validateJsonSchema(schema, 3.5)).toEqual(["$: expected integer or null, got number"]);
    });

    it("does not treat NaN or Infinity as numbers", () => {
        expect(validateJsonSchema({ type: "number" }, Number.NaN)).not.toEqual([]);
        expect(validateJsonSchema({ type: "number" }, Infinity)).not.toEqual([]);
    });

    it.each([["minimum"], ["$ref"], ["enum"], ["additionalProperties"], ["oneOf"]])(
        "throws on the unsupported keyword %s instead of ignoring it",
        (keyword) => {
            const schema = { type: "object", properties: { a: { [keyword]: 1 } } };
            expect(() => validateJsonSchema(schema, { a: 0 })).toThrow(keyword);
        },
    );

    it("throws on an unsupported keyword even where the value would not reach it", () => {
        expect(() => validateJsonSchema({ type: "object", properties: { a: { minimum: 0 } } }, {})).toThrow();
    });

    it("throws on tuple items", () => {
        expect(() => validateJsonSchema({ items: [{ type: "string" }] }, ["a"])).toThrow("tuple");
    });
});
