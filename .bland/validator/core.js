"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageError = exports.LIMITS = void 0;
exports.fail = fail;
exports.canonical = canonical;
exports.contentHash = contentHash;
exports.record = record;
exports.safePath = safePath;
exports.json = json;
exports.validate = validate;
const node_crypto_1 = require("node:crypto");
exports.LIMITS = Object.freeze({
    maxBytes: 10 * 1024 * 1024,
    maxFileBytes: 10 * 1024 * 1024,
    maxFiles: 1000,
    maxDepth: 40,
    maxYamlTokens: 50_000,
    maxPathLength: 1024,
    maxPathComponent: 240,
});
class PackageError extends Error {
    code;
    path;
    constructor(code, message, path) {
        super(path ? `${path}: ${message}` : message);
        this.code = code;
        this.path = path;
        this.name = "PackageError";
    }
}
exports.PackageError = PackageError;
function fail(message, path) {
    throw new PackageError("INVALID_PACKAGE", message, path);
}
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object")
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
            .join(",")}}`;
    return JSON.stringify(value);
}
function contentHash(value) {
    return (0, node_crypto_1.createHash)("sha256").update(canonical(value)).digest("hex");
}
function record(value, path) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail("Expected an object", path);
}
function safePath(path) {
    if (typeof path !== "string" ||
        path.length > exports.LIMITS.maxPathLength ||
        !/^[\w./-]+$/.test(path) ||
        path
            .split("/")
            .some((p) => !p ||
            p.length > exports.LIMITS.maxPathComponent ||
            p === "." ||
            p === ".." ||
            [".git", ".gitignore", ".blandrc"].includes(p.toLowerCase()) ||
            /^\.(?:env(?:\.|$)|bland-(?:local|write)(?:\.|$))/i.test(p)))
        fail("Unsafe file path", String(path));
}
function json(value, path, depth = 0) {
    if (depth > exports.LIMITS.maxDepth)
        fail("Depth limit exceeded", path);
    if (value === null ||
        typeof value === "string" ||
        typeof value === "boolean")
        return;
    if (typeof value === "number" && Number.isFinite(value))
        return;
    if (Array.isArray(value)) {
        value.forEach((v, i) => json(v, `${path}[${i}]`, depth + 1));
        return;
    }
    record(value, path);
    for (const [key, v] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key))
            fail("Unsafe object key", path);
        json(v, `${path}.${key}`, depth + 1);
    }
}
function entities(value, path) {
    if (!Array.isArray(value))
        fail("Expected an array", path);
    const ids = new Set();
    for (const item of value) {
        record(item, path);
        if (typeof item.id !== "string" ||
            !/^[a-zA-Z0-9_-]{1,128}$/.test(item.id))
            fail("Expected a stable alphanumeric id", path);
        if (ids.has(item.id))
            fail(`Duplicate id ${item.id}`, path);
        ids.add(item.id);
    }
}
function validateGraph(value, path) {
    record(value, path);
    entities(value.nodes, path);
    if (!Array.isArray(value.edges))
        fail("Expected edges array", path);
    for (const node of value.nodes) {
        const data = node.data;
        if ((["complex-scenario", "complex-auth"].includes(String(node.type)) ||
            (node.type === "auth-zone" && data?.mode === "complex")) &&
            data?.flow == null)
            fail("Complex scenario requires a flow", `${path}/${node.id}`);
        if (data?.flow != null)
            validateGraph(data.flow, `${path}/${node.id}`);
    }
    const nodes = new Set(value.nodes.map((node) => node.id));
    const edges = new Set();
    for (const edge of value.edges) {
        record(edge, path);
        if (typeof edge.id !== "string" ||
            !edge.id ||
            edge.id.length > 1024 ||
            edges.has(edge.id))
            fail("Invalid or duplicate edge ID", path);
        if (!nodes.has(edge.source) || !nodes.has(edge.target))
            fail(`Edge ${edge.id} references a node outside this flow`, path);
        edges.add(edge.id);
    }
}
function validate(content) {
    json(content, "package");
    record(content, "package");
    for (const key of Object.keys(content))
        if (!["agent", "evaluations", "cases", "suites"].includes(key))
            fail(`Unsupported field ${key}`);
    record(content.agent, "agent");
    record(content.agent.behavior, "agent.behavior");
    if (!Array.isArray(content.agent.behavior.edges))
        fail("Expected edges array");
    entities(content.agent.behavior.nodes, "nodes");
    validateGraph(content.agent.behavior, "agent.behavior");
    for (const key of ["evaluations", "cases", "suites"])
        entities(content[key], key);
    if (2 +
        content.agent.behavior.nodes.length +
        content.evaluations.length +
        content.cases.length +
        content.suites.length >
        exports.LIMITS.maxFiles)
        fail("Entity count limit exceeded");
    for (const suite of content.suites) {
        for (const key of ["cases", "evaluations"]) {
            if (!Array.isArray(suite[key]))
                fail(`Expected ${key} array`, suite.id);
            for (const entry of suite[key]) {
                const id = key === "evaluations" && entry && typeof entry === "object"
                    ? entry.id
                    : entry;
                if (!content[key].some((e) => e.id === id))
                    fail(`Unknown ${key} reference ${id}`, suite.id);
            }
        }
    }
    for (const scenario of content.cases) {
        if (scenario.evaluations === undefined)
            continue;
        if (!Array.isArray(scenario.evaluations))
            fail("Expected evaluations array", scenario.id);
        for (const entry of scenario.evaluations) {
            const id = entry && typeof entry === "object" ? entry.id : entry;
            if (!content.evaluations.some((evaluation) => evaluation.id === id))
                fail(`Unknown evaluations reference ${id}`, scenario.id);
        }
    }
    if (Buffer.byteLength(canonical(content)) > exports.LIMITS.maxBytes)
        fail("Package byte limit exceeded");
}
