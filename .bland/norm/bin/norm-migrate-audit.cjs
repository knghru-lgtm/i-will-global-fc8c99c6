#!/usr/bin/env node
"use strict";

/**
 * Norm v2 — deterministic migration audit: snapshot structure + routing-crash
 * checks + byte-level parity against the v1 source export(s). This is the
 * machine half of /norm:validate — no model judgment anywhere. Prints a JSON
 * verdict {passed, checks: [{id, name, passed, detail}]} and exits 0 (exit 2
 * only on crash/unreadable input).
 *
 * Usage:
 *   norm-migrate-audit.cjs --snapshot snap.json [--source v1.json]... \
 *     [--persona persona.json] [--allow-missing-fallback <routeName>]... \
 *     [--dropped-tags .norm/dropped-tags.json]   (rows: "tag" | {tag} | {node: id|name, reason}) [--json]
 *
 * Check families: S (structure), R (routing crashes), P (parity with the v1
 * source), A (v2 architecture). Two checks need no source:
 *   S9  no hollow attached tool. A tool with a toolId that is not byReference
 *       runs its embedded definition, so that definition needs a description
 *       and a body. Fix: set byReference true (the library tool runs by id) or
 *       embed the full definition.
 *   R5  every deterministic edge row (flow edges and entries) has operator
 *       AND or OR (the join to the previous row) and a conditionOperator of
 *       contains, does not contain, equals, not equals, greater than, less
 *       than or is. A comparison put in operator saves but never matches.
 */

const fs = require("node:fs");

const args = process.argv.slice(2);
function flagAll(name) {
	const out = [];
	for (let i = 0; i < args.length; i += 1) {
		if (args[i] === `--${name}` && args[i + 1]) out.push(args[i + 1]);
	}
	return out;
}
const snapshotPath = flagAll("snapshot")[0];
const sourcePaths = flagAll("source");
const personaPath = flagAll("persona")[0];
const allowedMissingFallback = new Set(flagAll("allow-missing-fallback"));
const droppedTagsPath = flagAll("dropped-tags")[0];

const checks = [];
function check(id, name, passed, detail) {
	checks.push({ id, name, passed: Boolean(passed), detail: detail || "" });
}

// Does the snapshot's pin (`got`) satisfy the source's (`want`)? Pins arrive
// as numbers or numeric strings ("3" and 3 are the same version). An unpinned
// source accepts anything; a pinned source needs the same version — a missing
// snapshot version is not a match.
function sameVersion(got, want) {
	if (want === undefined || want === null || want === "") return true;
	if (got === undefined || got === null || got === "") return false;
	const ng = Number(got);
	const nw = Number(want);
	return Number.isFinite(ng) && Number.isFinite(nw) ? ng === nw : String(got) === String(want);
}
function loadJson(p) {
	const raw = JSON.parse(fs.readFileSync(p, "utf8"));
	return raw && raw.data && typeof raw.data === "object" ? raw.data : raw;
}

// v1 Route rules run in order and the first match wins. An empty isGroup
// block is an AND over no rows, so it is always true: the rule holding it is
// taken whenever it is reached, and the rules after it and the fallback are
// never reached. Returns the index of that rule, or -1.
const isEmptyGroup = (row) => Boolean(row) && row.isGroup === true && Array.isArray(row.conditions) && row.conditions.length === 0;
function emptyGroupRouteIndex(routes) {
	return (Array.isArray(routes) ? routes : []).findIndex((r) => r && Array.isArray(r.conditions) && r.conditions.some(isEmptyGroup));
}

// The v1 nodes that nothing can reach because a Route's empty condition group
// cuts off every way in: the targets of the rules after it and of its old
// fallback, and whatever only those lead to. A node stays when it is a start
// or global node, one of `roots`, or something else leads to it (an edge, a
// rule or fallback on another route, a response pathway; any node id named in
// a node's data counts). Returns Map(node id -> name of the cutting route).
function unreachableBehindEmptyGroups(nodes, edges, roots = []) {
	const list = (Array.isArray(nodes) ? nodes : []).filter((n) => n && typeof n.id === "string");
	const ids = new Set(list.map((n) => n.id));
	const next = new Map();
	const link = (from, to) => {
		if (from === to || !ids.has(to)) return;
		if (!next.has(from)) next.set(from, new Set());
		next.get(from).add(to);
	};
	for (const e of Array.isArray(edges) ? edges : []) if (e) link(e.source, e.target);
	const cutBy = new Map();
	for (const n of list) {
		let data = n.data || {};
		const routes = Array.isArray(data.routes) ? data.routes : [];
		const cut = n.type === "Route" ? emptyGroupRouteIndex(routes) : -1;
		if (cut >= 0) {
			const routeName = typeof data.name === "string" && data.name ? data.name : n.id;
			for (const target of [...routes.slice(cut + 1).map((r) => (r || {}).targetNodeId), data.fallbackNodeId]) {
				if (ids.has(target) && !cutBy.has(target)) cutBy.set(target, routeName);
			}
			data = { ...data, routes: routes.slice(0, cut + 1), fallbackNodeId: routes[cut].targetNodeId };
		}
		(function walk(o) {
			if (typeof o === "string") link(n.id, o);
			else if (Array.isArray(o)) o.forEach(walk);
			else if (o && typeof o === "object") Object.values(o).forEach(walk);
		})(data);
	}
	// Candidates: the cut-off targets and everything they lead to.
	const candidates = new Map();
	const stack = [...cutBy.keys()].map((id) => [id, cutBy.get(id)]);
	while (stack.length) {
		const [id, routeName] = stack.pop();
		if (candidates.has(id)) continue;
		candidates.set(id, routeName);
		for (const to of next.get(id) || []) stack.push([to, routeName]);
	}
	const rootSet = new Set(roots);
	for (const n of list) if (n.data && (n.data.isStart === true || n.data.isGlobal === true)) rootSet.add(n.id);
	const live = new Set([...candidates.keys()].filter((id) => rootSet.has(id)));
	for (const [from, tos] of next) if (!candidates.has(from)) for (const to of tos) if (candidates.has(to)) live.add(to);
	const queue = [...live];
	while (queue.length) {
		for (const to of next.get(queue.pop()) || []) {
			if (candidates.has(to) && !live.has(to)) {
				live.add(to);
				queue.push(to);
			}
		}
	}
	for (const id of live) candidates.delete(id);
	return candidates;
}

