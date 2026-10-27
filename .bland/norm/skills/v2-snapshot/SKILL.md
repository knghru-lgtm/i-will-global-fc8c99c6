---
name: v2-snapshot
description: The Bland v2 agent snapshot dialect, the exact JSON shape of an agent version (behavior graph, hub, complex scenarios, flow steps, edges, tools, settings) and the rules for authoring one by hand. Use whenever reading, writing, or debugging an agent_versions snapshot, pushing a version via POST /v2/agents/:id/versions, or carrying content into a snapshot during migration.
---

# The v2 Agent Snapshot Dialect

> **Server binding:** use only THIS plugin's MCP server (`plugin_norm_bland`); other `bland` servers may be signed in to another org.

An agent version is one JSON snapshot, run as a conversation graph
([how it works](../v2-runtime/references/how-it-works.md)).
Node shapes: [node catalog](references/node-catalog.md). Settings and tool
fields: [field guide](references/knobs.md).

## Top level

```text
{ "behavior": { "nodes": [...], "edges": [...] },
  "settings": { "systemPrompt", "displayName", "voice", "languages": ["en"], "voiceCall", ... },
  "contact": { "inboundNumbers": [...] },
  "knowledge": { "kbIds": [...] },
  "initialization": { "enabled", "step", "routes": [...] } }
```

- Only `languages[0]` reaches calls.
- Push with `POST /v2/agents/:agentId/versions`, body `{"snapshot": {...}, "name": "<optional>"}`,
  plus the concurrency fence for an existing head. Recovery rules are in
  [API](../api-workspace/references/api.md). Unnamed pushes may coalesce.

## Where a call starts

| Need | Use |
|---|---|
| Run code before anyone speaks, optionally branching on its result | `initialization`: a pinned snippet plus `routes` to the hub or a root scenario |
| Always open in one pathway, skipping the hub's routing turn | `entryScenarioId` on the `agent` node: a root `complex-scenario` outside auth zones |
| Gate the connection (screener, IVR) | Start's slot: point the `inbound` edge at that node |

Order: initialization, Start's slot, entry pathway or hub.

## Graph

`behavior.nodes`: one `inbound`, one `agent` (hub), root scenarios. A
`complex-scenario` holds `flow: {nodes, edges}` with `start`, steps, `end`;
the Start pill's edge selects the entry step. Every node, edge, rule and row
has a unique `id`. A scenario's `entry` is its routing contract. Edge
`data.mode` is `llm` (judged on `label`, `description`) or `deterministic`
(`conditions`); `alwaysPick: true` forces traversal.

## Conditions

| Where | Row | Comparison | Combine |
|---|---|---|---|
| Deterministic edge | `{id, field, operator, conditionOperator, value}`; `operator` is `AND` or `OR` | `conditionOperator`: `equals`, `not equals`, `contains`, `does not contain`, `greater than`, `less than`, `is` (`null`, `not null`, `true`, `false`, `undefined`, `not undefined`) | Each row joins the previous by its `operator` |
| Route step rule | `{id, field, operator, value}` | `operator`: the edge set plus `equals exact`, `not equals exact`; `is` takes `empty`, `not empty`, `defined`, not `not undefined` | AND in a rule; rules in order; fallback |
| Step `responsePathways` | `{id, label, variable, operator, value, targetNodeId}` | `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains` | First match |
| Attached tool `responsePathways` | `{id, label, variable, condition, targetId, targetName}` | Skewed: `label` = trigger, `variable` = operator, `condition` = value | First match |

Edge `equals` and `contains` are case-sensitive; route ones are not. The validator skips
edge rows: comparison in `operator` saves, then ORs the rows. No match and no
route fallback fails the call.

## Tools and code

`data.tools[]` entries have `toolType` `custom_tool` or `track`; fields are in
the [field guide](references/knobs.md#attached-tools). A snippet runs two ways:

- **Mid-turn**: an attached `custom_tool` whose `definition` has
  `integration: "custom-code"`, `action: "run_snippet"`. The model calls it.
- **At a fixed point**: a `customCode` step with `snippetId`, `snippetVersion`
  and an explicit `variables` input map, often followed by a `route` step.

## Authoring rules

- **Migrations carry content verbatim**: prompts, conditions, numbers, URLs, pins.
- **Org scoping**: snippet, tool and KB ids and `{{SECRET.*}}` resolve only in
  the owning org.
- **A `customCode` step without `snippetId` is inert**; `code` never runs.
- **Read `channelConfig` before editing a node**; a channel may hold its own copy.
- **Keep unrecognised fields.** Never invent keys from v1 names.
- Validate with [/norm:validate](../../commands/validate.md). Edit existing
  agents through [maintenance](../v2-maintenance/SKILL.md).
