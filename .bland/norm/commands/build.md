---
description: Build a NEW Bland v2 agent from scratch — with a human-in-the-loop gate that first confirms whether the user wants a v1 pathway or a v2 agent, then loads the v2 authoring doctrine and drives design → snapshot → push → verify. Use when the user wants to create, build, or design a new voice/chat agent and the platform version is v2 or unstated.
argument-hint: "<what the agent should do>"
allowed-tools:
  - "Task"
  - "AskUserQuestion"
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
  - "Bash"
  - "mcp__plugin_norm_bland__*"
---

# /norm:build — new v2 agent, human-in-the-loop

Request:

```text
$ARGUMENTS
```

## Step 0 — THE VERSION GATE (never skip)

Building a v1 pathway and building a v2 agent are DIFFERENT disciplines with different primitives, endpoints, and doctrine. Before loading any doctrine or touching any API:

1. If the request already names the platform version explicitly ("v2 agent", "agent snapshot", "v1 pathway", a pathway id, an agent id) — proceed accordingly.
2. Otherwise **ask the user ONE question and wait**. On Claude Code use AskUserQuestion; on hosts without it (Codex, Cursor, Grok), ask in plain text and END YOUR TURN — do not proceed on an assumed answer:
   > "Should this be a **v2 agent** (the new agent platform — hub + scenarios, recommended for new builds) or a **v1 pathway** (the classic node-graph builder)?"
3. **v1 answer** → this plugin does not carry v1 authoring doctrine, on purpose. Hand off: if the `bland` (v1) plugin is installed, tell the user to run `/bland:norm <request>`; if not, tell them to install it (`/plugin install bland@bland`). Do NOT attempt v1 building from here — that cross-contamination is exactly what this plugin exists to prevent.
4. **v2 answer** → load the `v2-authoring` skill (plus `v2-snapshot` for the dialect and `v2-runtime` for behavior) and continue below.

## Org-identity smoke check (before the first write)

Multiple Bland connections can coexist in one session; namespace alone proves nothing. Before `create_agent` or any version push, call `list_agents` through THIS plugin's server (`mcp__plugin_norm_bland__*`) and confirm the org is the one the user intends (name a known agent back to them if unsure). On mismatch, stop and ask (BLA-7919).

## v2 build phases

1. **Design interview.** Nail the call's real structure before JSON: what the agent owns end-to-end, the distinct caller intents, which parts are one continuous task (ONE scenario) vs genuinely separate one-way lanes (scenario per lane), every integration (read vs write), the per-call data contract (request data), transfer destinations, close conditions. Present the scenario architecture in a short table and get a nod before authoring.
2. **Author the snapshot** per `v2-authoring` + `v2-snapshot`: settings.systemPrompt (persona + conduct rules — include the standard no-fabrication set), hub prompt + entries, scenario flows (steps, edges, tools), root end-calls. For anything mechanical that exists as v1 JSON already, use `bin/norm-materialize.cjs` instead of hand-writing.
3. **Audit**: `/norm:validate` structural + routing-crash checks (skip the vs-source parity checks — there is no v1 source).
4. **Create + push**: `create_agent` (or the user's existing agent id) → `save_agent_version` / `POST /v2/agents/:id/versions` with a named version.
5. **Verify**: `/norm:simulate` — full-coverage suite from the design's lanes + the standard conduct probes (no invented times/numbers/bookings, no callback promises, AI disclosure, chant escalation), write-tool temptation probes, green sweep on one head.
6. **Convergence loop (recommended)**: the migrate loop works in BUILD MODE — init the state with NO `--source` (`node "${CLAUDE_PLUGIN_ROOT}/bin/norm-migration-state.cjs" init --snapshot snapshot.json --agent <id>`): the Stop-hook then gates on the STRUCTURAL audit (parity checks skip with no source) + push-after-edit + sims-green-on-head, same as migrations.
7. **Lifecycle**: load [v2-lifecycle](../skills/v2-lifecycle/SKILL.md) and follow
   the supported release mode: publish to staging then promote, or an explicitly
   selected exact-version promotion. State the org and exact candidate before
   changing live traffic; approval to save is not approval to promote. Respect
   the user's explicit authorization and the host's permission policy. Verify
   the current staging check policy and candidate results; pending/failed required
   checks block current-server promotion. Do not add `force` or weaken checks to
   get around a failure. Test-chat defaults to dev, not production. Verify all
   referenced environment values for the environment taking traffic and read
   back the resulting pins/deployment history. No production pin can fail calls;
   inbound fallback behavior is separately described in the lifecycle skill.
