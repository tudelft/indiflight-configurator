/**
 * Validates JSON against the subset of JSON Schema (draft-07) that the bundled schemas use, by walking the schema.
 * Libraries like djv or ajv compile schemas into code, which a Content-Security-Policy without 'unsafe-eval' blocks.
 * A schema keyword outside the subset throws, so a new schema cannot silently pass unchecked.
 */

const ANNOTATIONS = new Set([
    "$id",
    "$schema",
    "$comment",
    "title",
    "description",
    "default",
    "examples",
    "definitions",
]);
const KEYWORDS = new Set(["type", "required", "properties", "items", "pattern"]);

function typeOf(value) {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    return typeof value;
}

function hasType(value, type) {
    switch (type) {
        case "integer":
            return Number.isInteger(value);
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "object":
            return typeOf(value) === "object";
        default:
            return typeOf(value) === type;
    }
}

// Walk the whole schema up front, so the verdict on a schema does not depend on which parts a value reaches.
function assertSupported(schema, path) {
    for (const key of Object.keys(schema)) {
        if (!ANNOTATIONS.has(key) && !KEYWORDS.has(key)) {
            throw new Error(`Unsupported JSON Schema keyword "${key}" at ${path}`);
        }
    }
    for (const [name, sub] of Object.entries(schema.properties ?? {})) {
        assertSupported(sub, `${path}.properties.${name}`);
    }
    if (Array.isArray(schema.items)) {
        throw new Error(`Unsupported tuple "items" at ${path}`);
    }
    if (schema.items !== undefined) {
        assertSupported(schema.items, `${path}.items`);
    }
}

function check(schema, value, path, errors) {
    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.some((t) => hasType(value, t))) {
            errors.push(`${path}: expected ${types.join(" or ")}, got ${typeOf(value)}`);
            return;
        }
    }

    if (schema.pattern !== undefined && typeof value === "string" && !new RegExp(schema.pattern, "u").test(value)) {
        errors.push(`${path}: does not match ${schema.pattern}`);
    }

    if (typeOf(value) === "object") {
        for (const name of schema.required ?? []) {
            if (!Object.hasOwn(value, name)) {
                errors.push(`${path}: missing "${name}"`);
            }
        }
        for (const [name, sub] of Object.entries(schema.properties ?? {})) {
            if (Object.hasOwn(value, name)) {
                check(sub, value[name], `${path}.${name}`, errors);
            }
        }
    }

    if (Array.isArray(value) && schema.items !== undefined) {
        value.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, errors));
    }
}

/**
 * @param {object} schema
 * @param {unknown} value
 * @returns {string[]} validation errors; empty when valid
 * @throws {Error} when the schema uses a keyword this validator does not implement
 */
export function validateJsonSchema(schema, value) {
    assertSupported(schema, "#");
    const errors = [];
    check(schema, value, "$", errors);
    return errors;
}
