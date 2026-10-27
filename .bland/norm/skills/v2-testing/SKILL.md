---
name: v2-testing
description: Use when verifying Bland v2 agents with simulations, test chat, or speech-to-speech tests; testing a text or messaging reply ("preview the SMS reply", "test the API chat"); placing a real test call to the agent's number; measuring interruptions or response latency; grading engine traces; or deciding whether a test is safe. Covers fixtures, the agent-testing API, messaging probes, voice evidence, and live-integration safety.
---

# Testing v2 Agents

> **Server binding (v1/v2 isolation):** all API work in this skill goes through THIS plugin's MCP server only (`plugin_norm_bland`, `mcp__plugin_norm_bland__*` on Claude Code). Never call the v1 plugin's server or a project-scoped `bland` server, even though they expose similar tools; they may be authenticated to a DIFFERENT organization. Identity is proven by the org smoke check, never by tool namespace.

Every surface runs real integrations; safety comes first. What each surface
runs, which version, and why results differ:
[how agent testing works](references/how-it-works.md). Pick by what it runs:

| Surface | Runs | Read |
|---|---|---|
| Platform simulations | latest saved version, simulated caller plus judges | [simulations](references/simulations.md) |
| Test-chat socket | dev head or `version_id`, node by node | [probes](references/probes.md#test-chat-the-builder-websocket) |
| Messaging preview | the named version, the real messaging runtime; texts nobody | [probes](references/probes.md#messaging-preview-version-pinned-sends-nothing) |
| API chat (`POST /v1/chat`) | production; creates real records, fires webhooks | [probes](references/probes.md#api-chat-the-production-messaging-path) |
| Live text (`POST /v1/sms/trigger`) | the bound number; texts the reply to a phone | [probes](references/probes.md#live-text-a-number-the-user-owns) |
| Real phone call (`create_call`) | the number's production pin, or staging pin if staging-attached | [probes](references/probes.md#real-phone-call), [voice](references/voice.md) |

Text tests do not prove audible behavior ([voice](references/voice.md)).
Persistent judges and `/simulate` scoring: [evaluations](../evaluations/SKILL.md).

## Safety before any test

Classify every integration in the agent as read or write:

- **Reads** (CRM lookups, availability checks, pure compute): safe with synthetic data. Use a caller identity that intentionally misses (a `from` not in the CRM) so no real PII enters transcripts.
- **Writes** (schedulers, CRM tasks, gate openers, outbound events): NEVER complete these branches in routine testing. Exercise them once, coordinated with the customer, or against their sandboxes.
- **Transfers**: inert in chat and simulations; they dial real lines on voice calls.
- **Direct executions are live side effects**, not reads: `POST /v2/tools/<id>/run`, `POST /v1/tools/run` and `POST /v1/resources/<id>/execute` run the action for real. Confirm when the action writes, texts, transfers or books.
- **Reaching people**: `/v1/sms/trigger` texts a phone and `create_call` places a call. Use only numbers the user owns, after the REQUIRED confirm.

## Fixture discovery (before anything else)

Multi-tenant agents hydrate from per-call request data. The valid fixture is
the one the customer's OWN test scenarios use for this exact agent and
variant: copy their request data. Prove it hydrates by tracing the bootstrap
step in one run before grading. Stale fixtures look exactly like real bugs.

## Simulations and grading

Create with `POST /v1/agent-testing/scenarios`, run with
`POST /v1/agent-testing/scenarios/<id>/run`, read
`GET /v1/agent-testing/runs/<id>`. Grade on the engine trace in
`metadata.turn_details[].logs[]`, never on judge prose alone. The bar is the
full suite green in one sweep on one version head. Read
[simulations](references/simulations.md) before writing the first scenario.

## Messaging tests

Prove a texting change in order: the messaging preview on the version to
promote (its `trace` shows whether the brief or the graph answered); after
promote, one API chat turn if that channel is on; a live text only when
carrier delivery is in question.

## What testing cannot prove alone

- Lanes gated on customer data (CRM-found identities) need a customer-created test record.
- Write-side integrations need a coordinated customer-aware smoke.
- Warm-transfer audio behavior only shows on a real voice call.
- A keyless (OAuth) connection cannot reach the direct probes; report the gap.

Say these plainly in every report: "12/12 green" with the most sensitive lane
unreachable is not a proven agent.
