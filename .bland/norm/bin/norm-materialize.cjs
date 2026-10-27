#!/usr/bin/env node
"use strict";

/**
 * Norm v2 — deterministic plan → snapshot builder.
 *
 * The mechanical half of a migration: the agent authors only JUDGMENT (a small
 * plan file — scenario membership, entries, hub prompt, system prompt) and
 * this script carries every byte of CONTENT from the v1 export(s) into a v2
 * agent snapshot: prompts, extraction variables, route rules (flat rows = OR,
 * isGroup = AND, fallbacks from source), transfers with warm-transfer config,
 * webhooks, code snippet pins, attached tools (including the automatic
 * re-representation of type:"code" node tools as code step + route step),
 * intra-scenario edges, and one exit edge per distinct label.
 *
 * Usage: norm-materialize.cjs --plan plan.json [--out snapshot.json]
 *
 * plan.json:
 * {
 *   "displayName": "...",
 *   "systemPrompt": "<full text — assembled verbatim from v1 sources>",
 *   "hubPrompt": "<hub routing prompt; a scenario directory is auto-appended>",
 *   "sources": [{"file": "v1-export.json", "prefix": "sa"}, ...],
 *   "persona": "persona.json",                    // optional; its call_config voice + language carry into settings
 *   "voice": "<voice id>", "language": "<code>",  // optional; override the persona's (e.g. from the number a pathway answers on)
 *   "entryScenario": "<scenario name>",           // exception: inbound re-point for connection gating (screener / IVR / voicemail / availability); needs entryScenarioReason; no Knowledge Base / Transfer Call members
 *   "entryScenarioReason": "<≥60 chars: why initialization + hub cannot open this call>",
 *   "initializationNode": "<legacy id — which isStart Custom Code runs at connect when merged sources have several>",
 *   "scenarios": [{"name","entry":{"label","description"},"rule","members":[ids or unique id prefixes],
 *                  "entryMember": "<id — the step calls START at; defaults to members[0]>"}],
 *   "endCalls": [{"name","entry":{"label","description"},"prompt"}],  // optional: hub-level
 *                  hang-ups only (e.g. the caller asks to end the call). A v1 End Call becomes an
 *                  end-call step inside its scenario's flow, so most migrations need none.
 *
 *   // Evidence-based hardening hooks (ship EMPTY on the first build; add only
 *   // when a sim failure's engine trace proves the need — see the migration
 *   // skill's hardening doctrine):
 *   "promptAppends":   { "<legacy node id>": "\n\n## Hard rule — ..." },
 *   "variableAppends": { "<legacy node id>": { "<variable key>": " HARD RULE: ..." } },
 *   "silentPills":     [ "<legacy node id>" ]
 * }
 * entry.description may be "@persona:<condition name>" to pull the persona
 * pathway_condition prompt verbatim.
 *
 * silentPills: the construct fix for a v1 silent-router node that fabricates
 * speech as an in-flow v2 step (observed: invented phone numbers resistant to
 * prompt rules). Sets static "." speech so there is nothing to fabricate;
 * extraction still runs from the step's variable descriptions (put the rules
 * THERE via variableAppends) and routing rides the verbatim edge labels — the
 * one intentional non-verbatim carry, so document it in the report.
 */

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { unreachableBehindEmptyGroups } = require("./norm-migrate-audit.cjs");

const args = process.argv.slice(2);
function flag(name) {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
}
const planPath = flag("plan");
const outPath = flag("out") || "snapshot.json";
if (!planPath) {
	process.stderr.write("--plan required\n");
	process.exit(1);
}

const warnings = [];
function warn(msg) {
	warnings.push(msg);
}
function loadJson(p) {
	const raw = JSON.parse(fs.readFileSync(p, "utf8"));
	return raw && raw.data && typeof raw.data === "object" && (raw.data.nodes || raw.data.personality_prompt) ? raw.data : raw;
}
function str(v) {
	return typeof v === "string" ? v : "";
}

// ── load plan + sources, namespace + merge ──────────────────────────────────
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const planDir = path.dirname(path.resolve(planPath));
const rel = (p) => (path.isAbsolute(p) ? p : path.join(planDir, p));

let mergedNodes = [];
let mergedEdges = [];
const globalPrompts = [];
for (const src of plan.sources || []) {
	const g = loadJson(rel(src.file));
	const real = (g.nodes || []).filter((n) => {
		if (!n || !n.id) return false;
		if (n.globalConfig && n.globalConfig.globalPrompt) {
			globalPrompts.push({ file: src.file, prompt: n.globalConfig.globalPrompt });
		}
		return n.type !== undefined || Boolean((n.data || {}).name) || Boolean((n.data || {}).prompt) || Boolean((n.data || {}).text);
	});
	let text = JSON.stringify({ nodes: real, edges: g.edges || [] });
	if (src.prefix) {
		for (const n of real) {
			text = text.split(`"${n.id}"`).join(`"${src.prefix}-${n.id}"`);
		}
	}
	const ns = JSON.parse(text);
	const idSet = new Set(ns.nodes.map((n) => n.id));
	mergedNodes.push(...ns.nodes);
	mergedEdges.push(...ns.edges.filter((e) => idSet.has(e.source) && idSet.has(e.target)));
}
const persona = plan.persona ? loadJson(rel(plan.persona)) : null;

