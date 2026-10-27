#!/usr/bin/env node
"use strict";

/**
 * Norm v2 — migration convergence-loop state manager.
 *
 * Backs /norm:migrate and the Stop-hook gate (hook-migrate-loop.cjs). State
 * lives at <project>/.norm/migration.json. The loop is complete only when:
 *   audit green (the hook re-runs it live)  AND
 *   a version was pushed AFTER the last snapshot edit  AND
 *   the sim suite is recorded green ON THAT PUSHED HEAD.
 *
 * Subcommands:
 *   init --snapshot <file> [--source <file>]... [--persona <file>] \
 *        [--agent <id>] [--max N]                     start/replace the loop
 *   record-push --head <versionId>                    a version was pushed
 *   record-sims --head <versionId> --passed true|false [--failing "a;b"]
 *   ack-uncovered --lane "<name>: <why>"              record an untestable lane
 *   status                                            print state
 *   stop                                              deactivate
 */

const fs = require("node:fs");
const path = require("node:path");

function projectDir() {
	if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
	let dir = process.cwd();
	for (let i = 0; i < 8; i += 1) {
		if (fs.existsSync(path.join(dir, ".norm"))) return dir;
		const p = path.dirname(dir);
		if (p === dir) break;
		dir = p;
	}
	return process.cwd();
}

const NORM_DIR = path.join(projectDir(), ".norm");
const STATE = path.join(NORM_DIR, "migration.json");
const argv = process.argv.slice(2);
const sub = argv[0];

function flag(name) {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
}
function flagAll(name) {
	const out = [];
	for (let i = 1; i < argv.length; i += 1) {
		if (argv[i] === `--${name}` && argv[i + 1]) out.push(argv[i + 1]);
	}
	return out;
}
function load() {
	try {
		return JSON.parse(fs.readFileSync(STATE, "utf8"));
	} catch {
		return null;
	}
}
function save(s) {
	fs.mkdirSync(NORM_DIR, { recursive: true });
	s.updated_at = Date.now();
	fs.writeFileSync(STATE, `${JSON.stringify(s, null, 2)}\n`);
	process.stdout.write(`${JSON.stringify(s, null, 2)}\n`);
}

if (sub === "init") {
	const snapshot = flag("snapshot");
	if (!snapshot) {
		process.stderr.write("--snapshot required\n");
		process.exit(1);
	}
	// Scoping guard: never silently clobber another session's ACTIVE loop.
	const prior = load();
	if (prior && prior.active === true && !argv.includes("--force")) {
		process.stderr.write(`an ACTIVE migration loop already exists (agent ${prior.agent_id || "?"}, snapshot ${prior.snapshot}). Finish it, run 'stop', or re-init with --force.\n`);
		process.exit(1);
	}
	// Drop declarations (dropped-tags.json, read by audit A6) are per
	// migration: a tag one source dropped is not dropped for the next.
	const droppedTags = path.join(NORM_DIR, "dropped-tags.json");
	if (fs.existsSync(droppedTags)) {
		fs.rmSync(droppedTags);
		process.stderr.write("cleared .norm/dropped-tags.json from the previous migration; declare this one's drops afresh\n");
	}
	save({
		active: true,
		created_at: Date.now(),
		session_id: process.env.CLAUDE_SESSION_ID || "",
		snapshot: path.resolve(snapshot),
		sources: flagAll("source").map((p) => path.resolve(p)),
		persona: flag("persona") ? path.resolve(flag("persona")) : "",
		agent_id: flag("agent") || "",
		max_iter: Number(flag("max") || 12),
		iter: 0,
		stall_count: 0,
		last_failure_sig: "",
		push: { head: "", at: 0 },
		sims: { head: "", passed: false, failing: [], at: 0 },
		uncovered: [],
		released: "",
	});
} else if (sub === "record-push") {
	const s = load();
	if (!s) process.exit(1);
	const agent = flag("agent");
	if (agent && s.agent_id && agent !== s.agent_id) {
		process.stderr.write(`agent mismatch: state is for ${s.agent_id}, record targeted ${agent}. Refusing.\n`);
		process.exit(1);
	}
	s.push = { head: flag("head") || "", at: Date.now() };
	s.sims = { head: "", passed: false, failing: [], at: 0 };
	save(s);
} else if (sub === "record-sims") {
	const s = load();
	if (!s) process.exit(1);
	const agent2 = flag("agent");
	if (agent2 && s.agent_id && agent2 !== s.agent_id) {
		process.stderr.write(`agent mismatch: state is for ${s.agent_id}, record targeted ${agent2}. Refusing.\n`);
		process.exit(1);
	}
	s.sims = {
		head: flag("head") || "",
		passed: String(flag("passed")) === "true",
		failing: String(flag("failing") || "")
			.split(";")
			.map((x) => x.trim())
			.filter(Boolean),
		at: Date.now(),
	};
	save(s);
} else if (sub === "ack-uncovered") {
	const s = load();
	if (!s) process.exit(1);
	const lane = flag("lane");
	if (lane && !s.uncovered.includes(lane)) s.uncovered.push(lane);
	save(s);
} else if (sub === "status") {
	const s = load();
	process.stdout.write(`${JSON.stringify(s || { active: false }, null, 2)}\n`);
} else if (sub === "stop") {
	const s = load() || {};
	s.active = false;
	s.released = s.released || "manual stop";
	save(s);
} else {
	process.stderr.write("subcommands: init | record-push | record-sims | ack-uncovered | status | stop\n");
	process.exit(1);
}