function main() {
	if (!snapshotPath) {
		process.stdout.write(JSON.stringify({ passed: false, error: "--snapshot required" }));
		process.exitCode = 2;
		return;
	}
	const snap = loadJson(snapshotPath);
	const snapText = JSON.stringify(snap);
	// Declared drops (--dropped-tags <json>): plain strings are tags; objects
	// may carry {tag} and/or {node: "<v1 node id or name>", reason}. Only a
	// DECLARED node drop excuses a missing node (P11); only a declared tag drop
	// excuses a missing tag (A6). Undeclared losses fail.
	const normDrop = (t) => String(t || "").replace(/\s+/g, " ").trim();
	const declaredDropTags = new Set();
	const declaredDropNodes = new Set();
	if (droppedTagsPath && fs.existsSync(droppedTagsPath)) {
		for (const row of loadJson(droppedTagsPath) || []) {
			if (typeof row === "string") declaredDropTags.add(row.trim());
			else if (row && typeof row === "object") {
				if (typeof row.tag === "string") declaredDropTags.add(row.tag.trim());
				if (typeof row.node === "string") declaredDropNodes.add(normDrop(row.node));
				if (typeof row.id === "string") declaredDropNodes.add(normDrop(row.id));
				if (typeof row.name === "string") declaredDropNodes.add(normDrop(row.name));
			}
		}
	}
	const behavior = snap.behavior || {};
	const nodes = Array.isArray(behavior.nodes) ? behavior.nodes : [];
	const edges = Array.isArray(behavior.edges) ? behavior.edges : [];

	// ── Structure ──
	check("S1", "top-level shape", nodes.length > 0 && edges.length >= 0 && typeof (snap.settings || {}).systemPrompt === "string" && snap.settings.systemPrompt.length > 0, "behavior.nodes + settings.systemPrompt");
	const inbound = nodes.filter((n) => n.type === "inbound");
	const hubs = nodes.filter((n) => n.type === "agent");
	const inboundEdge = edges.find((e) => e.source === "inbound" || (inbound[0] && e.source === inbound[0].id));
	check("S2", "one inbound + one hub + inbound edge", inbound.length === 1 && hubs.length === 1 && Boolean(inboundEdge), `inbound=${inbound.length} hub=${hubs.length} edge=${Boolean(inboundEdge)}`);
	const scenarios = nodes.filter((n) => n.type === "complex-scenario");
	let entryOk = true;
	let pillOk = true;
	const flowIssues = [];
	for (const s of scenarios) {
		const d = s.data || {};
		if (!d.entry || !String(d.entry.description || "").trim()) {
			entryOk = false;
			flowIssues.push(`${d.name || s.id}: empty entry.description`);
		}
		const fn = ((d.flow || {}).nodes || []);
		if (!fn.length || fn[0].type !== "start" || fn[fn.length - 1].type !== "end") {
			pillOk = false;
			flowIssues.push(`${d.name || s.id}: missing start/end pills`);
		}
	}
	check("S3", "scenario entries + start/end pills", entryOk && pillOk, flowIssues.join("; "));
	// S3b/S3c — the two live-run crash classes: a start pill with no outgoing
	// edge compiles to an unenterable flow (entryNodeId "" — the hub answers
	// every lane itself), and a variables row without type/accurateSpelling
	// crashes the compiler at chat-session creation (ScenarioVariable).
	let startEdgeOk = true;
	let varRowOk = true;
	const wiringIssues = [];
	for (const s of scenarios) {
		const d = s.data || {};
		const fn = ((d.flow || {}).nodes || []);
		const fe = ((d.flow || {}).edges || []);
		const startNode = fn.find((n) => n.type === "start");
		if (startNode && !fe.some((e) => e.source === startNode.id)) {
			startEdgeOk = false;
			wiringIssues.push(`${d.name || s.id}: start pill has no outgoing edge`);
		}
		for (const step of fn) {
			for (const row of ((step.data || {}).variables || [])) {
				if (typeof row.type !== "string" || typeof row.accurateSpelling !== "boolean") {
					varRowOk = false;
					wiringIssues.push(`${d.name || s.id}/${(step.data || {}).name || step.id}: variables row "${row.key}" missing type/accurateSpelling`);
				}
			}
		}
	}
	check("S3b", "every start pill points at an entry step", startEdgeOk, wiringIssues.filter((x) => x.includes("start pill")).slice(0, 5).join("; "));
	check("S3c", "variables rows carry type + accurateSpelling", varRowOk, wiringIssues.filter((x) => x.includes("variables row")).slice(0, 5).join("; "));

	const ids = new Map();
	const dupes = [];
	(function walk(o) {
		if (Array.isArray(o)) return o.forEach(walk);
		if (o && typeof o === "object") {
			if (typeof o.id === "string" && o.id) {
				ids.set(o.id, (ids.get(o.id) || 0) + 1);
				if (ids.get(o.id) === 2) dupes.push(o.id);
			}
			Object.values(o).forEach(walk);
		}
	})(behavior);
	check("S4", "no duplicate ids", dupes.length === 0, dupes.slice(0, 5).join(", "));

	const targetIssues = [];
	const routeNoFallback = [];
	const orCollapse = [];
	const unreachable = [];
	const mergedLabels = [];
	let reachableNestedEndCall = false;
	for (const s of scenarios) {
		const d = s.data || {};
		const fn = ((d.flow || {}).nodes || []);
		const fe = ((d.flow || {}).edges || []);
		const idset = new Set(fn.map((n) => n.id));
		const endPill = fn.length ? fn[fn.length - 1].id : "";
		const inboundTargets = new Set(fe.map((e) => e.target));
		for (const e of fe) {
			if (!idset.has(e.source) || !idset.has(e.target)) targetIssues.push(`${d.name}: edge ${String(e.id).slice(0, 8)} dangling`);
			const lbl = String(((e.data || {}).label) || "");
			if (e.target === endPill && lbl.includes(" / ")) mergedLabels.push(`${d.name}: "${lbl}"`);
		}
		for (const n of fn) {
			const nd = n.data || {};
			if (n.type === "route") {
				for (const r of nd.rules || []) {
					if (r.targetNodeId && !idset.has(r.targetNodeId)) targetIssues.push(`${d.name}/${nd.name}: rule target missing`);
					inboundTargets.add(r.targetNodeId);
					const byField = new Map();
					for (const c of r.conditions || []) {
						if (["equals", "is"].includes(String(c.operator))) {
							const arr = byField.get(c.field) || [];
							arr.push(String(c.value));
							byField.set(c.field, arr);
						}
					}
					for (const [f, vals] of byField) {
						if (new Set(vals).size > 1) orCollapse.push(`${d.name}/${nd.name}: ANDs ${f}=${vals.join(",")}`);
					}
				}
				if (nd.fallbackNodeId) {
					if (!idset.has(nd.fallbackNodeId)) targetIssues.push(`${d.name}/${nd.name}: fallback missing`);
					inboundTargets.add(nd.fallbackNodeId);
				} else if (!allowedMissingFallback.has(String(nd.name))) {
					routeNoFallback.push(`${d.name}/${nd.name}`);
				}
			}
			for (const t of nd.tools || []) {
				for (const rp of t.responsePathways || []) {
					const tgt = rp.targetId || rp.targetNodeId;
					if (tgt && !idset.has(tgt)) targetIssues.push(`${d.name}/${nd.name}: tool rp target missing`);
					if (tgt) inboundTargets.add(tgt);
				}
			}
			for (const rp of nd.responsePathways || []) {
				// webhook/tool STEP rows use targetNodeId; attached-tool rows use targetId
				const tgt = rp.targetNodeId || rp.targetId;
				if (tgt && !idset.has(tgt)) targetIssues.push(`${d.name}/${nd.name}: rp target missing`);
				if (tgt) inboundTargets.add(tgt);
			}
		}
		for (let i = 1; i < fn.length - 1; i += 1) {
			if (!inboundTargets.has(fn[i].id) && i !== 1) unreachable.push(`${d.name}/${(fn[i].data || {}).name || fn[i].id}`);
		}
		// S6 counts an in-flow end-call only when the flow can get to it: walk
		// from the Start pill over edges, route targets and response pathways.
		const next = new Map();
		const link = (from, to) => {
			if (to) next.set(from, [...(next.get(from) || []), to]);
		};
		for (const e of fe) link(e.source, e.target);
		for (const n of fn) {
			const nd = n.data || {};
			for (const r of nd.rules || []) link(n.id, r.targetNodeId);
			link(n.id, nd.fallbackNodeId);
			for (const t of nd.tools || []) for (const rp of t.responsePathways || []) link(n.id, rp.targetId || rp.targetNodeId);
			for (const rp of nd.responsePathways || []) link(n.id, rp.targetNodeId || rp.targetId);
		}
		const startPill = fn.find((n) => n.type === "start");
		const seen = new Set();
		const queue = startPill ? [startPill.id] : [];
		while (queue.length) {
			const id = queue.pop();
			if (seen.has(id)) continue;
			seen.add(id);
			queue.push(...(next.get(id) || []));
		}
		if (fn.some((n) => n.type === "end-call" && seen.has(n.id))) reachableNestedEndCall = true;
	}
	check("S5", "all targets resolve", targetIssues.length === 0, targetIssues.slice(0, 5).join("; "));
	// A v1 End Call carries as an end-call step inside its flow, so the
	// hang-up can live there instead of at the root (as the platform's own
	// parity audit accepts). An in-flow end-call nothing leads to does not
	// count.
	//
	// S6 deliberately does NOT require a root end-call just because some flow
	// returns to the hub: handing back so the hub can route onward is a valid
	// design and is not a hang-up. The one hand-back that IS a v1 hang-up, an
	// End Call with a code tool (built as a wrap-up step), is checked exactly,
	// against the source, by P10 below.
	const rootEndCall = nodes.some((n) => n.type === "end-call");
	check("S6", "an end-call exists (root, or inside a flow and reachable from its Start)", rootEndCall || reachableNestedEndCall, "");
	check("S7", "contact.inboundNumbers is an array", Array.isArray((snap.contact || {}).inboundNumbers), "the platform validator rejects a snapshot without it");
	{
		const badHeaders = [];
		for (const s of scenarios) {
			for (const fn of ((s.data || {}).flow || {}).nodes || []) {
				if (fn.type === "webhook") {
					const hs = (fn.data || {}).headers;
					if (Array.isArray(hs) && hs.some((h) => Array.isArray(h) || !h || typeof h.key !== "string")) {
						badHeaders.push(`${(s.data || {}).name}/${(fn.data || {}).name}`);
					}
				}
			}
		}
		check("S8", "webhook headers are {key,value} rows (not v1 tuples)", badHeaders.length === 0, badHeaders.join(", "));
	}
	// S9: an attached tool that names a library tool but is not byReference runs
	// its embedded definition, never the library tool. A definition without a
	// description or a body is a stand-in that runs nothing.
	{
		const hollow = [];
		(function walkTools(o, owner) {
			if (Array.isArray(o)) return o.forEach((x) => walkTools(x, owner));
			if (!o || typeof o !== "object") return;
			const here = o.data && typeof o.data.name === "string" ? o.data.name : owner;
			if (Array.isArray(o.tools)) {
				for (const t of o.tools) {
					if (!t || typeof t !== "object" || t.toolType === "track") continue;
					const def = t.definition && typeof t.definition === "object" ? t.definition : {};
					if (t.toolId && t.byReference !== true && (typeof def.description !== "string" || def.body === undefined)) {
						hollow.push(`${here || "?"}/${t.name || t.toolId}`);
					}
				}
			}
			Object.values(o).forEach((x) => walkTools(x, here));
		})(behavior, "");
		check("S9", "no hollow attached tool (a library toolId is byReference, or the embedded definition has a description and body)", hollow.length === 0, hollow.slice(0, 5).join(", "));
	}
	check("R1", "route fallbacks present", routeNoFallback.length === 0, routeNoFallback.join(", "));
	check("R2", "no OR-collapse", orCollapse.length === 0, orCollapse.slice(0, 5).join("; "));
	check("R3", "flow steps reachable", unreachable.length === 0, unreachable.slice(0, 6).join(", "));
	check("R4", "no merged exit labels", mergedLabels.length === 0, mergedLabels.slice(0, 4).join("; "));
	// R5: deterministic edge rows in the v2 shape. The compiler copies operator
	// and conditionOperator through unchecked, and the save validator does not
	// look at them, so a wrong spelling saves and then never matches.
	{
		const JOINS = new Set(["AND", "OR"]);
		const COMPARISONS = new Set(["contains", "does not contain", "equals", "not equals", "greater than", "less than", "is"]);
		const badRows = [];
		const checkEdgeData = (ed, where) => {
			if (!ed || typeof ed !== "object" || !Array.isArray(ed.conditions)) return;
			if (ed.mode !== "deterministic" && ed.conditions.length === 0) return;
			ed.conditions.forEach((c, i) => {
				const row = c || {};
				const at = `${where} row ${i + 1}`;
				if (!JOINS.has(row.operator)) badRows.push(`${at}: operator "${row.operator ?? ""}" (want AND or OR)`);
				if (!COMPARISONS.has(row.conditionOperator)) badRows.push(`${at}: conditionOperator "${row.conditionOperator ?? ""}"`);
			});
		};
		(function walkEdges(flow, where) {
			const fnodes = Array.isArray((flow || {}).nodes) ? flow.nodes : [];
			const fedges = Array.isArray((flow || {}).edges) ? flow.edges : [];
			const nameOf = (id) => {
				const n = fnodes.find((x) => x.id === id);
				return String(((n || {}).data || {}).name || (n || {}).type || id);
			};
			for (const e of fedges) checkEdgeData(e.data, `${where}edge ${nameOf(e.source)} -> ${nameOf(e.target)}`);
			for (const n of fnodes) {
				const nd = n.data || {};
				checkEdgeData(nd.entry, `${where}${nd.name || n.id} entry`);
				if (nd.flow) walkEdges(nd.flow, `${where}${nd.name || n.id}/`);
			}
		})(behavior, "");
		check("R5", "deterministic edge rows use operator AND|OR and a known conditionOperator", badRows.length === 0, badRows.slice(0, 5).join("; "));
	}

	// ── Parity vs v1 source(s) — SHAPE-ANCHORED, not substring greps ──
	// Collect what the snapshot actually carries, field-by-field: snippet
	// (id, version) PAIRS wherever they appear, webhook-step URLs, transfer-step
	// numbers, customCode-step pin pairs. A swapped version between two
	// snippets, or a URL that only appears in prose, cannot pass.
	// "key=target" -> how many steps carry it. Counted per step, so a setting
	// dropped from one of two steps that share a variable still fails P9.
	const snapCaptureAs = new Map();
	const srcCaptureAs = new Map();
	const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
	const snapPinPairs = new Set();
	const snapCodeStepPairs = new Set();
	const snapWebhookUrls = new Set();
	const snapTransferNumbers = new Set();
	(function collect(o) {
		if (Array.isArray(o)) return o.forEach(collect);
		if (!o || typeof o !== "object") return;
		if (typeof o.snippet_id === "string") snapPinPairs.add(`${o.snippet_id}@${o.snippet_version ?? ""}`);
		if (typeof o.snippetId === "string") {
			snapPinPairs.add(`${o.snippetId}@${o.snippetVersion ?? ""}`);
			snapCodeStepPairs.add(`${o.snippetId}@${o.snippetVersion ?? ""}`);
		}
		if (typeof o.captureAs === "string" && typeof o.key === "string") bump(snapCaptureAs, `${o.key}=${o.captureAs}`);
		if (o.type === "webhook" && o.data && typeof o.data.url === "string") snapWebhookUrls.add(o.data.url);
		if (o.type === "transfer" && o.data && typeof o.data.transferNumber === "string") snapTransferNumbers.add(o.data.transferNumber);
		Object.values(o).forEach(collect);
	})(snap);

	const missingPins = [];
	const missingTools = [];
	const missingNumbers = [];
	const missingUrls = [];
	const codeToolsAsTools = [];
	const wrapUpEndCalls = [];
	const missingCapture = [];
	let promptContained = true;
	let promptDetail = "";
	for (const sp of sourcePaths) {
		const src = loadJson(sp);
		const srcText = JSON.stringify(src);
		// source pin PAIRS (id + pinned version together)
		(function collectSrc(o) {
			if (Array.isArray(o)) return o.forEach(collectSrc);
			if (!o || typeof o !== "object") return;
			if (typeof o.snippet_id === "string") {
				const pair = `${o.snippet_id}@${o.snippet_version ?? ""}`;
				if (!snapPinPairs.has(pair)) missingPins.push(pair);
			}
			Object.values(o).forEach(collectSrc);
		})(src);
		const toolIds = new Set(srcText.match(/TL-[0-9a-f-]{8,}/g) || []);
		for (const tid of toolIds) {
			if (!snapText.includes(tid)) missingTools.push(tid);
		}
		for (const n of src.nodes || []) {
			const nd = (n && n.data) || {};
			if (nd.transferNumber && !snapTransferNumbers.has(String(nd.transferNumber))) missingNumbers.push(String(nd.transferNumber));
			if (nd.url && !snapWebhookUrls.has(String(nd.url))) missingUrls.push(String(nd.url).slice(0, 60));
			for (const t of nd.tools || []) {
				if (t.type === "code" && t.config && t.config.snippet_id && n.type === "End Call") wrapUpEndCalls.push(String(nd.name || n.id));
				if (t.type === "code" && t.config && t.config.snippet_id) {
					// must exist as a customCode STEP with the same id+version pair
					const pair = `${t.config.snippet_id}@${t.config.snippet_version ?? ""}`;
					if (!snapCodeStepPairs.has(pair)) codeToolsAsTools.push(`${nd.name || n.id}: ${t.name} not re-represented as code step (pair ${pair.slice(0, 12)}…)`);
				}
			}
			// v1 capture settings ({variable: target}) carry as the variable
			// row's captureAs.
			for (const [key, target] of Object.entries(nd.captureKinds || {})) {
				if (typeof target === "string" && target) bump(srcCaptureAs, `${key}=${target}`);
			}
			const gp = (n && n.globalConfig && n.globalConfig.globalPrompt) || "";
			if (gp && !(snap.settings.systemPrompt || "").includes(gp)) {
				promptContained = false;
				promptDetail = `globalPrompt of ${sp} not contained in systemPrompt`;
			}
		}
	}
	if (personaPath) {
		const persona = loadJson(personaPath);
		const pp = String(persona.personality_prompt || "");
		if (pp && !(snap.settings.systemPrompt || "").startsWith(pp)) {
			promptContained = false;
			promptDetail = "personality_prompt is not the verbatim head of systemPrompt";
		}
		for (const c of persona.pathway_conditions || []) {
			if (c.prompt && !snapText.includes(JSON.stringify(String(c.prompt)).slice(1, -1))) {
				check("P8", `persona condition "${c.name}" carried verbatim`, false, "entry description differs from pathway_conditions prompt");
			}
		}
	}
	if (sourcePaths.length || personaPath) {
		check("P1", "every source snippet (id, version) PAIR present", missingPins.length === 0, missingPins.map((x) => x.slice(0, 14) + "…").join(", "));
		check("P2", "every source TL- tool id present", missingTools.length === 0, missingTools.join(", "));
		check("P3", "every transfer number present on a transfer step", missingNumbers.length === 0, missingNumbers.join(", "));
		check("P4", "every webhook URL present on a webhook step", missingUrls.length === 0, missingUrls.join("; "));
		check("P5", "code-type attached tools re-represented as code steps", codeToolsAsTools.length === 0, codeToolsAsTools.join("; "));
		check("P7", "global/persona prompt carried verbatim", promptContained, promptDetail);
		// A v1 End Call with a code tool migrates as a wrap-up step that
		// returns to the hub (an end-call step cannot run a snippet), so that
		// call can only end from a root end-call. An in-flow end-call in some
		// other flow does not cover it.
		//
		// P10 is a structural minimum and is meant to be: it proves a root
		// end-call EXISTS, not that the hub picks it after the wrap-up. That
		// choice is the hub model reading entry descriptions at run time. No
		// static check in this file can decide it, and this audit never
		// judges entry wording anywhere (S1 to S8 are all structural). The
		// hang-up at that point is proven where every other behavior is: the
		// simulation lane for that terminal in /norm:simulate (migrate step
		// 6, graded on engine traces). This is also not a new gap: main builds
		// this exact wrap-up for EVERY End Call and checks it the same way
		// (old S6: "root end-call exists"). This PR removes that reliance for
		// every End Call except the one kind an end-call step cannot express.
		check(
			"P10",
			"a v1 End Call with a code tool has a root end-call to hang up after it",
			wrapUpEndCalls.length === 0 || rootEndCall,
			wrapUpEndCalls.slice(0, 5).join(", "),
		);
		for (const [pair, want] of srcCaptureAs) {
			const got = snapCaptureAs.get(pair) || 0;
			if (got < want) missingCapture.push(`${pair} on ${got} of ${want} steps`);
		}
		check("P9", "every v1 capture setting carried as captureAs", missingCapture.length === 0, missingCapture.slice(0, 5).join(", "));
	}

	// ── Content & capability carriage (keep everything v1 had) ──────────────
	// Structure follows v2 doctrine; CONTENT is copied, never rewritten. These
	// checks are whitespace-insensitive containment tests against the whole
	// snapshot: a node's prompt, its hold condition, the edge descriptions
	// that ARE the call flow, every extraction variable, every KB id, and
	// every global node's trigger must all survive — a dropped node is only
	// legitimate when the report drops it, which --dropped-tags declares by
	// tag; here a node whose own prompt was not carried is treated as dropped
	// and its edges are not demanded.
	if (sourcePaths.length) {
		const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
		// Compare against the snapshot's STRING VALUES, not its JSON encoding
		// (where quotes and newlines are escaped and would never match).
		const snapStrings = [];
		(function collectStrings(o) {
			if (Array.isArray(o)) return o.forEach(collectStrings);
			if (!o || typeof o !== "object") return;
			for (const v of Object.values(o)) {
				if (typeof v === "string") snapStrings.push(v);
				else collectStrings(v);
			}
		})(snap);
		const snapNorm = snapStrings.map(norm).join("\n");
		const carried = (t) => {
			const n = norm(t);
			return n.length < 8 || snapNorm.includes(n);
		};
		const isDeclaredDrop = (n) => declaredDropNodes.has(normDrop(n.id)) || declaredDropNodes.has(normDrop((n.data || {}).name));
		// Index the snapshot's steps by name: a v1 node is "carried" when a step
		// of the same name exists. A node with no such step is a documented drop
		// (dispositions live in the report), and its prompt/edges are not
		// demanded here; a carried step with static "." speech is a deliberate
		// silentPill and its prose is not demanded either.
		const stepsByName = new Map();
		(function indexSteps(o) {
			if (Array.isArray(o)) return o.forEach(indexSteps);
			if (!o || typeof o !== "object") return;
			if (typeof o.type === "string" && o.data && typeof o.data.name === "string") {
				const list = stepsByName.get(norm(o.data.name)) || [];
				list.push(o);
				stepsByName.set(norm(o.data.name), list);
			}
			Object.values(o).forEach(indexSteps);
		})(snap);
		// The start code node is carried as `initialization.step` (a bare step
		// data object). It vouches for exactly ONE source node: the one with the
		// same snippet pin, or byte-identical code — never for a same-named code
		// node from another merged source.
		const initStep = (snap.initialization || {}).step || null;
		const initCarries = (d) => {
			if (!initStep) return false;
			if (initStep.snippetId && d.snippet_id) return initStep.snippetId === d.snippet_id && sameVersion(initStep.snippetVersion, d.snippet_version);
			return typeof initStep.code === "string" && typeof d.code === "string" && norm(initStep.code) === norm(d.code);
		};
		const stepsFor = (d) => stepsByName.get(norm(d.name)) || [];
		const isSilenced = (st) => (st.data || {}).useStaticText === true && String((st.data || {}).prompt || "").trim() === ".";
		const missPrompt = [];
		const missCondition = [];
		const missEdge = [];
		const missVar = [];
		const missKb = [];
		const missGlobal = [];
		// Nodes v1 itself never reaches (behind a route's always-true empty
		// condition group) are dropped by the builder; the source proves it, so
		// no declaration is needed, and P11's detail names them.
		const deadInV1 = [];
		for (const sp of sourcePaths) {
			const src = loadJson(sp);
			const nodes = (src.nodes || []).filter((n) => n && n.id !== "global-prompt" && n.data);
			const unreachable = unreachableBehindEmptyGroups(src.nodes, src.edges);
			const carriedNode = new Map();
			// Several v1 nodes often share a name ("End Call"); for those, the
			// node is carried when its OWN speech is present somewhere, and a
			// missing prompt is a drop rather than a rewrite.
			const initCarriedIds = new Set();
			const nameCount = new Map();
			for (const n of nodes) nameCount.set(norm(n.data.name), (nameCount.get(norm(n.data.name)) || 0) + 1);
			for (const n of nodes) {
				const d = n.data;
				const steps = stepsFor(d);
				if (steps.length === 0 && n.type === "Custom Code" && initCarries(d)) {
					carriedNode.set(n.id, true);
					initCarriedIds.add(n.id);
					continue;
				}
				const speech = typeof d.prompt === "string" && d.prompt.trim() ? d.prompt : typeof d.text === "string" && !d.text.trim().startsWith("<|") ? d.text : "";
				const duplicateName = (nameCount.get(norm(d.name)) || 0) > 1;
				// A node whose speech is carried VERBATIM somewhere (e.g. a greeting
				// folded into the hub prompt, per doctrine) is carried even without a
				// same-named step; a node with no speech (route/code) needs a step.
				const absent = (steps.length === 0 && !(speech && carried(speech))) || (duplicateName && speech && !carried(speech) && !steps.some(isSilenced));
				if (absent) {
					carriedNode.set(n.id, false);
					if (unreachable.has(n.id)) deadInV1.push(`${d.name || n.id} (behind route "${unreachable.get(n.id)}")`);
					else if (!isDeclaredDrop(n)) missPrompt.push(`${d.name || n.id} — node not carried and not declared dropped (--dropped-tags {"node":"${String(n.id).slice(0, 8)}…"})`);
					continue;
				}
				// A DECLARED node drop excuses the whole node — its words may still
				// appear (e.g. in the hub prompt) but the report dropped it and
				// everything on it with a reason, its edges included (P13).
				if (isDeclaredDrop(n)) {
					carriedNode.set(n.id, false);
					continue;
				}
				carriedNode.set(n.id, true);
				// A node folded into the hub prompt (speech carried, no step of its
				// own) keeps its words but has no step to hold an extraction
				// variable; KB ids and global triggers are checked snapshot-wide.
				// Those checks still run. A hold condition only lives on a step, so
				// a folded node owes none.
				if (steps.length > 0 && speech && !steps.some(isSilenced) && !carried(speech)) missPrompt.push(`${d.name || n.id}`);
				if (steps.length > 0 && d.condition && !carried(d.condition)) missCondition.push(`${d.name || n.id}`);
				// Extraction variables must live on the SAME step, not merely
				// somewhere in the snapshot (a snippet input or tool response of
				// the same name does not extract the caller's value).
				for (const row of d.extractVars || []) {
					const key = Array.isArray(row) ? row[0] : row && row.name;
					if (typeof key !== "string" || !key) continue;
					const onStep = steps.some((st) => Array.isArray((st.data || {}).variables) && st.data.variables.some((v) => v && v.key === key));
					if (!onStep) missVar.push(`${d.name || n.id}.${key}`);
				}
				const kb = Array.isArray(d.kbTool) ? d.kbTool : d.kbTool ? [d.kbTool] : [];
				for (const id of kb) if (typeof id === "string" && id && !snapText.includes(id)) missKb.push(`${d.name || n.id}:${id.slice(0, 8)}`);
				if (d.isGlobal === true) {
					if (!carried(d.globalLabel)) missGlobal.push(`${d.name || n.id} label`);
					if (!carried(d.globalDescription)) missGlobal.push(`${d.name || n.id} description`);
				}
			}
			for (const e of src.edges || []) {
				if (!e || !e.data) continue;
				if (carriedNode.get(e.source) !== true || carriedNode.get(e.target) !== true) continue;
				// Edges out of the start code node are replaced by the implicit
				// initialization → hub hand-off; their routing text has no v2 home.
				if (initCarriedIds.has(e.source)) continue;
				// Deterministic edges route on their conditions; the builder carries
				// the conditions and writes an empty description on purpose.
				if (Array.isArray(e.data.condition) && e.data.condition.length > 0) continue;
				const desc = e.data.description;
				if (desc && !carried(desc)) missEdge.push(`${String(e.source).slice(0, 8)}→${String(e.target).slice(0, 8)} "${String(e.data.label || "").slice(0, 30)}"`);
			}
		}
		check("P11", "every v1 node carried verbatim or explicitly declared dropped (silenced pills excluded)", missPrompt.length === 0, missPrompt.length ? missPrompt.slice(0, 6).join(", ") : deadInV1.length ? `dropped, unreachable in v1 (an empty condition group is always true, so v1 never gets past it): ${deadInV1.slice(0, 6).join(", ")}` : "");
		check("P12", "every v1 hold condition carried verbatim (escapes may be appended)", missCondition.length === 0, missCondition.slice(0, 6).join(", "));
		check("P13", "every LLM-routed v1 edge description carried verbatim (deterministic edges route on conditions)", missEdge.length === 0, missEdge.slice(0, 5).join("; "));
		check("P14", "every v1 extraction variable carried on the same step", missVar.length === 0, missVar.slice(0, 6).join(", "));
		check("P15", "every v1 knowledge-base id carried", missKb.length === 0, missKb.slice(0, 6).join(", "));
		check("P16", "every v1 global node trigger (label + description) carried verbatim", missGlobal.length === 0, missGlobal.slice(0, 6).join(", "));
	}


	// ── v2 architecture (migration doctrine — deterministic, FAIL not warn) ──
	// A v1 pathway poured into one flow hanging off Start is still a v1 pathway:
	// the hub is switched off for the whole call, root end-calls become dead
	// code, and the first hold condition traps the caller. These checks are the
	// machine half of /norm:validate 20–25; the Stop hook blocks on them.
	{
		const STEP_TYPES = new Set(["prompt", "knowledge", "tool", "webhook", "customCode", "sms", "transfer", "smsOtp", "identityQuestions", "pressButton", "waitForResponse", "transferPathway", "playAudio", "route", "channel", "ivr", "scheduling", "twilioFlowRedirect", "amazonConnect", "resetSttLanguage", "end-call"]);
		// Step types that are the call BODY — never connection gating. A Start
		// scenario holding one of these is the whole call hanging off Start.
		const CORE_LOGIC = new Set(["knowledge", "scheduling", "smsOtp", "identityQuestions", "transfer", "transferPathway"]);
		const flowSteps = (n) => {
			if (n.type === "scenario") return [n];
			const f = (n.data || {}).flow;
			return f && Array.isArray(f.nodes) ? f.nodes.filter((x) => STEP_TYPES.has(x.type)) : [];
		};
		const rootFlows = nodes.filter((n) => n.type === "scenario" || n.type === "complex-scenario");
		const totalSteps = rootFlows.reduce((acc, n) => acc + flowSteps(n).length, 0);
		const byId = new Map(nodes.map((n) => [n.id, n]));
		const entryTarget = inboundEdge ? byId.get(inboundEdge.target) : undefined;
		const name = (n) => String(((n || {}).data || {}).name || (n || {}).id || "?");
		// Is a flow node satisfying `goal` reachable from the start pill over the
		// flow's edges and the step-level redirects the runtime can take (route
		// and channel rules + fallback, response pathways on the step and its
		// tools, STT-reset / scheduling-error jumps, a global's forwarding node)?
		// Step types the compiler emits `settings` (and so a global trigger)
		// for — SERVER toPathway.ts mapStepNode applies stepSettingsData only
		// on these; a global flag on sms / smsOtp / amazonConnect never reaches
		// the runtime.
		const GLOBAL_CAPABLE = new Set(["prompt", "knowledge", "tool", "webhook", "customCode", "transfer", "identityQuestions", "pressButton", "waitForResponse", "transferPathway", "playAudio", "route", "channel", "ivr", "scheduling", "twilioFlowRedirect", "resetSttLanguage"]);
		const flowReaches = (flow, goal) => {
			const fnodes = Array.isArray((flow || {}).nodes) ? flow.nodes : [];
			const fedges = Array.isArray((flow || {}).edges) ? flow.edges : [];
			const byFlowId = new Map(fnodes.map((x) => [x.id, x]));
			const next = new Map();
			const add = (from, to) => { if (from && to && byFlowId.has(to)) next.set(from, [...(next.get(from) || []), to]); };
			for (const e of fedges) add(e.source, e.target);
			for (const x of fnodes) {
				const d = x.data || {};
				for (const r of d.rules || []) add(x.id, (r || {}).targetNodeId);
				add(x.id, d.fallbackNodeId);
				// A step response-pathway row without a variable is a draft the
				// compiler drops (toPathway.ts toStepResponsePathways) — not a route.
				for (const rp of d.responsePathways || []) if (String(((rp || {}).variable) || "").trim()) add(x.id, (rp || {}).targetNodeId);
				for (const t of d.tools || []) for (const rp of (t || {}).responsePathways || []) add(x.id, (rp || {}).targetId);
				add(x.id, d.targetNodeId);
				add(x.id, d.errorFallbackNodeId);
				// A warm transfer's "if agent unavailable → go to node" resume step (SERVER #11894).
				add(x.id, ((d.warmTransfer || {}).voicemailTargetStepId));
			}
			const seen = new Set();
			// A step-level global can fire while any step is active, but what it
			// reaches depends on its returnMode (SERVER toPathway.ts globalNodeData):
			// "redirect" lands on its forwardingNode; "manual" disables the
			// auto-return so the global's own drawn edges route onward; "previous"
			// returns to the interrupted step, so its drawn edges are never taken.
			// Seed from the start pill, every manual global, and every
			// redirect-global's forwarding node.
			const queue = fnodes.filter((x) => x.type === "start").map((x) => x.id);
			for (const x of fnodes) {
				if (!GLOBAL_CAPABLE.has(x.type)) continue;
				const g = (((x.data || {}).settings || {}).global) || {};
				if (g.isGlobal !== true) continue;
				if (g.returnMode === "manual") queue.push(x.id);
				else if (g.returnMode === "redirect" && byFlowId.has(g.forwardingNode)) queue.push(g.forwardingNode);
			}
			while (queue.length) {
				const id = queue.shift();
				if (seen.has(id)) continue;
				seen.add(id);
				if (goal(byFlowId.get(id))) return true;
				queue.push(...(next.get(id) || []));
			}
			return false;
		};
		// The exit pill must be REACHABLE from the Start pill — a drawn but
		// disconnected pill is no way back to the hub.
		const exitReachable = (n) => n.type === "scenario" || flowReaches((n.data || {}).flow, (x) => x && x.type === "end");

		// A0 — Start IS the Initialization code step. When the v1 start node is
		// Custom Code, the snapshot must carry it as `initialization` (runs at
		// connect, before the first sentence) with the same snippet pin / code.
		if (sourcePaths.length) {
			const starts = [];
			for (const sp of sourcePaths) for (const n of loadJson(sp).nodes || []) if (n && n.type === "Custom Code" && n.data && n.data.isStart === true) starts.push(n);
			if (starts.length) {
				const init = snap.initialization || {};
				const step = init.step || {};
				// Merged sources can each start with code; the plan's
				// initializationNode picks which one runs at connect (the
				// builder refuses a plan that leaves it ambiguous), so any of
				// them satisfies this check — never only the first source's.
				const matches = (n) => {
					const src = n.data || {};
					// Same pin AND same version when the source pins one — a
					// different version of the same snippet is different code.
					if (src.snippet_id) return step.snippetId === src.snippet_id && sameVersion(step.snippetVersion, src.snippet_version);
					return typeof step.code === "string" && step.code.trim() === String(src.code || "").trim();
				};
				const label = (n) => `"${(n.data || {}).name || n.id}" (${String((n.data || {}).snippet_id || "").slice(0, 8)}…)`;
				const pinOk = starts.some(matches);
				const ok = init.enabled === true && pinOk;
				check("A0", "v1 start code node carried as initialization (enabled, same snippet pin)", ok, ok ? "" : init.enabled === true ? `initialization pin matches none of the start code node(s) ${starts.map(label).join(", ")}` : `initialization missing/disabled — start node ${starts.map(label).join(" or ")} must run at connect, not inside a scenario`);
			}
		}

		// A1 — a Start scenario (inbound edge re-pointed off the hub) handles
		// CONNECTION gating only: call screeners, IVR / menu navigation,
		// voicemail detection and the voicemail message, carrier intercepts,
		// "is now a good time" availability checks, mid-call-drop resume. It
		// may speak for that. The call body — questions, offers, knowledge
		// answers, scheduling, verification, department transfers, every
		// caller-chosen outcome — belongs to hub children. Mechanically: no
		// core-logic step types, ≤ 1/3 of all steps (a Start of ≤4 steps is
		// always within budget — small pathways skew the share), and an exit
		// to the hub.
		if (entryTarget && entryTarget.type !== "agent") {
			const st = flowSteps(entryTarget);
			const core = st.filter((x) => CORE_LOGIC.has(x.type));
			const share = totalSteps ? st.length / totalSteps : 0;
			const hasExit = exitReachable(entryTarget);
			const problems = [];
			if (core.length) problems.push(`core-logic step(s) in Start: ${core.map((x) => `${name(x)} (${x.type})`).slice(0, 4).join(", ")} — knowledge, scheduling, verification and transfers (department handoffs included) are hub children`);
			if (st.length > 4 && share > 1 / 3) problems.push(`${st.length}/${totalSteps} steps (${Math.round(share * 100)}%) in Start — budget is a third; Start handles screeners / voicemail / IVR / availability, the call body is the hub's`);
			if (!hasExit) problems.push("no exit pill — the call can never reach the hub");
			check("A1", "Start scenario holds only connection gating (no knowledge/scheduling/verification/transfer steps; ≤ a third of steps; exits to hub)", problems.length === 0, `"${name(entryTarget)}": ${problems.join("; ")}`);
		} else {
			check("A1", "Start scenario holds only connection gating", true, "inbound edge targets the hub");
		}

		// A2 — intents are hub children: besides the Start scenario there must
		// be at least two hub-enterable siblings (scenarios or root end-calls),
		// and no single flow may hold more than 60% of all steps.
		// (No size cap on a single task scenario: v2-authoring allows one
		// continuous task behind a thin hub; caller CHOICES are what must not
		// live inside it, and that is a region-map judgment, not a step count.)
		const siblings = nodes.filter((n) => (n.type === "scenario" || n.type === "complex-scenario" || n.type === "end-call") && (!entryTarget || n.id !== entryTarget.id));
		check("A2", "intents are hub children (≥2 hub-enterable siblings beside Start)", siblings.length >= 2, `${siblings.length} sibling(s)`);

		// A3 — every root end-call is enterable: it carries an entry
		// description for the hub, and the hub is reachable at all (Start
		// exits — covered by A1's exit test, repeated here so the message names
		// the dead end-calls).
		const rootEnds = nodes.filter((n) => n.type === "end-call");
		const startExits = !entryTarget || entryTarget.type === "agent" || exitReachable(entryTarget);
		const deadEnds = rootEnds.filter((n) => !startExits || !String(((n.data || {}).entry || {}).description || "").trim());
		check("A3", "every root end-call is reachable (hub reachable + entry description present)", deadEnds.length === 0, deadEnds.map(name).join(", "));

		// A4 — universal escapes on every hold. The hold is evaluated before all
		// routing, so a hold that lacks one of these traps the call on the step.
		const ESCAPES = [
			["opt-out", /opt[- ]?out|do not call|stop calling|no longer (be |want to be )?(called|contacted)|remove .* list/i],
			["wrong person", /wrong (person|number)|not the (right|intended) person|isn'?t .* (who|the person)/i],
			["not interested", /not interested|no longer (interested|looking|in the market)|declin/i],
			["callback", /call ?back|call (me|them|you) (back|later)|better time/i],
			["transfer", /transfer|speak (to|with) (a|an|someone|a live|a human)|representative|live agent|human/i],
			["voicemail", /voicemail|voice ?mail|leave (a|your) message|the tone/i],
			["IVR", /\bivr\b|screen(er|ing)|automated (system|menu|assistant)|press \d|menu options/i],
		];
		// Required set = the escapes the v1 source itself handles anywhere (an
		// inbound agent with no voicemail lane is not asked to escape to one);
		// without a source, the caller-universal five.
		const UNIVERSAL = new Set(["opt-out", "wrong person", "not interested", "callback", "transfer"]);
		let required = ESCAPES.filter(([k]) => UNIVERSAL.has(k));
		if (sourcePaths.length) {
			const srcAll = sourcePaths.map((sp) => JSON.stringify(loadJson(sp))).join("\n");
			required = ESCAPES.filter(([, re]) => re.test(srcAll));
		}
		// A step-level global whose label/description names an escape covers
		// every hold that does not outrank globals with
		// settings.advanced.conditionOverridesGlobalPathway.
		const globalText = [];
		for (const sc of rootFlows) {
			for (const st of flowSteps(sc)) {
				const g = (((st.data || {}).settings || {}).global) || {};
				// Only the global's trigger fields decide when it fires; its name and spoken
				// prompt do not, so they must not count as escape coverage.
				if (g.isGlobal === true) globalText.push([g.label, g.description].map((x) => String(x || "")).join("\n"));
			}
		}
		const globalCovers = (re) => globalText.some((t) => re.test(t));
		const holdIssues = [];
		for (const sc of rootFlows) {
			for (const st of flowSteps(sc)) {
				const lw = String(((st.data || {}).loopWhile) || "").trim();
				if (!lw) continue;
				const outranks = ((((st.data || {}).settings || {}).advanced) || {}).conditionOverridesGlobalPathway === true;
				const missing = required.filter(([, re]) => !re.test(lw) && (outranks || !globalCovers(re))).map(([k]) => k);
				if (missing.length) holdIssues.push(`${name(sc)}/${name(st)} lacks ${missing.join(", ")}${outranks ? " (conditionOverridesGlobalPathway set, so globals cannot help)" : ""}`);
			}
		}
		check("A4", `every hold condition carries the escapes the source handles (${required.map(([k]) => k).join(", ")}), itself or via a step-level global the hold does not outrank`, holdIssues.length === 0, holdIssues.slice(0, 4).join("; "));

		// A5 — no parking lots.
		const PARK = /legacy|archived|unreachable|never enter|do not enter|don'?t enter|parking|dead code|retired|unused/i;
		const lots = rootFlows.filter((n) => PARK.test(name(n)) || PARK.test(String(((n.data || {}).entry || {}).description || "")));
		check("A5", "no parking-lot scenarios (dead v1 nodes are dropped in the report, never warehoused)", lots.length === 0, lots.map(name).join(", "));

		// A6 — every v1 node tag is carried as a settings.tag somewhere.
		if (sourcePaths.length) {
			const srcTags = new Set();
			for (const sp of sourcePaths) {
				const src = loadJson(sp);
				// A node v1 never reaches (behind an empty condition group) is dropped
				// with its tag.
				const unreachable = unreachableBehindEmptyGroups(src.nodes, src.edges);
				for (const n of src.nodes || []) {
					if (n && unreachable.has(n.id)) continue;
					const t = ((n && n.data) || {}).tag;
					if (t && typeof t.name === "string" && t.name.trim()) srcTags.add(t.name.trim());
				}
			}
			const snapTags = new Set();
			(function collectTags(o) {
				if (Array.isArray(o)) return o.forEach(collectTags);
				if (!o || typeof o !== "object") return;
				if (o.settings && o.settings.tag && typeof o.settings.tag.name === "string") snapTags.add(o.settings.tag.name.trim());
				Object.values(o).forEach(collectTags);
			})(snap);
			// Tags on nodes the report DROPS (with reachability evidence) are
			// declared in --dropped-tags <json: [{"tag","reason"}] or ["tag"]>;
			// the hook passes .norm/dropped-tags.json when present.
			const missingTags = [...srcTags].filter((t) => !snapTags.has(t) && !declaredDropTags.has(t));
			check("A6", "every v1 node tag carried as settings.tag (or declared dropped in --dropped-tags)", missingTags.length === 0, missingTags.join(", "));
		}
	}

	const passed = checks.every((c) => c.passed);
	process.stdout.write(`${JSON.stringify({ passed, checks }, null, 2)}\n`);
}

module.exports = { unreachableBehindEmptyGroups };

if (require.main === module) {
	try {
		main();
	} catch (e) {
		process.stdout.write(JSON.stringify({ passed: false, error: String(e && e.message) }));
		process.exitCode = 2;
	}
}