// ── normalize helpers ───────────────────────────────────────────────────────
function normalizeRpRow(row) {
	// v1 carries response pathways as tuples [variable, operator, value, {id,name}]
	// or objects {variable, condition, value, targetId, targetName}.
	if (Array.isArray(row)) {
		return { variable: str(row[0]), operator: str(row[1]), value: str(row[2]), targetId: str((row[3] || {}).id), targetName: str((row[3] || {}).name) };
	}
	const r = row || {};
	return { variable: str(r.variable), operator: str(r.condition ?? r.operator), value: str(r.value), targetId: str(r.targetId), targetName: str(r.targetName) };
}
// Platform ScenarioVariable requires `type` + `accurateSpelling` — rows
// without them crash the compiler at chat-session creation (found live by the
// first agentic E2E run). Carry the v1 tuple's type through, normalized onto
// the v2 vocabulary.
function varType(raw) {
	const t = str(raw).toLowerCase();
	if (t === "number" || t === "integer" || t === "int" || t === "float") return "number";
	if (t === "boolean" || t === "bool") return "boolean";
	if (t === "json" || t === "object" || t === "array") return "json";
	return "string";
}
function varRows(extractVars, captureKinds) {
	// tuples [name, type, description] or objects {name, type?, description}.
	// A v1 node's captureKinds ({variable: target}) carry as each row's
	// captureAs: capture reads those values back and confirms them at run time.
	const kinds = captureKinds && typeof captureKinds === "object" ? captureKinds : {};
	return (extractVars || []).map((r) => {
		const row = Array.isArray(r)
			? { id: randomUUID(), key: str(r[0]), value: str(r[2]), type: varType(r[1]), accurateSpelling: false }
			: { id: randomUUID(), key: str((r || {}).name), value: str((r || {}).description), type: varType((r || {}).type), accurateSpelling: false };
		const target = str(kinds[row.key]);
		return target ? { ...row, captureAs: target } : row;
	});
}
function dictRows(obj) {
	return Object.entries(obj || {}).map(([key, value]) => ({ id: randomUUID(), key, value: String(value) }));
}
function stepSettings(d) {
	const mo = (d || {}).modelOptions || {};
	return {
		tag: null,
		media: [],
		global: { isGlobal: false, label: "", description: "", returnMode: "previous", forwardingNode: "" },
		advanced: {
			temperature: typeof mo.temperature === "number" ? mo.temperature : 0.2,
			interruptionThreshold: typeof mo.interruptionThreshold === "number" ? mo.interruptionThreshold : null,
			skipUserResponse: mo.skipUserResponse === true,
			blockInterruptions: mo.block_interruptions === true || mo.blockInterruptions === true,
			interruptibility: null,
			disableRecording: false,
			disableLogging: false,
			backgroundTrack: "",
		},
	};
}
function promptOrText(d) {
	if (str(d.prompt)) return { prompt: d.prompt, useStaticText: false };
	return { prompt: str(d.text), useStaticText: Boolean(str(d.text)) };
}
function mapRouteOperator(op) {
	if (op === "==") return "is";
	if (op === "!=") return "is not";
	return op || "is";
}

// ── automatic code-tool surgery (type:"code" node tools) ────────────────────
// End Calls that carry a code tool. An end-call step hangs up after its line
// and has no code-tool form, so these keep the wrap-up mapping: a prompt step,
// then the code step, then the flow's exit to the hub, which ends the call
// from a root end-call. Every route into the node and its own extraction work
// as on any prompt step, so the snippet still runs, and runs after extraction.
const wrapUpEndCalls = new Set();
for (const node of [...mergedNodes]) {
	const d = node.data || {};
	const tools = d.tools;
	if (!Array.isArray(tools)) continue;
	const idx = tools.findIndex((t) => t && t.type === "code" && (t.config || {}).snippet_id);
	if (idx < 0) continue;
	const tool = tools[idx];
	const cfg = tool.config;
	const rps = (cfg.responsePathways || []).map(normalizeRpRow);
	if (rps.length === 0) {
		warn(`code tool ${tool.name} on ${d.name}: no responsePathways — carried as code step with no route`);
	}
	tools.splice(idx, 1);
	if (tools.length === 0) delete d.tools;
	const inputKeys = new Set();
	for (const r of varRows(d.extractVars)) inputKeys.add(r.key);
	for (const m of cfg.response_data || []) if (m && m.name) inputKeys.add(m.name);
	const codeId = `${node.id}__codetool`;
	const routeId = `${node.id}__codetool_route`;
	if (node.type === "End Call") {
		wrapUpEndCalls.add(node.id);
		warn(`End Call "${d.name}" has code tool "${tool.name}": kept as a wrap-up step that returns to the hub so the snippet runs — the hub needs a root end-call to hang up after it`);
	}
	mergedNodes.push({
		id: codeId,
		type: "Custom Code",
		position: { x: 0, y: 0 },
		data: {
			name: str(tool.name) || "code tool",
			active: true,
			snippet_id: cfg.snippet_id,
			...(typeof cfg.snippet_version === "number" ? { snippet_version: cfg.snippet_version } : {}),
			snippet_variables: Object.fromEntries([...inputKeys].map((k) => [k, `{{${k}}}`])),
		},
	});
	if (rps.length > 0) {
		mergedNodes.push({
			id: routeId,
			type: "Route",
			position: { x: 0, y: 0 },
			data: {
				name: `${str(tool.name) || "code tool"} route`,
				routes: rps.map((r) => ({
					conditions: [{ field: r.variable, value: r.value, operator: mapRouteOperator(r.operator) }],
					targetNodeId: r.targetId,
				})),
				fallbackNodeId: rps[0].targetId,
			},
		});
		const successTargets = new Set(rps.map((r) => r.targetId));
		for (const e of mergedEdges) {
			if (e.source === node.id && successTargets.has(e.target)) e.target = codeId;
		}
		mergedEdges.push(
			{ source: codeId, target: routeId, data: { label: `${tool.name} computed`, alwaysPick: true } },
			...[...successTargets].map((t) => ({ source: routeId, target: t, data: { label: "Route" } })),
		);
	} else {
		for (const e of mergedEdges) {
			if (e.source === node.id) e.source = codeId;
		}
		mergedEdges.push({ source: node.id, target: codeId, data: { label: `${tool.name}`, alwaysPick: true } });
	}
	warn(`re-represented code tool "${tool.name}" on "${d.name}" as code step + route (snippet ${cfg.snippet_id} v${cfg.snippet_version}); review the snippet input map (${[...inputKeys].join(", ")})`);
}

