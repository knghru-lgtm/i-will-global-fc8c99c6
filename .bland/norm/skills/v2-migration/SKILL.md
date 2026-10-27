---
name: v2-migration
description: The hand-migration doctrine for converting a Bland v1 pathway or persona (raw JSON export) into a v2 agent snapshot — architecture rules, verbatim-carriage discipline, the full trap catalog, and the verification bar. Use whenever migrating or converting v1 pathways/personas to v2 agents, or when a migrated agent misbehaves. The /norm:migrate command drives this skill end to end.
---

# Migrating v1 Pathways and Personas to v2 Agents

> **Server binding (v1/v2 isolation):** all API work in this skill goes through THIS plugin's MCP server only (`plugin_norm_bland` — `mcp__plugin_norm_bland__*` on Claude Code). Never call the v1 plugin's server or a project-scoped `bland` server, even though they expose similar tools — they may be authenticated to a DIFFERENT organization. Identity is proven by the org smoke check, never by tool namespace.


Hand-architected conversion beats automatic converters: a human-quality architecture (which nodes form which scenarios, what the hub says, what each entry means) plus **mechanical, verbatim carriage of every byte of content**. This skill is the doctrine; `references/traps.md` is the accumulated trap catalog — read it in full before authoring, and again before pushing.

**Everything is additive.** The v1 pathway keeps serving live traffic untouched. The migration produces a new agent version in the owning org; number cutover is a separate, explicitly-human decision and is NOT part of this skill.

## Inputs (raw JSON, read-only)

- The v1 pathway export: `{name, description, nodes[], edges[]}` — node types Default, Route, Webhook, Custom Code, Custom Tool, Transfer Call, SMS, Knowledge Base, End Call, plus a synthetic `global-prompt` node (no type/data/position — guard every walker).
- For persona migrations: the persona config — `personality_prompt`, `pathway_conditions[] {name, prompt, pathway_id, start_node_id, pathway_version}`, `call_config` — plus each attached pathway's export.
- Treat every v1 resource as **read-only and live**: exported secrets are real credentials (never print them; flag rotation), webhooks point at real systems, transfer numbers dial real people.

## The mapping

