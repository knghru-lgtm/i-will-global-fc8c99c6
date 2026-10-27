---
description: Audit a v2 agent snapshot before saving — schema, references, routing hazards, and tool pins; apply migration-specific architecture and carriage checks only to migrations.
argument-hint: "<path to snapshot JSON (and optionally the v1 source JSON to audit against)>"
allowed-tools:
  - "mcp__plugin_norm_bland__*"
  - "Read"
  - "Bash"
  - "Glob"
  - "Grep"
---

# /norm:validate — snapshot audit

Audit the snapshot at:

```text
$ARGUMENTS
```

Load the `v2-snapshot` skill for the dialect and the current supported schema.
Classify the task as new authoring, migration, or maintenance. Evaluate each
applicable check mechanically using workspace code; report PASS, FAIL, N/A
(with reason), or NOT VERIFIED. Applicable failures block saving; unsupported
checks are not passes. This checklist is not a substitute for schema validation
or behavioral tests.

For maintenance, preserve the existing design. Migration conventions such as
array-first Start/array-last End are not universal
schema requirements. Do not rebuild a valid agent merely to satisfy them. Check
the actual Start edge and intended termination behavior instead. Source-carriage
checks apply only when migrating; intentional requested edits are allowed.

## Structural

1. Top level has `behavior.nodes`, `behavior.edges`, `settings.systemPrompt` (non-empty).
2. Exactly one `inbound` node and one `agent` (hub) node; the inbound edge targets the hub OR a deliberate bootstrap scenario (if so, confirm that was intended).
3. Every `complex-scenario` has the required entry/name/flow fields for the supported schema. Each flow's Start edge targets its intended entry. Start-first/End-last array ordering is an authoring convention, not executable entry selection.
4. Every node, flow node, edge, rule, condition, and variable row has a unique `id`. No duplicate ids anywhere in the document.
5. Every flow edge's `source`/`target` exist in that flow; every route `targetNodeId`/`fallbackNodeId` exists in that flow.
6. For migration doctrine, require an `end-call`: at the root, or as a step inside a flow that its Start can reach (a v1 End Call migrates to the in-flow form). A flow that returns to the hub so it can route onward needs no hang-up of its own. The exception is a v1 End Call with a code tool, which migrates as a wrap-up step that returns to the hub: it needs a root `end-call` (audit P10). Otherwise verify the intended termination action/continuation; a missing root end-call is not a failure.

## Routing-crash checks

7. **No empty fallbacks**: every `route` step has a `fallbackNodeId`, or the omission is explicitly documented as a pre-existing defect (v1 or native v2). Report the no-match failure risk and resolve scope before saving; do not silently invent a fallback during an unrelated prompt edit.
8. **OR-collapse scan**: within any single rule, flag conditions that AND the same field against different equality values (e.g. `x equals a` AND `x equals b`) — impossible rules mean flat OR rows were collapsed.
9. Check reachability from the Start edge's actual target, including route rules,
   response pathways, global selection/return, and applicable guardrail targets.
   Being first in the array or having an inbound edge is not proof: an isolated
   cycle can satisfy both. Consult the
   [builder/runtime mapping](../skills/v2-runtime/references/builder-runtime-map.md).
   The bundled migration script's incoming-target check is only a structural
   heuristic, not this full analysis. Report unsupported validation separately;
   do not add cosmetic edges to silence it or call an unresolved check passed.
10. Steps with no outgoing edge and no route onward must be intentional terminals (wrap-ups before the end pill count only via their exit edge).

The audit script checks the next one mechanically.

27. **Deterministic edge rows** (audit R5, needs no source): every row of a deterministic edge or entry has `operator` `AND` or `OR` (the join to the previous row) and `conditionOperator` one of `contains`, `does not contain`, `equals`, `not equals`, `greater than`, `less than`, `is`. A comparison written into `operator` saves cleanly and never matches. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/norm-migrate-audit.cjs" --snapshot <file>` and read R5's detail line.

## Content carriage (when the v1 source is provided)

11. **Pin pairs**: every source snippet (id, version) PAIR appears in the snapshot as a pair — ids and versions checked independently would accept two snippets with swapped versions. `TL-` tool ids present. A missing or mispaired pin is a silent runtime no-op — release blocker.
12. Transfer numbers, webhook URLs, and header sets in the snapshot byte-match the source. Diff each; any difference must be an explicitly documented delta.
13. No v1 `type:"code"` attached tool was carried as an attached tool — each must have become a `customCode` step (with a non-empty `variables` input map) + route step.
14. Exit-edge discipline: for each source node with multiple cross-region exits, the snapshot has one end edge per distinct label — no merged labels (flag " / " in exit labels).
15. `snapshot.knowledge`/agent-level KB exists ONLY if the v1 KB was call-wide.

## Tool rows