const nodeById = new Map(mergedNodes.map((n) => [n.id, n]));
const allIds = [...nodeById.keys()];
function resolveMember(idOrPrefix) {
	if (nodeById.has(idOrPrefix)) return idOrPrefix;
	// synthesized surgery nodes (…__codetool*) are auto-inserted after their
	// host and are never addressed directly by the plan
	const hits = allIds.filter((id) => id.startsWith(idOrPrefix) && !id.includes("__codetool"));
	if (hits.length !== 1) throw new Error(`member "${idOrPrefix}": ${hits.length} matches`);
	return hits[0];
}

// ── attached custom_tool inversion (non-code tools ride on prompt steps) ────
// A v1 tool that names a saved library tool and embeds nothing runs that
// tool's latest version on every call. Carry it the same way: byReference +
// toolId (+ the node's tool_overrides), with a display-only definition. The
// runtime runs any embedded definition as-is and fetches by id only when none
// is embedded, so a stand-in definition here would run an empty tool.
function plainObject(v) {
	return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0 ? v : null;
}
function invertAttachedTools(tools) {
	return (tools || []).map((t) => {
		const cfg = t.config || {};
		const name = str(t.name) || "Tool";
		const toolId = str(cfg.tool_id || (cfg.tool || {}).tool_id);
		const embedded = (cfg.tool || {}).tool;
		const byReference = t.type !== "track" && !embedded && toolId !== "";
		const toolOverrides = byReference ? plainObject(cfg.tool_overrides) : null;
		if (byReference && plainObject((cfg.tool || {}).overrides)) {
			warn(`tool "${name}": wrapper overrides on a library tool never ran in v1 (only the node's tool_overrides apply to a fetched tool), so they were not carried`);
		}
		if (!embedded && !toolId) {
			warn(`tool "${name}": no library id and no embedded definition, so it was carried as an empty placeholder that runs nothing; rebuild it or drop it`);
		}
		return {
			id: randomUUID(),
			name,
			description: str(t.description),
			behavior: t.behavior === "feed_context_and_route" ? "feed_context_and_route" : "feed_context",
			toolId,
			...(byReference ? { byReference: true } : {}),
			...(toolOverrides ? { toolOverrides: { ...toolOverrides } } : {}),
			definition: embedded || (byReference ? { name, description: str(t.description) } : { name, integration: "rest_api", action: "get" }),
			isStaging: cfg.is_staging === true,
			excludeResponseFromHistory: cfg.excludeResponseFromHistory === true,
			retryLimit: typeof cfg.retryLimit === "number" ? cfg.retryLimit : 0,
			// Snapshot field skew: label = trigger variable, variable = operator,
			// condition = compared value.
			responsePathways: (cfg.responsePathways || []).map(normalizeRpRow).map((r) => ({
				id: randomUUID(),
				label: r.variable,
				variable: r.operator,
				condition: r.value,
				targetId: r.targetId,
				targetName: r.targetName,
			})),
			toolType: "custom_tool",
		};
	});
}

