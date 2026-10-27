"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCE_FILE = exports.validate = exports.safePath = exports.PackageError = exports.LIMITS = exports.contentHash = exports.canonical = void 0;
exports.assertSourceFormat = assertSourceFormat;
exports.decode = decode;
exports.encode = encode;
exports.managedPaths = managedPaths;
exports.patchFiles = patchFiles;
exports.inspect = inspect;
const core_js_1 = require("./core.js");
var core_js_2 = require("./core.js");
Object.defineProperty(exports, "canonical", { enumerable: true, get: function () { return core_js_2.canonical; } });
Object.defineProperty(exports, "contentHash", { enumerable: true, get: function () { return core_js_2.contentHash; } });
Object.defineProperty(exports, "LIMITS", { enumerable: true, get: function () { return core_js_2.LIMITS; } });
Object.defineProperty(exports, "PackageError", { enumerable: true, get: function () { return core_js_2.PackageError; } });
Object.defineProperty(exports, "safePath", { enumerable: true, get: function () { return core_js_2.safePath; } });
Object.defineProperty(exports, "validate", { enumerable: true, get: function () { return core_js_2.validate; } });
exports.SOURCE_FILE = "bland.json";
/** Discover before creating source: legacy and ambiguous trees are never adopted. */
function assertSourceFormat(names) {
    const paths = new Set(names), json = paths.has(exports.SOURCE_FILE);
    if (paths.has("bland.yaml") || paths.has("bland.yml"))
        throw new core_js_1.PackageError(json ? "AMBIGUOUS_SOURCE" : "FORMAT_MIGRATION_REQUIRED", json
            ? "Mixed JSON and legacy source is ambiguous; finish or recover the explicit migration"
            : "Legacy source requires explicit local migration: run bland-agent-project migrate");
    for (const path of paths)
        if (/^bland\.(json|ya?ml)$/i.test(path) &&
            ![exports.SOURCE_FILE, "bland.yaml", "bland.yml"].includes(path))
            throw new core_js_1.PackageError("PATH_COLLISION", "Source filename must use exact lowercase spelling", path);
    return json;
}
/** Bound nesting before JSON.parse allocates the tree; reject duplicate object keys. */
function parse(source, maxDepth) {
    const stack = [];
    try {
        for (let i = 0; i < source.length; i++) {
            const c = source[i];
            if (c === '"') {
                const start = i++;
                for (; i < source.length; i++) {
                    if (source[i] === "\\") {
                        i++;
                        continue;
                    }
                    if (source[i] === '"')
                        break;
                }
                let next = i + 1;
                while (next < source.length && /\s/.test(source[next]))
                    next++;
                const keys = stack[stack.length - 1];
                if (source[next] === ":" && keys) {
                    const key = JSON.parse(source.slice(start, i + 1));
                    if (keys.has(key))
                        (0, core_js_1.fail)("Duplicate JSON object key", exports.SOURCE_FILE);
                    keys.add(key);
                }
            }
            else if (c === "{" || c === "[") {
                stack.push(c === "{" ? new Set() : null);
                if (stack.length > maxDepth + 2)
                    (0, core_js_1.fail)("JSON depth limit exceeded", exports.SOURCE_FILE);
            }
            else if (c === "}" || c === "]")
                stack.pop();
        }
        return JSON.parse(source);
    }
    catch (error) {
        if (error instanceof core_js_1.PackageError)
            throw error;
        (0, core_js_1.fail)("Malformed JSON document", exports.SOURCE_FILE);
    }
}
function decode(files, limits = {}) {
    if (!assertSourceFormat(Object.keys(files)))
        (0, core_js_1.fail)("Missing authoritative source", exports.SOURCE_FILE);
    const cap = { ...core_js_1.LIMITS, ...limits }, source = files[exports.SOURCE_FILE];
    if (typeof source !== "string" ||
        Buffer.byteLength(source) > Math.min(cap.maxBytes, cap.maxFileBytes))
        (0, core_js_1.fail)("Source byte limit exceeded", exports.SOURCE_FILE);
    const value = parse(source, cap.maxDepth);
    (0, core_js_1.record)(value, exports.SOURCE_FILE);
    if (value.format !== 3)
        throw new core_js_1.PackageError("UNSUPPORTED_FORMAT", `Unsupported format ${value.format}; expected native JSON format 3`, exports.SOURCE_FILE);
    const { format: _format, ...content } = value;
    (0, core_js_1.validate)(content);
    return { content, paths: { format: 3, agent: exports.SOURCE_FILE } };
}
function encode(content, _previous) {
    (0, core_js_1.validate)(content);
    const source = JSON.stringify(JSON.parse((0, core_js_1.canonical)({ format: 3, ...content })), null, 2) + "\n";
    const files = { [exports.SOURCE_FILE]: source };
    decode(files);
    return files;
}
function managedPaths(files) {
    return assertSourceFormat(Object.keys(files)) ? [exports.SOURCE_FILE] : [];
}
function patchFiles(before, after) {
    const owned = managedPaths(before), next = managedPaths(after);
    const parsedBefore = owned.length ? decode(before).content : null;
    const parsedAfter = next.length ? decode(after).content : null;
    return {
        additions: parsedAfter &&
            (!parsedBefore ||
                (0, core_js_1.contentHash)(parsedBefore) !== (0, core_js_1.contentHash)(parsedAfter))
            ? [{ path: exports.SOURCE_FILE, contents: after[exports.SOURCE_FILE] }]
            : [],
        deletions: owned.length && !next.length ? [exports.SOURCE_FILE] : [],
    };
}
/** A prompt-free map into the native graph, never an alternate graph representation. */
function inspect(files, scope = "/") {
    const { content } = decode(files);
    let flow = content.agent.behavior, pointer = "/agent/behavior";
    if (scope !== "/")
        for (const id of scope.slice(1).split("/")) {
            const index = flow.nodes.findIndex((node) => node.id === id);
            const nested = index >= 0 ? flow.nodes[index].data?.flow : undefined;
            if (!scope.startsWith("/") || !nested)
                throw new core_js_1.PackageError("SCOPE_NOT_FOUND", "Choose / or a scoped scenario ID from the native graph", scope);
            flow = nested;
            pointer += `/nodes/${index}/data/flow`;
        }
    return {
        scope,
        graph: `${exports.SOURCE_FILE}#${pointer}`,
        nodes: flow.nodes.map((node, index) => {
            const data = node.data;
            return {
                id: node.id,
                address: `${scope === "/" ? "" : scope}/${node.id}`,
                path: `${exports.SOURCE_FILE}#${pointer}/nodes/${index}`,
                type: node.type,
                name: data?.name,
                ...(data?.flow
                    ? {
                        graph: `${exports.SOURCE_FILE}#${pointer}/nodes/${index}/data/flow`,
                    }
                    : {}),
            };
        }),
        edges: flow.edges,
    };
}
