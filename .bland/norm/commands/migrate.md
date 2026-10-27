---
description: Migrate a Bland v1 pathway or persona (raw JSON export) into a v2 agent, end to end — discovery, architecture, verbatim snapshot authoring, mechanical audit, push, and simulation verification. Use when the user wants to migrate, convert, or port a v1 pathway/persona to a v2 agent.
argument-hint: "<path to v1 export JSON (and persona JSON), target agent id or org>"
allowed-tools:
  - "mcp__plugin_norm_bland__*"
  - "Task"
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
  - "Bash"
  - "WebFetch"
---

# /norm:migrate — v1 → v2 hand migration

Run the full migration doctrine. The knowledge lives in this plugin's skills — load ALL FOUR before doing anything: `v2-migration` (doctrine + `references/traps.md`, read the traps in full), `v2-snapshot` (the target dialect), `v2-runtime` (behavior you must preserve), `v2-testing` (verification). Inside a subagent, Read the skill files from `${CLAUDE_PLUGIN_ROOT}/skills/` directly.

Request:

```text
$ARGUMENTS
```

## Ground rules (hard)

- v1 resources are READ-ONLY and live. Never modify a pathway, persona, snippet, or tool. Exported secrets are live credentials — never print them; flag rotation.
- Additive only: you produce agent versions. Number attach/cutover is out of scope — refuse it.
- API surface: `GET` reads of the v1 export if not provided as files, `POST /v2/agents/:id/versions` for pushes, `/v1/agent-testing/*` and the test-chat WebSocket for verification. The key must belong to the OWNING org.
- No test that can fire a write-side integration (scheduler, CRM write, gate, outbound event) without an explicit safety plan the user approved.
- **Org-identity smoke check before the FIRST write**: multiple Bland connections can coexist in one session (a project-scoped server + this plugin's). Namespace alone proves nothing. Before pushing a version or creating scenarios, call `list_agents` (or `get_bland_mcp_setup`) through THIS plugin's server (`mcp__plugin_norm_bland__*`) and confirm the target agent id exists there and the org matches the engagement. On any mismatch, STOP and ask — a write into the wrong organization is the incident class this rule exists to prevent (BLA-7919).

## The convergence loop (enforced — not optional)

This command runs under a Stop-hook gate: once you initialize the loop, **the session will not let you finish until the migration is complete**. On every stop attempt the hook re-runs the deterministic v1-parity audit live and checks the push/sim gates; failures are re-fed to you as your next instruction. Complete = audit green AND a version pushed after the last snapshot edit AND the full sim suite recorded green on that exact head.

Initialize it as soon as the snapshot file exists (end of phase 3):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/norm-migration-state.cjs" init \
  --snapshot snapshot.json --source v1-export.json [--persona persona.json] \
  --agent <agentId> --max 12
```

Record progress as it happens (the hook trusts only these records):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/norm-migration-state.cjs" record-push --head <versionId>
node "${CLAUDE_PLUGIN_ROOT}/bin/norm-migration-state.cjs" record-sims --head <versionId> --passed true|false [--failing "a;b"]
node "${CLAUDE_PLUGIN_ROOT}/bin/norm-migration-state.cjs" ack-uncovered --lane "<lane>: <why untestable>"
```

Any snapshot edit after a push automatically stales the head (gate 2) and resets the sim gate — that is the point: no result counts unless it ran on the bytes you're shipping. The audit itself is runnable any time:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/norm-migrate-audit.cjs" --snapshot snapshot.json --source v1-export.json [--persona persona.json]
```

Never game the gates: recording `--passed true` for a sweep you didn't run, or ack-ing a lane that was merely inconvenient, defeats the migration's only proof. The loop releases on complete, max-iter, stall (same failures 3 evaluations running), or 24h TTL — a release by anything other than "complete" goes in the report as an incomplete migration.

## Phases — each gates the next

1. **Discover.** Census the export(s): node-type counts, orphans, dangling edge targets, the synthetic `global-prompt` node. Build the integration catalog (webhooks + auth, snippets + pinned versions, transfers, SMS, KBs, secrets, terminals) and classify each integration read vs write. Derive the request-data contract (consumed-never-produced variables, including any typo'd keys — carry them bug-for-bug). For personas: capture `personality_prompt`, `pathway_conditions`, `call_config`.
2. **Architect.** Region map → scenario list (every node in exactly one region; a tight loop lives in ONE flow). Hub source (triage node verbatim, or persona prompt = natural entry). Entry descriptions VERBATIM from source routing conditions. Each End Call becomes an `end-call` step in the flow of the node that routes to it (the builder does this); add a root end-call only for a hang-up the hub decides. A disposition for every legacy node id. Present this architecture to the user briefly before authoring.
3. **Author.** You author only JUDGMENT — a small `plan.json` (scenario membership, entry descriptions, hub prompt, system prompt assembled verbatim from the sources, and optional `voice` / `language` when the source persona does not carry them). The builder does ALL mechanical carriage:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/norm-materialize.cjs" --plan plan.json --out snapshot.json
   ```

   It carries every byte from the v1 export(s): prompts, extraction variables, route rules (flat rows = OR, isGroup = AND, fallbacks from source), transfers with warm-transfer config, webhooks (headers/response mappings converted to the snapshot dialect), snippet pins, attached tools — and automatically re-represents `type:"code"` node tools as code step + route step. It namespaces node ids when merging multiple graphs, emits one exit edge per distinct label, appends the scenario directory to the hub prompt, and prints warnings you MUST read (uncovered nodes, code-tool input maps to review, cross-scenario tool targets cleared). Never hand-write flow JSON when the builder can carry it; edit the plan (or, for genuine hardening, the built snapshot) — not the mapping.
4. **Audit.** Run the `/norm:validate` checklist on the finished snapshot. Every check green before any push — including the pin grep: every source snippet id and tool id must appear in the final JSON.
5. **Push.** Before the FIRST push of a session, state what you are about to do — target agent id, the org identity confirmed by the smoke check, and the version name — and, in an interactive session, get an explicit go-ahead (autonomous/benchmark runs may declare autonomy in the brief instead; note it in the report). Then `POST /v2/agents/:agentId/versions` with `{"snapshot": ..., "name": "<meaningful version name>"}` into the owning org. Versions are additive (never destructive), but a push is still a persistent write into a customer org. A validation rejection is your authoring bug — fix and re-audit.
6. **Verify.** Run `/norm:simulate`: a suite of ~1 scenario per terminal/lane with completable personas and safety rails, judges worded per `v2-testing`, graded on engine traces, 3 reps on flappers, full-suite sweep green on one head. Then targeted test-chat probes for mechanics. Two disciplines that decide whether verification converges:
   - **Fixture discovery FIRST**: find the request data the customer's own test scenarios use for THIS pathway (group their existing scenarios by target pathway), and verify the fixture actually hydrates by tracing the bootstrap's debug/HTTP calls before grading any agent behavior. A stale or wrong-variant fixture produces failure clusters that look exactly like migration bugs.
   - **v1 differential baselines**: for any repeated failure, clone the scenario onto the v1 pathway and rep both. v1-solid + v2-failing = real regression (fix, at the construct level if prompt rules fail twice — see `silentPills`); v1-failing-identically = inherited variance (tighten the judge to v1's real bar, document the rate).
   Hardening goes through the builder's evidence-based hooks — `promptAppends`, `variableAppends`, `silentPills` in plan.json — never hand-edits to the snapshot, so every hardening decision is reviewable in the plan. After any snapshot change, drain write-side test artifacts (bookings etc.) with the customer's own cleanup utilities and verify at tool level.
7. **Report.** Dispositions · documented behavioral deltas · carried v1 defects · request-data contract · security flags (plaintext credentials) · and the explicit list of lanes NOT provable without the customer (data-gated lanes, write smokes). Never present the sim count as full coverage if a gated lane went unexercised.

## One-shot discipline

The goal is a working agent on the FIRST pushed version. That happens when: the traps file was read before authoring (not after a failure), all carriage is programmatic, the audit ran before the push, and sims are graded against the source system's real behavior. When a sim fails, classify (harness artifact / judge flake / routing flake / real bug) from the engine trace before touching anything — most first-batch failures are the harness, not the agent.