// ── legacy node → flow step ─────────────────────────────────────────────────
function toStep(node) {
	const d = node.data || {};
	const base = { id: randomUUID(), position: node.position || { x: 0, y: 0 } };
	switch (node.type) {
		case "End Call": {
			if (wrapUpEndCalls.has(node.id)) {
				return {
					...base,
					type: "prompt",
					data: {
						name: str(d.name),
						...promptOrText(d),
						loopWhile: str(d.condition),
						variables: varRows(d.extractVars, d.captureKinds),
						ignorePreviousExtractions: false,
						useAudioExtraction: false,
						settings: stepSettings(d),
						...(Array.isArray(d.tools) && d.tools.length > 0 ? { tools: invertAttachedTools(d.tools) } : {}),
					},
				};
			}
			// An End call step in the same flow, as the parity import builds it:
			// it says its line and hangs up (barge-in ignored), with no hub
			// turn. Edges into it carry over as the flow's routes. One with
			// nothing to say speaks a static "." so the call still ends.
			const speech = promptOrText(d);
			const settings = stepSettings(d);
			if (settings.global.isGlobal && settings.global.returnMode === "previous") settings.global.returnMode = "manual";
			return {
				...base,
				type: "end-call",
				data: {
					name: str(d.name),
					...(speech.prompt.trim() ? speech : { prompt: ".", useStaticText: true }),
					entry: { mode: "llm", label: "", description: "", alwaysPick: false, conditions: [] },
					loopWhile: str(d.condition),
					variables: varRows(d.extractVars, d.captureKinds),
					ignorePreviousExtractions: false,
					useAudioExtraction: false,
					settings,
					// Attached tools stay on the End Call, as on a prompt step, so
					// they can still run during its turn before the hang-up.
					...(Array.isArray(d.tools) && d.tools.length > 0 ? { tools: invertAttachedTools(d.tools) } : {}),
				},
			};
		}
		case "Default":
			return {
				...base,
				type: "prompt",
				data: {
					name: str(d.name),
					...promptOrText(d),
					loopWhile: str(d.condition),
					variables: varRows(d.extractVars, d.captureKinds),
					ignorePreviousExtractions: false,
					useAudioExtraction: false,
					settings: stepSettings(d),
					...(Array.isArray(d.tools) && d.tools.length > 0 ? { tools: invertAttachedTools(d.tools) } : {}),
				},
			};
		case "Custom Code":
			return {
				...base,
				type: "customCode",
				data: {
					name: str(d.name),
					code: str(d.code),
					...(str(d.snippet_id)
						? {
								snippetId: d.snippet_id,
								...(typeof d.snippet_version === "number" ? { snippetVersion: d.snippet_version } : {}),
							}
						: {}),
					variables: dictRows(d.snippet_variables),
					settings: stepSettings(d),
				},
			};
		case "Route": {
			const rules = [];
			let fallbackNodeId = str(d.fallbackNodeId);
			// Rules run in order, first match wins. An empty isGroup block is
			// always true in v1, so its route is taken whenever it is reached:
			// its target becomes the fallback and everything after it, which
			// v1 never reaches, is dropped. Steps only those rules led to are
			// dropped from the flow too (droppedUnreachable below).
			routes: for (const route of d.routes || []) {
				const rows = Array.isArray(route.conditions) ? route.conditions : [];
				for (const row of rows) {
					if (row && row.isGroup === true && Array.isArray(row.conditions) && row.conditions.length === 0) {
						fallbackNodeId = str(route.targetNodeId);
						warn(`route "${str(d.name)}": an empty condition group is always true in v1, so its target is the fallback and the rules after it were dropped (v1 never reaches them)`);
						break routes;
					}
					if (row && row.isGroup === true && Array.isArray(row.conditions)) {
						rules.push({
							id: randomUUID(),
							targetNodeId: str(route.targetNodeId),
							conditions: row.conditions.map((c) => ({ id: randomUUID(), field: str(c.field), operator: str(c.operator) || "is", value: str(c.value) })),
						});
					} else {
						rules.push({
							id: randomUUID(),
							targetNodeId: str(route.targetNodeId),
							conditions: [{ id: randomUUID(), field: str(row.field), operator: str(row.operator) || "is", value: str(row.value) }],
						});
					}
				}
			}
			return {
				...base,
				type: "route",
				data: {
					name: str(d.name),
					rules,
					...(fallbackNodeId ? { fallbackNodeId } : {}),
					settings: stepSettings(d),
				},
			};
		}
		case "Transfer Call": {
			const wt = d.warmTransferFields || {};
			return {
				...base,
				type: "transfer",
				data: {
					name: str(d.name),
					prompt: str(d.text || d.prompt),
					useStaticText: false,
					loopWhile: str(d.condition),
					ignorePreviousExtractions: false,
					useAudioExtraction: false,
					transferNumber: str(d.transferNumber),
					transferType: "phone",
					transferExtension: str(d.transferExtension),
					warmTransfer: {
						enabled: wt.isEnabled === true,
						agentPrompt: str(wt.agentPrompt),
						mergePrompt: str(wt.mergeCallPrompt || wt.mergePrompt),
						fromNumber: str(wt.fromNumber),
						// Native v2 values drive the compiled enable flags. Do not
						// activate a stale URL/message whose v1 switch was off.
						holdMusicUrl: wt.useCustomHoldMusic === true ? str(wt.holdMusicUrl) : "",
						optimizeForIVR: wt.optimizeForIVR !== false,
						agentPromptStatic: wt.isAgentPromptStatic === true,
						mergePromptStatic: wt.isMergeCallPromptStatic === true,
						// v1 stores the warm-transfer timeout as a numeric STRING ("600"); a
						// strict number test silently dropped it (JCB, 2026-10-07).
						timeout: wt.useTimeout === true && Number.isFinite(Number(wt.timeout)) && String(wt.timeout).trim() !== "" ? Number(wt.timeout) : null,
						voicemailMessage: wt.useVoicemailMessage === true && wt.voicemailResponseType !== "pathway" ? str(wt.voicemailMessage) : "",
						...(str(wt.dtmfSequence) ? { dtmfSequence: wt.dtmfSequence } : {}),
						...(typeof wt.allowMergeControl === "boolean" ? { allowMergeControl: wt.allowMergeControl } : {}),
						...(wt.retry ? { retry: wt.retry } : {}),
					},
					variables: varRows(d.extractVars, d.captureKinds),
					settings: stepSettings(d),
				},
			};
		}
		case "Webhook":
			return {
				...base,
				type: "webhook",
				data: {
					name: str(d.name),
					url: str(d.url),
					method: str(d.method) || "POST",
					// v1 carries headers as [key, value] tuples (or objects); the
					// snapshot dialect wants key/value rows.
					headers: (d.headers || []).map((h) =>
						Array.isArray(h)
							? { id: randomUUID(), key: str(h[0]), value: str(h[1]) }
							: { id: randomUUID(), key: str((h || {}).key || (h || {}).name), value: str((h || {}).value) },
					),
					body: d.body ?? "",
					timeoutSeconds: typeof d.timeoutValue === "number" ? d.timeoutValue : 10,
					maxRetries: typeof d.max_retries === "number" ? d.max_retries : 0,
					responsePathways: (d.responsePathways || []).map(normalizeRpRow).map((r) => ({
						id: randomUUID(),
						label: "",
						variable: r.variable,
						operator: r.operator,
						value: r.value,
						targetNodeId: r.targetId,
					})),
					// v1 response_data rows are {name, data: "$.path"}; the snapshot
					// dialect wants responseData rows {name, path}.
					...(Array.isArray(d.response_data) && d.response_data.length > 0
						? {
								responseData: d.response_data.map((r) => ({
									id: randomUUID(),
									name: str((r || {}).name),
									path: str((r || {}).data ?? (r || {}).path),
								})),
							}
						: {}),
					settings: stepSettings(d),
				},
			};
		case "Custom Tool": {
			const toolObj = d.tool || {};
			const toolId = str(toolObj.tool_id || d.tool_id || ((JSON.stringify(d).match(/TL-[0-9a-f-]{8,}/) || [])[0]));
			return {
				...base,
				type: "tool",
				data: {
					name: str(d.name),
					toolId,
					isStaging: d.is_staging === true,
					overrides: dictRows(d.tool_overrides),
					responsePathways: (d.responsePathways || []).map(normalizeRpRow).map((r) => ({
						id: randomUUID(),
						label: "",
						variable: r.variable,
						operator: r.operator,
						value: r.value,
						targetNodeId: r.targetId,
					})),
					settings: stepSettings(d),
				},
			};
		}
		case "SMS":
			return { ...base, type: "sms", data: { name: str(d.name), message: str(d.message || d.text), fromNumber: str(d.fromNumber), settings: stepSettings(d) } };
		case "Knowledge Base":
			return { ...base, type: "knowledge", data: { name: str(d.name), kbIds: d.kbIds || d.kb_ids || [], settings: stepSettings(d) } };
		default:
			throw new Error(`unsupported legacy node type "${node.type}" (${node.id}) — handle it in the plan (drop with reason, or extend the builder)`);
	}
}

