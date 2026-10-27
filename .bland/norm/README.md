# Norm for v2 Agents

The v2-only Bland plugin: build, migrate, validate, and test v2 agents working directly with raw JSON — v1 pathway exports as migration inputs, agent version snapshots as the output. No markdown scaffolding, no v1 authoring doctrine.

It also supplies a local [product wiki](skills/api-workspace/references/index.md)
for API-first workspace work, evaluation judges, call analysis, and debugging.
The plugin owns this reusable product knowledge; the host provides execution,
credentials, and optional dashboard/voice bridges.

## Codex-native knowledge, loaded as needed

- Short `SKILL.md` entrypoints make tasks discoverable; detailed files live under
  each skill's `references/` directory inside the plugin archive.
- Start from the wiki index or the relevant skill. Read the necessary references
  on demand—do not inject the whole wiki or all call data into every prompt.
- Work on JSON and large datasets with workspace files and code. Read/change
  platform resources through the existing Bland MCP/API connection. Dashboard
  effects reflect accepted work rather than replace the API.
- Current tool schemas and official docs remain authoritative for requests;
  this package is not an exhaustive offline API schema or a new SDK.
- No additional MCP server, runtime service, dependency, or credential is added.
- Updating this repository does not update a pinned managed runtime. Its owner
  must refresh the approved plugin revision/file inventory and test the packaged
  artifact separately. This is not an automatic deployment.

## Quickstart: migrate a v1 pathway

One prompt does everything, including installing this plugin. You need a Bland API key for the org that owns the pathway; the pathway ID is in the pathway's URL in the dashboard. Fill in the two blanks and paste into Claude Code:

```text
Migrate my Bland v1 pathway <PATHWAY_ID> into a new v2 agent named "<AGENT NAME>".

If the Bland migration plugin is not available in this session (no /norm:migrate
command), set it up for me:
  claude plugin marketplace add CINTELLILABS/bland-plugins
  claude plugin install norm@bland
Do not ask me for my API key in this chat, ever. If norm@bland cannot be installed,
stop and tell me what failed — do not substitute a different plugin or command.
After installing, tell me to run /plugin configure norm@bland to enter my key,
restart the session, and paste this same prompt again.

If the plugin IS available, run the /norm:migrate command with this request: fetch
the pathway export through the Bland MCP server, show me the proposed scenario
architecture before authoring anything, ask me before the first version push, and
finish with the full simulation suite and the migration report.
```

First paste on a fresh machine: Claude installs the plugin, then you enter your key (`/plugin configure norm@bland` — stored by the host, never in the conversation), restart, and paste the same prompt again to start the migration. Already set up: the first paste goes straight into the migration.