16. Every attached tool has `toolType` `custom_tool` or `track`, and responsePathways rows use the field skew correctly (`label`=trigger, `variable`=operator, `condition`=value) with resolvable `targetId`s (empty target = continue, must be intentional).
17. No unknown/extra keys on tool objects.

The audit script checks the next one mechanically.

28. **No hollow tools** (audit S9, needs no source): a tool with a `toolId` either has `byReference: true` (the library tool runs by id; node overrides go in `toolOverrides`) or embeds a full definition with a `description` and a `body`. A stand-in definition runs instead of the library tool and does nothing.

## v2 architecture (migration doctrine — FAIL, not warn)

These six have a deterministic twin in `bin/norm-migrate-audit.cjs` (checks A0–A6: start code → initialization, Start scenario = connection gating + budget + exit, hub siblings, root end-call reachability, hold escapes, parking lots, tags). The migration Stop hook runs that audit on every stop attempt, so a snapshot that fails them cannot be released — read the audit's detail line and re-architect, do not argue with it.

20. **Start is the Initialization code step; a Start scenario handles connection gating only.** When the v1 start node is Custom Code it must appear as `initialization` (enabled, same snippet pin) — not as a step inside a scenario — and the inbound edge targets the hub. If the inbound edge targets a scenario instead, that scenario needs a written reason in the plan and may hold only connection gating — call screeners, IVR / menu navigation, voicemail detection and message, carrier intercepts, availability checks — which it may speak for. No knowledge, scheduling, verification (OTP / identity), transfer or pathway-transfer steps, ≤ a third of all steps (a Start of four steps or fewer is always within budget), and an exit to the hub. The call body — questions, offers, caller-chosen outcomes — in Start is the call captive in one flow with the hub switched off — FAIL and re-architect.
21. **Intents are hub children.** Each caller-chosen outcome (qualify / callback / transfer / not interested / opt out, or the source's equivalents) is a sibling scenario or root `end-call` with its own entry. Choices *inside one continuous task* ("actually, a different vehicle", reschedule, pick a plan) stay in that task's scenario: entering another scenario restarts it at its Start, so splitting a loop across scenarios loses the caller's place. A flow whose internal edges carry caller OUTCOMES (not sequence or in-task choices) is a v1 pathway in a v2 costume — FAIL and re-architect.
22. **Every root end-call is reachable**: trace one path from the inbound edge, through the entry scenario's exit, to the hub, and from there to each root `end-call` — or by a direct generated route from a returning root sibling, which the runtime allows without a hub hop. Either path counts; do not add a hub visit to satisfy this. A root end-call with no entry description or behind a Start that never exits is unreachable — FAIL.
23. **Universal escapes on every hold.** Every `loopWhile` / hold condition lists, in addition to its own completion, each escape the source handles: opt-out / do-not-call, wrong person, not interested, callback requested, transfer requested, voicemail, IVR. An escape may instead be a step-level global (`settings.global.isGlobal`) whose label or description names it, provided the held step does not set `settings.advanced.conditionOverridesGlobalPathway` (that knob lets the hold outrank the global). Releasing the hold is half of it: the released step must also route past the rest of the sequence (an edge to the flow's End pill or a root sibling), or the script simply continues after the opt-out. A hold with neither its own escape nor a reachable global traps the call on that step — FAIL.
24. **No parking lots.** No scenario whose name or entry says "legacy", "unreachable", "do not enter", "never enter". Dead v1 nodes are `dropped` in the report with reachability evidence. FAIL.
25. **Tags carried.** Every v1 node `tag` appears as the corresponding step's `settings.tag` or is listed in the report's dropped-metadata section. Missing without a report line → FAIL.

## Voice and language

26. **The voice resolves and fits the language.** The save validator checks none of this. For `settings.voice` and each `settings.voicePool` entry, `bland_api_get` `/v1/voices/<id>`:
    - It returns 200 with `voice`. A 400 `VOICE_NOT_FOUND` means the voice was deleted or this org cannot use it.
    - `voice.is_live` is not `false`. A draft trained voice fails outbound calls and plays the default voice on inbound calls.
    - `bland_api_get` `/v1/models` once. The `model_id` equal to `voice.service` lists the base code of `settings.languages[0]` (`en-GB` is `en`; a legacy name such as `english` is its code). Only the first language reaches calls. Mark `auto`, `fluent` and `babel` codes NOT VERIFIED.
    - When `voicePool` is set, `voice` equals `voicePool[0]`.

    An empty `voice` plays the platform default: report N/A and say so. Call budget: one voice read per distinct id plus one models read. Do not write fetch scripts and do not search the docs for these routes.

## Hygiene

18. No plaintext credential printed into your report output (check headers/URLs before quoting them — redact).
19. Unresolvable `{{placeholders}}` in prompts flagged (they render as literal text at runtime).

Output: a numbered status table, each FAIL with the JSON path and the one-line
fix, and each N/A or NOT VERIFIED with its reason. Keep schema failures,
behavioral hazards, and migration-only conventions distinct.