// ── build scenarios ─────────────────────────────────────────────────────────
// A v2 deterministic edge row is {field, operator: AND|OR (join to the previous
// row), conditionOperator: the comparison, value}. v1 edges come in two
// dialects. Rows that join with AND/OR (or carry no comparison in `operator`)
// are already that shape. Rows with the comparison in `operator` are the
// variable-comparison dialect: flat rows are ORed, an isGroup block ANDs its
// rows, and a few comparisons have no exact v2 spelling. Returns one edge data
// per branch; several branches become parallel edges to the same step.
function edgeValue(v) {
	return typeof v === "string" ? v : v === undefined ? "" : String(v);
}
function v2Comparison(op, rawValue, notes) {
	const value = edgeValue(rawValue);
	if ((op === "equals" || op === "not equals" || op === "equals exact" || op === "not equals exact") && rawValue === null) {
		return { conditionOperator: "is", value: op.startsWith("not ") ? "not null" : "null" };
	}
	if (op === "equals exact") return { conditionOperator: "equals", value };
	if (op === "not equals exact") return { conditionOperator: "not equals", value };
	if (op === "is") {
		const v = value.trim().toLowerCase();
		if (v === "defined") return { conditionOperator: "is", value: "not undefined" };
		if (v === "empty" || v === "not empty") {
			notes.push(`"is ${v}" became "is ${v === "empty" ? "null" : "not null"}"`);
			return { conditionOperator: "is", value: v === "empty" ? "null" : "not null" };
		}
		return { conditionOperator: "is", value: v };
	}
	if (op === "equals" || op === "not equals" || op === "contains" || op === "does not contain") notes.push(`"${op}" is case-sensitive in v2`);
	return { conditionOperator: op, value };
}
// Always-true deterministic rows, for a v1 edge that always matches.
const ALWAYS_TRUE_FIELD = "v1_empty_group";
function alwaysTrueRows() {
	return [
		{ id: randomUUID(), field: ALWAYS_TRUE_FIELD, operator: "AND", conditionOperator: "is", value: "undefined" },
		{ id: randomUUID(), field: ALWAYS_TRUE_FIELD, operator: "OR", conditionOperator: "is", value: "not undefined" },
	];
}
function edgeData(e) {
	const d = e.data || {};
	const rows = (Array.isArray(d.condition) ? d.condition : []).filter((r) => r && typeof r === "object");
	if (rows.length === 0) {
		return [{ mode: "llm", label: str(d.label), description: str(d.description), alwaysPick: d.alwaysPick === true, conditions: [] }];
	}
	const deterministic = (conditions) => ({ mode: "deterministic", label: str(d.label), description: "", alwaysPick: d.alwaysPick === true, conditions });
	const joined = rows.some((r) => r.operator === "AND" || r.operator === "OR");
	const comparisonDialect = !joined && rows.some((r) => r.isGroup === true || str(r.operator) !== "");
	if (!comparisonDialect) {
		return [
			deterministic(
				rows.map((r) => ({ id: randomUUID(), field: str(r.field), operator: r.operator === "OR" ? "OR" : "AND", conditionOperator: str(r.conditionOperator) || "equals", value: edgeValue(r.value) })),
			),
		];
	}
	// An empty isGroup block is always true in v1 (an AND over no rows), and the
	// rows are ORed, so the whole edge always matches. A v2 deterministic edge
	// with no rows never matches, so carry it as a pair of rows that is always
	// true: a field that is undefined OR not undefined.
	if (rows.some((r) => r.isGroup === true && Array.isArray(r.conditions) && r.conditions.length === 0)) {
		warn(`edge "${str(d.label)}": an empty condition group is always true in v1, so this edge always matches; carried as "${ALWAYS_TRUE_FIELD} is undefined OR is not undefined"`);
		return [deterministic(alwaysTrueRows())];
	}
	const notes = [];
	const toRow = (r, join, i) => ({ id: randomUUID(), field: str(r.field), operator: i === 0 ? "AND" : join, ...v2Comparison(str(r.operator), r.value, notes) });
	const orRows = [];
	const groups = [];
	for (const r of rows) {
		if (r.isGroup !== true) orRows.push(r);
		else {
			const inner = (Array.isArray(r.conditions) ? r.conditions : []).filter((x) => x && typeof x === "object");
			if (inner.length === 0) notes.push("a malformed condition group (no condition list) was dropped");
			else if (inner.length === 1) orRows.push(inner[0]);
			else groups.push(inner);
		}
	}
	const branches = [...(orRows.length ? [orRows.map((r, i) => toRow(r, "OR", i))] : []), ...groups.map((g) => g.map((r, i) => toRow(r, "AND", i)))];
	if (branches.length > 1) notes.push(`${branches.length} ORed condition blocks became parallel edges to the same step`);
	if (notes.length) warn(`edge "${str(d.label)}": conditions were rewritten for v2: ${[...new Set(notes)].join("; ")}`);
	return branches.map(deterministic);
}

function personaCondition(name) {
	const c = ((persona || {}).pathway_conditions || []).find((x) => x.name === name);
	if (!c) throw new Error(`@persona:${name} — no such pathway_condition`);
	return c.prompt;
}