The session discovers the pathway, proposes the scenario architecture for your approval, carries your content byte-for-byte into a v2 snapshot, audits it against the source, pushes it as a new agent version (asking first), and verifies it with simulations. Migration is additive: your v1 pathway, numbers, and live traffic are never modified. Full walkthrough: [docs.bland.ai — Migrate a v1 pathway to a v2 agent](https://docs.bland.ai/platform/migrate-v1-to-v2).

## Commands

| Command | What it does |
|---|---|
| `/norm:build` | Build a NEW v2 agent — starts with a human-in-the-loop gate (v1 pathway or v2 agent?); v1 answers route to the v1 plugin, v2 answers load the authoring doctrine and drive design → snapshot → push → verify. |
| `/norm:migrate` | Full v1 pathway/persona → v2 agent hand migration: discover → architect → author verbatim → audit → push → simulate. One-shot oriented; every known trap is a pre-push check. |
| `/norm:validate` | Mechanical audit of a snapshot JSON: structure, routing-crash checks, pin presence against the v1 source, exit-label discipline. |
| `/norm:analytics` | Analytics page work for the agent in view: build, edit or simplify the Sankey through a waypoint definition, or build a conversation cohort ("show me the calls where…") and open it on the Conversations page. |
| `/norm:simulate` | Simulation + test-chat verification loop with safety rails for live integrations and engine-trace grading. |

## The convergence loop (enforced)

`/norm:migrate` doesn't rely on the model choosing to iterate — a Stop hook gates the session until the migration is actually complete:

```
author snapshot ──► gate 1: AUDIT  (hook re-runs bin/norm-migrate-audit.cjs live:
        ▲                          structure + routing-crash + byte-parity vs the v1 source)
        │                 ▼ green
   failures re-fed    gate 2: PUSH  (a version recorded AFTER the last snapshot edit —
   as next            ▼ green        editing the snapshot stales the head automatically)
   instruction        gate 3: SIMS  (full suite recorded green ON that exact head)
        │                 ▼ green
        └────────────  RELEASE (complete)
```

- `bin/norm-materialize.cjs` — the deterministic BUILDER: the agent authors only judgment (a small `plan.json` — scenario membership, entries, hub + system prompt) and this script carries every byte of content from the v1 export(s) into the snapshot: prompts, extraction variables, route rules (flat = OR, isGroup = AND, fallbacks from source), transfers, webhooks, snippet pins, attached tools, automatic code-tool re-representation, id namespacing, per-label exit edges. Proven by rebuilding a shipped production migration from raw JSON alone: byte-class identical structure (same step census, same pins), passes the platform's own validator, and compiles to the identical graph (82 nodes / 143 edges) the in-repo pipeline produced.
- **Hardening hooks in the plan** — `promptAppends`, `variableAppends`, `silentPills`: evidence-based fixes discovered during the sim loop live in plan.json (reviewable), never as hand-edits to the snapshot. `silentPills` is the construct fix for a carried silent-router that fabricates speech as an in-flow step — proven in production when escalating prompt rules failed four runs straight.
- `bin/norm-migrate-audit.cjs` — the deterministic checker: machine checks including hollow by-reference tools, edge-condition vocabularies, pin-presence against every v1 snippet/tool id, OR-collapse and null-fallback scans, code-tool re-representation, verbatim prompt carriage. No model judgment.
- `bin/norm-migration-state.cjs` — loop state (`.norm/migration.json`): `init` / `record-push` / `record-sims` / `ack-uncovered` / `status` / `stop`.
- `bin/hook-migrate-loop.cjs` — the Stop gate. Fail-soft (never wedges a session); releases on complete, max-iter, stall (same failures 3 evaluations running), or 24h TTL — any release other than "complete" is reported as an incomplete migration.

## Skills (the knowledge base)

Written for agents WITHOUT access to the Bland platform source — everything is documented at the level of observable behavior and public API surfaces.

- **api-workspace** — wiki index, generic API primitives, authentication boundaries,
  async recovery, workspace versus unsaved/saved state, execution-order overview,
  option navigation, and evidence-first debugging.
- **evaluations** — judge identity versus rubric versions, calibration, scenario
  attachments, simulation scoring, call-cohort runs, and execution versus verdict
  failures.
- **[analytics-authoring](skills/analytics-authoring/SKILL.md)** — the agent's analytics Sankey: waypoint groups and stages, parallel branches, the customer waypoint-definition API (read, validate, pending, preview, publish), what each view draws, and the boundary with dispositions.
- **[analytics-cohorts](skills/analytics-cohorts/SKILL.md)**: conversation cohorts. Covers the `where` predicate grammar over lake columns, an offline predicate validator, create, poll and ids routes, the Conversations page hand-off, what a predicate cannot express, and the customer-metric routes that are not live yet.
- **call-analysis** — bounded call retrieval, offset pagination, reproducible
  cohorts, workspace analysis, evidence-linked categories, and report artifacts.

- **v2-authoring** — building NEW agents: what scenarios represent (boundaries at one-way seams), hub/entry authoring, the standard conduct-rule set (every rule from a real production incident), deterministic-where-it-matters, and the v1→v2 mental shift table.
- **[v2-maintenance](skills/v2-maintenance/SKILL.md)** — update and debug existing
  agents: minimal stable-ID edits, unsaved-draft reconciliation, concurrency
  fences, ambiguous-write recovery, exact-version tests, and lifecycle guidance.
- **v2-snapshot** — the exact snapshot dialect (behavior graph, hub, scenarios, step types, tools, settings) and hand-authoring rules.
- **v2-runtime** — routing and runtime behavior, plus the JSON → builder →
  executable-pathway mapping: implicit entry/sibling/return routes, component
  boundaries, inspector-only routes, global-node returns, and audio versus
  routing interruptions. Documents retained settings that no longer execute.
- **v2-migration** — the migration doctrine + the trap catalog accumulated across production migrations (`references/traps.md`).
- **v2-testing** — the agent-testing API, test-chat WebSocket, grading discipline,
  testing-safety rules, and speech-to-speech evidence (interruption, actual
  playback, response timing, and adaptive versus deterministic callers).
- **v2-lifecycle** — environments, exact-version promotion, saved promotion-check
  policy, rollback, channel/version selection, branches, experiments, variables,
  number binding, identity, memory, library/history and migration endpoints.
  Includes an API map and separate-resource lifecycle guide.
  Rollouts (the Experiments page) and voice selection live in its references.
  Variables, checks and branches as workflows: `agent-environments`.
- **[agent-environments](skills/agent-environments/SKILL.md)** — the Environments page: `{{env.KEY}}` values per environment with an unresolved-key pre-flight before a promote, the staging check policy, runs and verdicts that gate promotion (never forced), and branch, test, rebase and merge.
- **[agent-launch](skills/agent-launch/SKILL.md)** — take an agent from built to live in the right order: knowledge, tools, voice, staging and simulations, promote, then number and channels, with a nine-item checklist and a read-only "what is left" pass.
- **[phone-numbers](skills/phone-numbers/SKILL.md)** — who answers a number, putting an agent on a number safely (owner check, v1 cutover warning, `only_if_unassigned`), per-number live settings, blocked callers and DNC, SIP trunk diagnostics; buying, release, porting and carrier submissions are confirm-gated or handed to the dashboard.
- **[knowledge-sources](skills/knowledge-sources/SKILL.md)** — teach the agent from a document, site or file link (ingest, poll, verify, attach by scope), test a source with answerable and absent questions, update a source by type, close the loop on unanswered questions, explain what was retrieved on a call, delete a source only after naming every agent that uses it.
- **[agent-channels](skills/agent-channels/SKILL.md)** — publish a web chat widget, turn on API chat (it reads production, so promote), configure a number's texting, send or take over a text with a required confirm.
- **[outbound-calls](skills/outbound-calls/SKILL.md)** — call a person or run a batch with a v2 agent: version selector and caller id echoed back, rate-limit and DNC pre-flight, one-row canary, watch and stop.
- **[automations](skills/automations/SKILL.md)** — triggers, alerts and post-call webhooks: create inactive, test with the mock step instead of dialing, diagnose runs, resend deliveries.
- **[tool-library](skills/tool-library/SKILL.md)** — create and prove a tool (the HTTP 0 trap), custom code saved as a pinned snippet version, change a shared tool only after finding every consumer across latest and pinned versions, debug a run from tool logs, delete a tool only after naming its consumers, secrets by id, connect or disconnect an integration with its blast radius named.
- **[dispositions](skills/dispositions/SKILL.md)** — the Dispositions page: post-call outputs produced on every completed call, built from extractors, judges, agent variables or custom code, tested on real calls, published with a billing acknowledgement, calibrated with corrections and align, backfilled onto past calls, and migrated from v1 citations and outcomes.
- **[triage-issues](skills/triage-issues/SKILL.md)** — file an issue from a bad call with its evidence, work and link issues, never write `@norm` into a comment.

The [full v2 surface map](skills/api-workspace/references/surface-map.md) also
indexes the complete node-family catalog, verification zones, execution phases,
tools/handoffs, collaboration, dispositions, and ancillary operational APIs.
It identifies where live schema discovery is required rather than promising
every feature is enabled or every future endpoint is documented offline.

## Organization safety

- The plugin's MCP server is distinctly named (`plugin_norm_bland` on hosts without automatic prefixing), and every `/norm:*` command allowlists ONLY the plugin's own namespaced server — never a bare `mcp__bland__*` wildcard that could resolve to a project-scoped server in another organization.
- `bland_api_key` is OPTIONAL — but understand the keyless mode: the plugin's own MCP server cannot authenticate without it, so commands run in local-tools mode (builder, audit, loop) and any API phase either needs the key configured or an explicit per-call human approval of a project-supplied Bland connection (such tools are outside the commands' allowlists ON PURPOSE — the human approval prompt IS the cross-org safety gate).
- Commands run an org-identity smoke check (`list_agents` through the plugin's server, confirm the target lives there) before the first write — identity is validated by evidence, not namespace.

## Cross-host behavior (Claude Code, Codex, Cursor, Grok)

Manifests ship for all four hosts (`.claude-plugin/`, `.codex-plugin/`, `.cursor-plugin/`, `.grok-plugin/`), mirroring the v1 plugin's pattern — same skills, same MCP server, per-host auth style (Claude userConfig, Codex `bearer_token_env_var`, Cursor variables, Grok env expansion).

Two capabilities degrade gracefully off Claude Code:

- **The v1-or-v2 question gate** (`/norm:build` step 0) uses Claude's AskUserQuestion when available; on every other host it's the same gate as a plain question — the instructions say ask ONE question and end the turn, which every interactive host supports.
- **The enforced convergence loop** (Stop hook) is Claude Code-only — other hosts don't run hooks. There, the loop is advisory: run `bin/norm-migrate-audit.cjs` and the state manager manually per the /norm:migrate procedure; the audit and builder are plain Node scripts and work everywhere.

## Relationship to the `bland` plugin

The original `bland` plugin covers the v1 surface (pathways, personas, and the file-workspace Norm builder). This plugin is intentionally separate so v2 work never inherits v1 doctrine. Install both if you work on both; v1 concepts appear here only as migration inputs.
