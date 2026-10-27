---
name: v2-runtime
description: Use when predicting or debugging Bland v2 runtime behavior, explaining routing or interruptions, explaining which version or runtime answered a call, web chat, API chat or text, explaining how an attached or library tool runs, or reconciling edited snapshot JSON with the builder canvas, hidden routes, and call traces.
---

# v2 Agent Runtime Behavior

> **Server binding (v1/v2 isolation):** all API work in this skill goes through THIS plugin's MCP server only (`plugin_norm_bland`, `mcp__plugin_norm_bland__*` on Claude Code). Never call the v1 plugin's server or a project-scoped `bland` server, even though they expose similar tools; they may be authenticated to a DIFFERENT organization. Identity is proven by the org smoke check, never by tool namespace.

A v2 snapshot becomes a runnable conversation graph at connect. Read
[how it works](references/how-it-works.md) for the life of a call: version,
opening, per-turn routing, globals, interruptions, setting scopes and canvas.
Before debugging behavior, confirm which version answered.

## Which version is the call even running

| Channel | Runs |
|---|---|
| Inbound voice on a bound number | The **production pin**; the **staging pin** when the number is staging-attached; or an experiment variant. |
| Outbound call | The production pin or an experiment variant, unless the request names an `agent_version` selector. |
| Published web chat widget (agent-backed) | The production version, refreshed on promote. No version override. |
| API chat (`POST /v1/chat`) | The production version (the latest save if never promoted). `settings.apiChat.enabled` is read from production. |
| Builder test chat | The **dev head**, or the version the `version_id` selector names. |
| Texts on a bound number | The production copy attached to the number; see the messaging runtime below. |

If an inbound call cannot prepare its version (an invalid pin, an env variable
with no value), it is still answered from the copy last attached to the number.
"The fix didn't take" is often this, not routing. Lifecycle: the
`v2-lifecycle` skill.

## Messaging runtime

Texts (SMS, iMessage, RCS, WhatsApp) and API chat do not always walk the
graph. When `settings.messaging.mode` is `reasoning` (the default when absent),
each turn is answered from a brief of the whole agent, unless the
brief lists step-only kinds (webhook, code, scheduling, tool chain,
verification); then turns run step by step as voice does. `pathway` mode
always runs step by step. Read the brief with `bland_api_get`
`/v2/agents/<agent id>/brief?channel=sms&version=<semver>` (default: the dev
head; pass the production semver for what live texts run); `brief.pathwayOnly`
names the blockers. Some deployments always run texts step by step. Voice and
web chat never read this setting.

## Routing and scenarios

Routing is layered: an unmet tool loop condition holds the step; tool
response pathways force a target (the default row is a deferred fallback
wherever it sits); edge conditions and `route` rules decide mechanically; only
then does the model choose. A flow's End is not a hang-up. Read
[runtime rules](references/runtime-rules.md) before blaming model choice, and
the [builder/runtime mapping](references/builder-runtime-map.md)
when nodes look disconnected or a JSON edit has no visible effect. Read
[interruptions](references/interruptions.md) for audio barge-in, scenario
changes, global-node returns, and active versus retired setting scopes.

## Variables

An unresolvable `{{placeholder}}` stays in the string as the literal text
`{{name}}`; it never becomes empty. Request data merges into call variables at
call start. `{{env.KEY}}` resolves at preparation and fails the call loudly
when missing. Details and the clock-variable gap:
[runtime rules](references/runtime-rules.md#variables).

## Guardrails, code and tools

- Guardrails can end, transfer or move a call "for no visible reason". Check
  [guardrails](references/runtime-rules.md#guardrails-at-runtime) before routing.
- [Execution phases](references/execution-order.md): preparation, turns, post-call.
- [Tools and handoffs](references/tools-and-handoffs.md): code steps, snippet
  pins, webhook outcomes, transfer evidence.
- [Tool library](references/tool-library.md): tool, secret and connection
  routes, the definition schema, the HTTP-0 trap, attach modes and blast
  radius, tool logs. Workflows: the [tool-library skill](../tool-library/SKILL.md).

Document the [behavioral deltas](references/runtime-rules.md#behavioral-deltas-to-plan-for-v2-model-limits)
per agent instead of discovering them in production.