const seenMembers = new Map();
// ── Start = the Initialization code step ────────────────────────────────────
// A v1 pathway whose start node is Custom Code runs that code before anyone
// speaks. In v2 that is `initialization` (agent-scoped, on the start edge),
// not a scenario step — it fires at connect, the hub speaks next. Carry it
// there, and refuse a plan that also files it into a scenario.
const startCodeNodes = mergedNodes.filter((n) => n && n.type === "Custom Code" && n.data && n.data.isStart === true);
// Merged sources can each start with code; only one can run at connect. The
// plan picks it with "initializationNode" (id or unique prefix); the other
// start code nodes stay ordinary members of their scenarios.
let startCodeNode = startCodeNodes[0] || null;
if (plan.initializationNode) {
	const chosen = resolveMember(plan.initializationNode);
	startCodeNode = nodeById.get(chosen) || null;
	if (!startCodeNode || startCodeNode.type !== "Custom Code") throw new Error(`initializationNode "${plan.initializationNode}" is not a Custom Code node`);
} else if (startCodeNodes.length > 1) {
	throw new Error(`${startCodeNodes.length} source pathways start with Custom Code (${startCodeNodes.map((n) => n.id).join(", ")}) — set plan.initializationNode to the one that runs at connect; the others stay scenario members`);
}
let initialization = null;
if (startCodeNode) {
	const { id: _id, position: _pos, type: _type, data } = toStep(startCodeNode);
	initialization = { enabled: true, step: data };
	warnings.push(`Start node "${str(startCodeNode.data.name) || startCodeNode.id}" (Custom Code) carried as initialization (runs at connect, before the first sentence); its outgoing edge(s) are the hub's to route`);
}
// Nodes v1 never reaches: a route's empty condition group is always true, so
// the rules after it (and its old fallback) never fire, and a node only they
// led to is dead in v1 as well. Those nodes are dropped, not carried as steps
// nothing routes to, and the report lists each with its reason; the audit
// derives the same set from the source and accepts the drop. A scenario's
// entry step stays (the hub can enter it).
const scenarioEntries = (plan.scenarios || []).flatMap((sc) => (sc.entryMember || (sc.members || [])[0] ? [resolveMember(sc.entryMember || sc.members[0])] : []));
const deadInV1 = unreachableBehindEmptyGroups(mergedNodes, mergedEdges, [...scenarioEntries, ...(startCodeNode ? [startCodeNode.id] : [])]);
const droppedUnreachable = [...deadInV1].map(([id, routeName]) => ({
	node: id,
	name: str((nodeById.get(id).data || {}).name),
	reason: `unreachable in v1: route "${routeName}" has an always-true empty condition group before every way into this node`,
}));
for (const row of droppedUnreachable) warn(`dropped "${row.name || row.node}" (${row.node}): ${row.reason}`);

