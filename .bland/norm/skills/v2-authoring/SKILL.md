---
name: v2-authoring
description: Designing and building a NEW Bland v2 agent from scratch — scenario architecture (what scenarios represent and where boundaries belong), hub + entry authoring, step/edge/tool design, the standard conduct-rule set, and how v2 building differs from v1 pathway building. Use when creating a new v2 agent, designing its scenarios, or when someone asks how building in v2 differs from v1. If the user has not said v1 or v2, ASK before applying this doctrine.
---

# Building v2 Agents (from scratch)

> **Server binding (v1/v2 isolation):** all API work in this skill goes through THIS plugin's MCP server only (`plugin_norm_bland` — `mcp__plugin_norm_bland__*` on Claude Code). Never call the v1 plugin's server or a project-scoped `bland` server, even though they expose similar tools — they may be authenticated to a DIFFERENT organization. Identity is proven by the org smoke check, never by tool namespace.


This is the authoring doctrine for NEW agents. The snapshot dialect lives in `v2-snapshot`; runtime behavior in `v2-runtime`. If the user hasn't chosen v1 vs v2, ask first — the disciplines don't mix.

Before changing apparently disconnected JSON, read the
[builder/runtime mapping](../v2-runtime/references/builder-runtime-map.md).

## How v2 building differs from v1 (the mental shift)

| v1 pathway habit | v2 agent reality |
|---|---|
| One flat node graph; you wire everything | A HUB routes between SCENARIOS; each scenario is a self-contained flow |
| Global-node routing | Step globals exist through `settings.global`, with previous/redirect/manual continuation. Keep conduct rules in `settings.systemPrompt`; distinguish router selection from audio barge-in. |
| globalPrompt per pathway | ONE `settings.systemPrompt` for the whole agent — scope sections explicitly when different flows need different rules |
| Custom Code nodes with snippet pins | `customCode` steps — same pins, but inputs are ONLY the step's `variables` map (author the full read-set explicitly) |
| Library tools by id (TL-…) fetched at runtime | Tools embedded in the step's `tools[]` definition (TL- id optional); response pathways route deterministically on tool output |
| Route nodes everywhere | Route steps still exist, but many v1 routes were compensating for no-hub — in v2, distinct intents are often hub entries instead |
| "Transfer Pathway" between pathways | Map the source transition to the actual target construct; scenario-wrapper entry follows its Start edge. Root sibling routes need not detour through the hub. A telephone transfer is a separate operation. |

## What a scenario represents (the core design decision)

A scenario is a **self-contained job with a deliberate entry**: ordinary entry
through its wrapper resolves the Start pill's outgoing edge, not array order.
Keep tightly interleaved phases together. Do not assume arbitrary mid-flow entry
or force every exit through the hub; globals and explicit routes require their
own mapping and trace verification.

Boundary rule: **draw scenario boundaries only at one-way seams.**
- Separate departments/tasks that never loop into each other mid-conversation → one scenario each (an insurance triage agent: Sales, Customer Service, Claims).
- Phases that interleave (collect ↔ resolve ↔ schedule with "actually, different
  vehicle" jumps) → ONE scenario containing all of them. Ordinary wrapper entry
  follows the configured Start edge; splitting a loop across scenarios does not
  preserve an arbitrary mid-flow resume point.
- Scenario count is not a quality metric. A single-scenario agent with a thin hub is correct when the call is one continuous task. The hub still buys you: root end-call semantics, a fixed entry pathway when every call opens the same way, and additive growth (new lanes later = new scenarios, no surgery).

Entries are routing contracts for eligible generated routes from the hub and
root siblings. Write concrete, mutually-distinguishing criteria, not marketing
copy. Explicit incoming routes change auto-entry eligibility. Preserve one
intent per exit edge on the way out.

## Standard skeleton for a new agent

1. **Start** (only if something must happen before the hub routes): pick one row from the table below. Most agents need none.
2. **Hub**: thin. Greeting/persona live in systemPrompt or the entry flow; hub prompt = routing rules only ("route between turns; the scenarios own all lookups/transfers/closes; never handle content at the hub") + hard rules SCOPED to what they protect.
3. **Scenarios** per the boundary rule, each: entry description → steps → one exit edge per distinct outcome.
4. **Root end-calls**: "End call — goodbye" + "End call — silent" (for after a flow already spoke its close). In-flow goodbyes can be wrap-up steps; verify continuation reaches a real termination action instead of assuming a fixed extra turn.

| Need | Use |
|---|---|
| Run code before anyone speaks | `initialization`: a pinned snippet; optional `routes` open a root scenario on a returned value |
| Always open in one pathway | `entryScenarioId` on the hub (a root `complex-scenario`); it returns to the hub when done |
| Gate the connection (screener, IVR) | Start's slot: point the `inbound` edge at that node |

They run in that order. Never ask the hub to stay silent by prompt. Rules are
in the [snapshot skill](../v2-snapshot/SKILL.md#where-a-call-starts).

## The standard conduct-rule set (systemPrompt)

Every fabrication class below produced a real incident in production testing. Include these rules in every new agent, tailored to its domain:

- **Nothing is true unless a tool said so**: a booking/reservation/change happened only if the tool returned success on THIS call; a specific slot/time exists only if the availability tool returned it; never invent example times under pressure.
- **Phone numbers are copied, never recalled**: any number spoken must come digit-for-digit from a config variable on this call; if there isn't one, offer to connect instead. (Models recite plausible local numbers from memory — repeatedly.)
- **No side-effect promises the system can't keep**: no callbacks, notes, or "the team will reach out" unless a tool actually creates that artifact.
- **Write-tool gates tie to the caller's LAST turn**: a confirmation argument may only be "yes" if the caller explicitly confirmed in their most recent turn — a deferral is never confirmation. Scope every such guard to the exact moment it protects ("applies ONLY at the final submit; never prevents checking availability") — unscoped guards leak into adjacent behavior.
- AI disclosure (confirm plainly, continue), repeated-word person-chants ("agent, agent") → immediate human handling, language switch offered as a question and then sticky.

## Deterministic where it matters

- Model choice is the LAST routing layer (see `v2-runtime`). Anything correctness-critical rides deterministic constructs: route steps on tool-output variables, tool response pathways, `alwaysPick` edges after code steps.
- A step whose only job is silent routing/extraction should be a static pill (`useStaticText: true`, prompt ".") with its rules in the VARIABLE descriptions — a generative step with "stay silent" instructions will eventually speak, and what it says will be invented.
- Every route step gets a fallback. Every write tool gets a temptation probe in the sim suite.

## Verification is part of building

A new agent isn't built until `/norm:simulate` sweeps green on one head: one scenario per lane/terminal + the conduct probes above + write-tool temptation probes, personas completable, judges worded to the DESIGN's intended behavior (you have no v1 source to mirror — the design interview's outcomes are the bar). Expect run-to-run oscillation from LLM judges and live APIs; classify from engine traces, fix in the right layer (harness vs prompt vs construct).