| v1 | v2 |
|---|---|
| globalPrompt / persona `personality_prompt` | `settings.systemPrompt` VERBATIM (persona: + each pathway's globalPrompt as clearly-scoped sections) |
| triage node / persona (greets + triages) | The hub. Persona-style sources ARE the natural entry (no re-point); a start code node is carried as `initialization`; connection gating (screener / IVR / voicemail / availability) is the one reason to re-point the inbound edge at an `entryScenario` |
| functional region of nodes | one complex scenario; the region's entry conditions become `entry.description` VERBATIM (persona: `pathway_conditions[].prompt` verbatim) |
| Route node | `route` step: one v2 rule per FLAT v1 condition row (flat rows are OR), one rule per `isGroup` block (AND inside); `fallbackNodeId` from the v1 source. An empty `isGroup` block is always true (see traps) |
| Custom Code node | `customCode` step: same `snippet_id`/`snippet_version` pin + `snippet_variables` |
| Attached tool `type:"code"` | No `toolType: "code"` in v2. Migrate it as a code step (same pin, explicit input map) + route step carrying the tool's responsePathways; an attached `custom-code` / `run_snippet` tool is the other form. See traps. |
| Webhook node | webhook step (carry url/method/headers/body/responsePathways/response mappings verbatim) |
| End Call | an `end-call` step in the same flow, with v1's edges into it as the flow's routes. It says its line and hangs up; there is no hub turn in between. A root `end-call` is only for a hang-up the hub decides (the caller asks to end the call). Exception: an End Call with a code tool stays a wrap-up prompt step + code step + exit, because an `end-call` step cannot run a snippet; give the hub a root `end-call` to hang up after it. |
| Variables with `captureKinds` | `captureAs` on each extraction row, verbatim. Capture reads those values back and confirms them at run time. |
| Global nodes | hub-routable scenario or system-prompt rule (auto-return globals); documented delta |
| Node-scoped KB | knowledge step with node-scoped kbIds. Lift to agent-level knowledge ONLY if v1 semantics were call-wide — a wrong lift bleeds KB content into scripted steps |

## v2 architecture principles — the output must be a real v2 agent

Carriage is mechanical for CONTENT; the ARCHITECTURE is v2's, never v1's. A migrated agent must look like one a v2 expert would build from scratch (see the `v2-authoring` skill). These are hard rules, each enforced by `/norm:validate`:

1. **Start IS the Initialization code step — not a scenario.** A v1 pathway whose start node is Custom Code carries that node as the agent's `initialization` (runs at connect, before anyone speaks; the builder does this automatically and refuses a plan that files the start code node into a scenario). The inbound edge then points at the hub, and the hub opens the conversation. Re-pointing the inbound edge at a scenario (`entryScenario`) is the exception for **connection gating**: call screeners, IVR / menu navigation, voicemail detection and the voicemail message, carrier intercepts, "is now a good time" availability checks, mid-call-drop resume. It needs a written `entryScenarioReason` in the plan, may speak for that purpose, and must exit to the hub. Core call logic never lives in Start: the questions, offers, knowledge answers, scheduling, verification, department transfers and every caller-chosen outcome are hub children. Budget: ≤ a third of all steps (a Start of four steps or fewer is always within budget). Lint (A0/A1, machine-enforced): start code not carried as initialization; a knowledge / scheduling / verification / transfer step in a Start scenario; a Start over budget or without an exit → FAIL.
2. **Intents are sibling scenarios the hub routes between on every turn.** Each thing the caller can want (qualify, schedule a callback, transfer, not interested, opt out) is its own scenario or root end-call with its own entry. Sequences live inside one flow; caller CHOICES never do. One flow holding the whole call switches the hub off for the whole call — a "don't call me again" at the greeting can then only be handled by that flow's hold condition, never by the hub.
3. **Every root end-call must be reachable.** A flow that never exits makes the hub's end-calls dead code. The sim suite must drive at least one call into each root end-call, proven by the engine trace.
4. **Every hold condition carries the universal escapes** in addition to its own completion condition: opt-out / do-not-call, wrong person, not interested, callback requested, transfer requested, voicemail, IVR. The routing stack evaluates the hold FIRST — an unmet hold blocks all routing, so a hold without escapes traps the call on that step while the model improvises goodbyes it cannot act on.
5. **No parking lots.** Unreachable or dead v1 nodes are `dropped` with reachability evidence in the report — never warehoused in a "legacy / do not enter" scenario. A scenario whose entry tells the hub never to enter it fails the audit.
6. **Tags and metadata are carried, not "cosmetic."** v1 node `tag` → the step's `settings.tag`; names preserved verbatim; any tag that cannot be carried is listed in the report AND declared in `.norm/dropped-tags.json` (`[{"tag","reason"}]`) so audit A6 accepts the drop; the file belongs to one migration (`init` clears it).
7. **Litmus test before pushing:** look at the canvas. If it reads as one big flow hanging off Start, it is a v1 pathway wearing a v2 costume — redo the architecture.

## The procedure (one-shot bar)

1. **Discover.** Census the export (node types, orphans, dangling ids). Produce two artifacts: a functional region map (every node in exactly one region, with entries/exits/route conditions) and an integration catalog (webhooks + auth, snippets + pinned versions, transfers, SMS, KBs, terminals, secrets). Derive the request-data contract: every variable consumed but never produced.
2. **Architect.** Regions → scenarios; hub prompt (spliced verbatim from the v1 triage content, or persona prompt); entry descriptions verbatim from source conditions; each End Call in the flow of the node that routes to it; every legacy node gets exactly one disposition (carried / synthesized / folded / dropped-with-reason).
3. **Author.** Build the snapshot per the `v2-snapshot` skill. Carriage is programmatic — scripts copy content from source JSON into the snapshot; never retype prose. Namespace node ids if merging multiple source graphs (shared raw ids are common). Values with `captureAs` get their readback and confirmation from capture: add no prompt rule that reads back, spells back or confirms them. In "Migrate and upgrade", a capture step after the loop also sets `captureAs` on values the pathway didn't mark.
4. **Audit.** Run `/norm:validate` — every check must pass. Non-negotiables: no OR-collapse, no null fallbacks the source didn't have, one exit edge per intent, every snippet/tool pin present in the final JSON (grep for each id), no unauthorized KB lift, hub rules scoped. Plus the v2 architecture lints above: start code node carried as `initialization`; any Start scenario is justified in the plan, holds only connection gating (screener / IVR / voicemail / availability — no knowledge, scheduling, verification or transfer steps), ≤ a third of steps, and exits to the hub; every root end-call reachable; every hold condition lists the universal escapes; no "never enter" scenarios; every v1 tag carried or reported.
5. **Push.** `POST /v2/agents/:id/versions` into the OWNING org (org-scoping!). Server-side validation failures are authoring bugs.
6. **Verify.** `/norm:simulate` — a sim suite of roughly one scenario per terminal/lane, judged on outcomes, graded on ENGINE TRACES not judge prose; 3 reps on any flapper; harness artifacts (broken tester personas, unresolved clock vars, expectations contradicting v1's own topology) get fixed in the harness, never in the agent. Then targeted test-chat probes for mechanics.
7. **Report.** Dispositions, documented deltas, carried v1 defects (bug-for-bug is correct — note them, don't fix them), request-data contract, and the honest list of lanes that could NOT be exercised (e.g. CRM-found paths without a customer test record, write-side integrations) — those need the customer's participation, say so plainly.

## Red flags — stop and re-verify

- Diagnosing behavior from judge text or transcripts alone: get the engine's per-turn decision trace first.
- Any content you typed rather than copied.
- "Attach the number to try it" — cutover is one-way; never attach during migration work.
- Testing flows that fire real side effects (gate-opening snippets, CRM writes, schedulers, live transfer lines) without an explicit safety plan: synthetic caller data, personas that stop short of write branches, customer sign-off for one coordinated smoke.
- A sim lane that passes because it never reached the code you changed — check the trace shows the lane you think you tested.
