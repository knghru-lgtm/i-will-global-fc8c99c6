#!/usr/bin/env node
"use strict";

/**
 * Norm v2 — Stop hook: migration convergence gate.
 *
 * While a migration loop is active (<project>/.norm/migration.json), refuse to
 * let the turn end until ALL gates hold, re-feeding the concrete failures as
 * the next instruction (Stop-hook `decision:"block"` + `reason`):
 *
 *   gate 1  AUDIT   — re-run norm-migrate-audit.cjs LIVE against the snapshot
 *                     and the v1 source(s); any failing check blocks.
 *   gate 2  PUSH    — a version must be recorded AFTER the last snapshot edit
 *                     (snapshot mtime newer than the recorded push = stale head).
 *   gate 3  SIMS    — the sim suite must be recorded green ON the pushed head
 *                     (any snapshot change resets this via record-push).
 *
 * Termination is OUR job (no automatic infinite-loop guard exists): releases on
 * COMPLETE, max_iter, stall (identical failure signature 3 evaluations in a
 * row), or staleness (24h TTL). FAIL-SOFT: always exits 0; a crash or an
 * unreadable state never wedges the session.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TTL_MS = 24 * 60 * 60 * 1000;

function readStdin() {
	return new Promise((resolve) => {
		let buf = "";
		const t = setTimeout(() => resolve(buf), 200);
		if (t.unref) t.unref();
		try {
			process.stdin.setEncoding("utf8");
			process.stdin.on("data", (c) => {
				buf += c;
			});
			process.stdin.on("end", () => {
				clearTimeout(t);
				resolve(buf);
			});
			process.stdin.on("error", () => {
				clearTimeout(t);
				resolve(buf);
			});
		} catch {
			clearTimeout(t);
			resolve(buf);
		}
	});
}

function findStateFile() {
	let dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
	for (let i = 0; i < 8; i += 1) {
		const f = path.join(dir, ".norm", "migration.json");
		if (fs.existsSync(f)) return f;
		const p = path.dirname(dir);
		if (p === dir) break;
		dir = p;
	}
	return null;
}

function out(obj) {
	try {
		process.stdout.write(`${JSON.stringify(obj)}\n`);
	} catch {
		/* fail soft */
	}
}

function saveState(file, s) {
	try {
		s.updated_at = Date.now();
		fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
	} catch {
		/* fail soft */
	}
}

async function main() {
	let payload = {};
	try {
		const raw = await readStdin();
		if (raw && raw.trim()) payload = JSON.parse(raw);
	} catch {
		/* fail soft */
	}

	const stateFile = findStateFile();
	if (!stateFile) return;
	let s;
	try {
		s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
	} catch {
		return;
	}
	if (!s || s.active !== true) return;
	if (s.session_id && payload.session_id && s.session_id !== payload.session_id) return;
	if (Date.now() - (s.updated_at || s.created_at || 0) > TTL_MS) {
		s.active = false;
		s.released = "ttl";
		saveState(stateFile, s);
		return;
	}
	if ((s.iter || 0) >= (s.max_iter || 12)) {
		s.active = false;
		s.released = "max_iter";
		saveState(stateFile, s);
		return;
	}

	const failures = [];

	// gate 1 — live audit
	let auditOk = false;
	try {
		const auditBin = path.join(__dirname, "norm-migrate-audit.cjs");
		const cmd = ["--snapshot", s.snapshot];
		for (const src of s.sources || []) cmd.push("--source", src);
		if (s.persona) cmd.push("--persona", s.persona);
		// Drop declarations belong to one migration: `init` clears the file,
		// and one older than this loop (left by a hand-edited state) is ignored
		// rather than excusing a live tag of the same name.
		const droppedTags = path.join(path.dirname(stateFile), "dropped-tags.json");
		let droppedAt = 0;
		try {
			droppedAt = fs.statSync(droppedTags).mtimeMs;
		} catch {
			droppedAt = 0;
		}
		if (droppedAt && droppedAt >= (s.created_at || 0)) cmd.push("--dropped-tags", droppedTags);
		const r = spawnSync(process.execPath, [auditBin, ...cmd], { encoding: "utf8", timeout: 30000 });
		const verdict = JSON.parse(r.stdout || "{}");
		if (verdict.passed === true) {
			auditOk = true;
		} else if (Array.isArray(verdict.checks)) {
			for (const c of verdict.checks) {
				if (!c.passed) failures.push(`AUDIT ${c.id} ${c.name}: ${c.detail || "failed"}`);
			}
		} else {
			failures.push(`AUDIT unreadable: ${String(verdict.error || r.stderr || "no output").slice(0, 200)}`);
		}
	} catch (e) {
		failures.push(`AUDIT crashed: ${String(e && e.message).slice(0, 160)}`);
	}

	// gate 2 — pushed head fresher than the snapshot file
	let pushOk = false;
	if (auditOk) {
		const head = (s.push || {}).head;
		const pushedAt = (s.push || {}).at || 0;
		let snapMtime = 0;
		try {
			snapMtime = fs.statSync(s.snapshot).mtimeMs;
		} catch {
			/* audit already covers unreadable snapshot */
		}
		if (!head) {
			failures.push("PUSH: no version pushed yet — POST the snapshot to /v2/agents/:id/versions and run: norm-migration-state.cjs record-push --head <versionId>");
		} else if (snapMtime > pushedAt) {
			failures.push(`PUSH: snapshot edited after the last push (head ${head} is stale) — push a new version and record-push again`);
		} else {
			pushOk = true;
		}
	}

	// gate 3 — sims green on the pushed head
	if (auditOk && pushOk) {
		const sims = s.sims || {};
		if (!(sims.passed === true && sims.head && sims.head === s.push.head)) {
			const failing = (sims.failing || []).join("; ");
			failures.push(
				sims.at
					? `SIMS not green on head ${s.push.head}${failing ? ` — failing: ${failing}` : sims.head !== s.push.head ? ` — last recorded on ${sims.head || "none"}` : ""}. Fix (harness artifact vs real bug — classify from the engine trace), rerun the FULL suite, then: norm-migration-state.cjs record-sims --head ${s.push.head} --passed true`
					: `SIMS: no simulation results recorded for head ${s.push.head} — run the /norm:simulate suite and record the sweep result`,
			);
		}
	}

	if (failures.length === 0) {
		s.active = false;
		s.released = "complete";
		saveState(stateFile, s);
		return;
	}

	// stall detection: identical failure signature 3 evaluations running
	const sig = failures.join("|").slice(0, 2000);
	if (sig === s.last_failure_sig) {
		s.stall_count = (s.stall_count || 0) + 1;
	} else {
		s.stall_count = 0;
	}
	s.last_failure_sig = sig;
	s.iter = (s.iter || 0) + 1;
	if (s.stall_count >= 2) {
		s.active = false;
		s.released = "stalled";
		saveState(stateFile, s);
		return;
	}
	saveState(stateFile, s);

	out({
		decision: "block",
		reason:
			`Migration loop ${s.iter}/${s.max_iter} — NOT complete. Fix these, in order, then end the turn again:\n- ` +
			failures.slice(0, 12).join("\n- ") +
			`\n\nRules: edit ONLY the snapshot/harness per the v2-migration skill (traps.md); content stays verbatim from the v1 source; after any snapshot change push a new version (record-push) — that resets the sim gate on purpose. Uncoverable lanes (data-gated/write-gated) must be recorded with ack-uncovered, not simulated around.`,
	});
}

main().catch(() => {
	/* fail soft: never wedge the session */
});