const scenarioNodes = [];
const consumedHooks = new Set();
for (const sc of plan.scenarios || []) {
	// members: resolve prefixes; auto-insert surgery nodes right after their host
	let members = [];
	for (const m of sc.members) {
		const id = resolveMember(m);
		members.push(id);
		for (const suffix of ["__codetool", "__codetool_route"]) {
			if (nodeById.has(id + suffix)) members.push(id + suffix);
		}
	}
	for (const id of members) {
		if (startCodeNode && id === startCodeNode.id) throw new Error(`"${sc.name}" lists the Start code node ${id} as a member — it is carried as initialization automatically; remove it from members`);
		if (seenMembers.has(id)) throw new Error(`${id} in both "${seenMembers.get(id)}" and "${sc.name}"`);
		seenMembers.set(id, sc.name);
	}
	members = members.filter((id) => !deadInV1.has(id));
	const memberSet = new Set(members);
	// Start is the Initialization code step, not a scenario. Re-pointing the
	// inbound edge at a scenario is the exception for CONNECTION gating — call
	// screeners, IVR / menu navigation, voicemail detection and the voicemail
	// message, carrier intercepts, availability checks — and needs a written
	// reason in the plan. Such a scenario may speak for that purpose, but the
	// call body (knowledge answers, scheduling, verification, pathway
	// transfers, caller-chosen outcomes) is a hub child; a Start holding it
	// is the "whole call hanging off Start" shape — refuse to build it. The
	// step budget and the exit to the hub are audited (A1).
	if (plan.entryScenario && sc.name === plan.entryScenario) {
		const reason = str(plan.entryScenarioReason);
		if (reason.length < 60) {
			throw new Error(`entryScenario "${sc.name}": Start is the Initialization code step, not a scenario. Re-pointing the inbound edge needs plan.entryScenarioReason (≥60 chars) naming the connection gating it does (screener / IVR / voicemail / availability) — or drop entryScenario and let the hub open the call`);
		}
		const CORE_LOGIC_LEGACY = new Set(["Knowledge Base", "Transfer Call"]);
		const core = members.map((id) => nodeById.get(id)).filter((n) => n && CORE_LOGIC_LEGACY.has(n.type));
		if (core.length) {
			throw new Error(`entryScenario "${sc.name}" holds call-body node(s): ${core.map((n) => `${str((n.data || {}).name) || n.id} (${n.type})`).join(", ")}. Start handles connection gating only (screener / IVR / voicemail / availability); knowledge answers, transfers and every caller-chosen outcome are hub children`);
		}
	}
	const startPill = { id: randomUUID(), type: "start", position: { x: 0, y: 0 }, data: {} };
	const endPill = { id: randomUUID(), type: "end", position: { x: 0, y: 0 }, data: {} };
	const steps = members.map((id) => toStep(nodeById.get(id)));
	const newIdByLegacy = new Map(members.map((id, i) => [id, steps[i].id]));

	// remap intra-flow references
	for (const step of steps) {
		const d = step.data;
		if (step.type === "route") {
			for (const r of d.rules) {
				r.targetNodeId = newIdByLegacy.get(r.targetNodeId) || endPill.id;
			}
			if (d.fallbackNodeId) d.fallbackNodeId = newIdByLegacy.get(d.fallbackNodeId) || endPill.id;
		}
		for (const rp of d.responsePathways || []) {
			if (rp.targetNodeId !== undefined) rp.targetNodeId = newIdByLegacy.get(rp.targetNodeId) || (rp.targetNodeId ? endPill.id : "");
		}
		for (const t of d.tools || []) {
			for (const rp of t.responsePathways) {
				if (rp.targetId) {
					const mapped = newIdByLegacy.get(rp.targetId);
					if (mapped) {
						rp.targetId = mapped;
					} else {
						warn(`${sc.name}/${d.name}: tool rp target "${rp.targetName}" is cross-scenario — cleared (hub handles the hand-off)`);
						rp.targetId = "";
						rp.targetName = "";
					}
				}
			}
		}
	}

	// flow edges
	const flowEdges = [];
	const seenPairs = new Set();
	const exits = new Map(); // legacy source id -> [{label, description}]
	for (const e of mergedEdges) {
		if (!memberSet.has(e.source)) continue;
		if (memberSet.has(e.target)) {
			// Parallel edges with DIFFERENT labels are real routing alternatives in
			// v1 — dedup only true duplicates (same endpoints AND same label).
			const key = `${e.source}->${e.target}::${str((e.data || {}).label)}`;
			if (seenPairs.has(key)) continue;
			seenPairs.add(key);
			for (const data of edgeData(e)) {
				flowEdges.push({ id: randomUUID(), type: "pathway", source: newIdByLegacy.get(e.source), target: newIdByLegacy.get(e.target), data });
			}
		} else {
			const label = str((e.data || {}).label);
			const rows = exits.get(e.source) || [];
			if (label && !rows.some((r) => r.label === label)) {
				rows.push({ label, description: str((e.data || {}).description) });
			}
			exits.set(e.source, rows);
		}
	}
	for (const id of members) {
		const t = nodeById.get(id).type;
		if ((t === "Transfer Call" || wrapUpEndCalls.has(id)) && !exits.has(id) && !mergedEdges.some((e) => e.source === id && memberSet.has(e.target))) {
			exits.set(id, [{ label: "done", description: "" }]);
		}
	}
	// The start pill must point at the scenario's ENTRY step or the flow
	// compiles with an empty entryNodeId and is unenterable (found live by the
	// first agentic E2E run: the hub answered every lane itself). The entry is
	// plan.entryMember when set, else members[0] — and a members[0] default
	// that has an inbound edge from another member is probably a mis-ordered
	// list, so say so.
	if (steps.length > 0) {
		let entryLegacy = members[0];
		if (sc.entryMember) {
			entryLegacy = resolveMember(sc.entryMember);
			if (!memberSet.has(entryLegacy)) throw new Error(`${sc.name}: entryMember "${sc.entryMember}" is not a member of this scenario`);
		} else if (mergedEdges.some((e) => e.target === entryLegacy && memberSet.has(e.source))) {
			warn(`${sc.name}: members[0] ("${entryLegacy}") has an inbound edge from another member — if it is not the entry step, set "entryMember"`);
		}
		flowEdges.unshift({
			id: randomUUID(),
			type: "pathway",
			source: startPill.id,
			target: newIdByLegacy.get(entryLegacy),
			data: { mode: "llm", label: "", description: "", alwaysPick: false, conditions: [] },
		});
	}
	for (const [legacyId, rows] of exits) {
		for (const row of rows) {
			flowEdges.push({
				id: randomUUID(),
				type: "pathway",
				source: newIdByLegacy.get(legacyId),
				target: endPill.id,
				data: { mode: "llm", label: row.label, description: row.description, alwaysPick: false, conditions: [] },
			});
		}
	}

	// ── hardening hooks (evidence-based; empty on a first build) ──
	// Hook keys resolve exactly like plan members (exact id or unique prefix),
	// and every hook is CONSUMED-tracked at the end of the scenario loop — a
	// hook that matches no member anywhere in the plan is a hard error, never
	// a silent no-op.
	const hookIndex = (idOrPrefix) => {
		let resolved;
		try { resolved = resolveMember(idOrPrefix); } catch { return -1; }
		return members.indexOf(resolved);
	};
	for (const [legacyId, appendText] of Object.entries(plan.promptAppends || {})) {
		const i = hookIndex(legacyId);
		if (i < 0) continue;
		consumedHooks.add(`prompt:${legacyId}`);
		const d = steps[i].data;
		if (typeof d.prompt !== "string") throw new Error(`promptAppends target has no prompt: ${legacyId}`);
		d.prompt += appendText;
	}
	for (const [legacyId, varMap] of Object.entries(plan.variableAppends || {})) {
		const i = hookIndex(legacyId);
		if (i < 0) continue;
		consumedHooks.add(`variable:${legacyId}`);
		for (const [key, appendText] of Object.entries(varMap)) {
			const row = (steps[i].data.variables || []).find((v) => v.key === key);
			if (!row) throw new Error(`variableAppends: variable "${key}" not on ${legacyId}`);
			row.value += appendText;
		}
	}
	for (const legacyId of plan.silentPills || []) {
		const i = hookIndex(legacyId);
		if (i < 0) continue;
		consumedHooks.add(`pill:${legacyId}`);
		const d = steps[i].data;
		if (typeof d.prompt !== "string") throw new Error(`silentPills target has no prompt: ${legacyId}`);
		d.useStaticText = true;
		d.prompt = ".";
		warn(`silent pill: "${d.name}" speaks static "." (original prompt superseded — the intentional non-verbatim carry; extraction rides variable descriptions, routing rides edge labels). Document in the report.`);
	}

	let description = str(sc.entry.description);
	if (description.startsWith("@persona:")) description = personaCondition(description.slice("@persona:".length));
	scenarioNodes.push({
		id: randomUUID(),
		type: "complex-scenario",
		position: { x: 0, y: 0 },
		data: {
			name: sc.name,
			entry: { mode: "llm", label: str(sc.entry.label) || sc.name, description, alwaysPick: false },
			rule: str(sc.rule),
			target: { kind: "dialogue", label: "Nested flow" },
			flow: { nodes: [startPill, ...steps, endPill], edges: flowEdges },
		},
	});
}

for (const k of Object.keys(plan.promptAppends || {})) {
	if (!consumedHooks.has(`prompt:${k}`)) throw new Error(`promptAppends target matched no scenario member: ${k}`);
}
for (const k of Object.keys(plan.variableAppends || {})) {
	if (!consumedHooks.has(`variable:${k}`)) throw new Error(`variableAppends target matched no scenario member: ${k}`);
}
for (const k of plan.silentPills || []) {
	if (!consumedHooks.has(`pill:${k}`)) throw new Error(`silentPills target matched no scenario member: ${k}`);
}

const uncovered = mergedNodes.filter((n) => !seenMembers.has(n.id) && !deadInV1.has(n.id) && !(startCodeNode && n.id === startCodeNode.id)).map((n) => `${n.id} (${(n.data || {}).name || n.type})`);
if (uncovered.length > 0) warn(`NOT covered by any scenario (must each be a deliberate disposition): ${uncovered.join(", ")}`);

// ── assemble ────────────────────────────────────────────────────────────────
const endCallNodes = (plan.endCalls || []).map((ec) => ({
	id: randomUUID(),
	type: "end-call",
	position: { x: 0, y: 0 },
	data: {
		name: ec.name,
		entry: { mode: "llm", label: str(ec.entry.label) || ec.name, description: str(ec.entry.description), alwaysPick: false },
		prompt: str(ec.prompt),
		useStaticText: false,
		loopWhile: "",
		variables: [],
		ignorePreviousExtractions: false,
		useAudioExtraction: false,
		settings: stepSettings({}),
	},
}));

const directory = [...scenarioNodes, ...endCallNodes]
	.map((n) => `- "${n.data.name}" — ${n.data.entry.description || n.data.entry.label}`)
	.join("\n");
const hubId = randomUUID();
const hub = { id: hubId, type: "agent", position: { x: 0, y: 0 }, data: { prompt: `${str(plan.hubPrompt)}\n\n## Where you can route\n\n${directory}`, variables: [], loopWhile: "" } };
const entryTarget = plan.entryScenario ? scenarioNodes.find((n) => n.data.name === plan.entryScenario) : null;
if (plan.entryScenario && !entryTarget) throw new Error(`entryScenario "${plan.entryScenario}" not found`);

// ── voice + language ────────────────────────────────────────────────────────
// Carried from the source like the platform's own import: the persona's
// call_config, or plan.voice / plan.language (e.g. read from the number the
// pathway answers on). A canonical language code carries verbatim; the
// legacy aliases carry as the code they stand for; blank and the "ENG"
// unset marker carry nothing. With nothing to carry, the defaults stay and
// settings.importWarnings says so, so the builder shows it.
const LEGACY_LANGUAGE = { ESP: "es", POL: "pl", ITA: "it", GER: "de", FRE: "fr", PBR: "pt-BR", "EN-BETA": "auto" };
function carriedLanguage(raw) {
	const code = str(raw).trim();
	if (!code || code.toUpperCase() === "ENG") return "";
	if (LEGACY_LANGUAGE[code.toUpperCase()]) return LEGACY_LANGUAGE[code.toUpperCase()];
	return /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/.test(code) ? code : "";
}
const callConfig = (persona && persona.call_config) || {};
// A plan field overrides the persona even when empty: "" picks the default.
const carriedVoice = str(plan.voice !== undefined ? plan.voice : callConfig.voice).trim();
const languageSource = plan.language !== undefined ? plan.language : callConfig.language;
const carriedLang = carriedLanguage(languageSource);
const importWarnings = [];
if (!carriedVoice) {
	const message = "the source sets no voice, so the agent uses the platform default voice; set settings.voice to a voice id";
	warn(message);
	importWarnings.push({ code: "voice_not_carried", message, field: "voice" });
}
if (!carriedLang) {
	const message = str(languageSource).trim() && str(languageSource).trim().toUpperCase() !== "ENG"
		? `the source language "${str(languageSource).trim()}" is not a language code, so the agent uses the default language; set settings.languages`
		: "the source sets no language, so the agent uses the default language; set settings.languages";
	warn(message);
	importWarnings.push({ code: "language_not_carried", message, field: "languages" });
}

const snapshot = {
	...(initialization ? { initialization } : {}),
	behavior: {
		nodes: [{ id: "inbound", type: "inbound", position: { x: 0, y: 0 }, data: { number: "" } }, hub, ...scenarioNodes, ...endCallNodes],
		edges: [{ id: "e-inbound-agent", type: "straight", source: "inbound", target: entryTarget ? entryTarget.id : hubId, animated: true, deletable: false, selectable: false }],
	},
	settings: {
		displayName: str(plan.displayName) || "Migrated agent",
		systemPrompt: str(plan.systemPrompt),
		voice: carriedVoice,
		languages: [carriedLang || "english"],
		enableMemory: false,
		tapbackReactions: false,
		reactions: ["👍", "👎", "❤️", "😂", "‼️", "❓"],
		interruptionSensitivity: 350,
		backgroundNoise: "off",
		voiceCall: { enabled: true, record: false, fallbackNumber: "", maxDurationMinutes: 30, noiseCancellation: true, ignoreButtonPress: false, requestData: [], metadata: [] },
		webChat: { enabled: false, widgetTitle: "Support", greetingMessage: "Hi there! How can I help you today?", allowedOrigins: "" },
		...(importWarnings.length ? { importWarnings } : {}),
	},
	contact: { inboundNumbers: [] },
};

// --out is CWD-relative (matching how migration-state init resolves the same
// path); only plan inputs (sources/persona) are plan-relative.
const outAbs = path.resolve(outPath);
fs.writeFileSync(outAbs, JSON.stringify(snapshot));
process.stdout.write(
	`${JSON.stringify(
		{
			out: outAbs,
			scenarios: scenarioNodes.map((n) => ({ name: n.data.name, steps: n.data.flow.nodes.length - 2, edges: n.data.flow.edges.length })),
			endCalls: endCallNodes.length,
			dropped: droppedUnreachable,
			globalPromptsFound: globalPrompts.map((g) => `${g.file} (${g.prompt.length} chars — must be inside plan.systemPrompt verbatim)`),
			warnings,
		},
		null,
		2,
	)}\n`,
);
