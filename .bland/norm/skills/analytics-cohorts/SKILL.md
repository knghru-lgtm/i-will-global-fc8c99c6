---
name: analytics-cohorts
description: Use when building a list or cohort of conversations that match a condition ("show me the calls where…", "which calls…", "how many calls…"), counting calls by lake columns, filtering by outcome, call length, metadata, tools, webhooks or disposition values, opening a filtered list on the Conversations page, feeding a set of calls to a judge run, reading, adding, editing, deleting or backfilling a headline metric tile on the Analytics page ("add a metric", "what's my containment", "how is the agent doing", also from an Overview page), or explaining why a condition cannot be expressed.
---

# Build a conversation cohort

A **cohort** is a materialised, expiring snapshot of call ids, built once from
a predicate and a window. New calls never join it.

Use a cohort for "which calls" or "how many calls" on call columns. Journeys
belong to the [Sankey definition](../analytics-authoring/SKILL.md); what was
said to [dispositions](../evaluations/references/dispositions.md).

Read the [grammar](references/grammar.md) before a predicate, the
[contract](references/contract.md) before the first request, columns in
[tables](references/tables.md), leaf meanings in
[semantics](references/semantics.md), and freshness and the Overview pages in
[how it works](references/how-it-works.md).

## Page context

Call `get_dashboard_page_context` (`mode: "synced"`). Agent from
`route.params`, window from `route.search.window` or the target.

- `/dashboard`: org Overview, no tiles; its globe counts 30 days. For "how is
  my agent doing", read the summary with `window=30` for the named agent
  (`route.search.agent` is the open pane), else org-wide.
- `/dashboard/agent/$agentId`: agent Overview. It normally opens
  `…/analytics/analytics` (90 days by default); the classic page has no
  numbers: read the agent summary, name the window.

Why they differ from Analytics: [Overview pages](references/how-it-works.md#overview-pages).

## Attached target

A `cohort` target carries the request behind the selection on screen; build
from it plus the user's condition
([contract](references/contract.md#attached-target)). A `metric` target is a
tile: follow [metrics](references/metrics.md#attached-target).

## Workflow

1. **Scope** from the page context. Omit `agent_key` only when the user asks
   for the whole organisation.
2. **Translate the ask into a predicate.** Prefer the simple keys
   (`outcomes`, `metric`, `day`, `hour_utc`) when they say it exactly. Put
   column conditions in `where`, naming only columns in
   [tables](references/tables.md).
3. **Validate offline** with `node scripts/validate-predicate.cjs <request.json>`
   (`scripts/` in this skill). It checks `where` and reports `cost_class`.
4. **Create** with `call_bland_api` POST `/v2/analytics/cohorts`, body
   `{ "agent_key": "<agent>", "window": { "start": "…", "end": "…" }, "predicate": { … } }`.
   A 202 returns `{ id, status: "building" }`.
5. **Poll** `bland_api_get` on `/v2/analytics/cohorts/<id>`
   ([polling](references/contract.md#polling)) until `ready` or `failed`.
   Heavy predicates can take minutes.
6. **Report** `size`, `visible_size` and `truncated`, and what the predicate
   selected in words. In the dashboard the Conversations page opens the list
   itself; never ask for a reload. Standalone, give
   `/dashboard/conversations?cohort=<id>` and say nothing was opened.
7. **Ids on request only.** Page `/v2/analytics/cohorts/<id>/ids`, for
   example for a judge run ([evaluations](../evaluations/SKILL.md)).

Use the two API tools; never script fetch or search the docs.

## Refusals

A 400 `COHORT_PREDICATE_INVALID` names the node and rule, for example
`and[1].col: unknown column: calls.foo`. Fix that node only, validate, resend
([grammar](references/grammar.md#refusals)).

## Limits

- Window: end after start, at most 92 days, start at most 400 days ago.
- At most 50,000 calls. `truncated: true`: narrow before drawing conclusions.
- Readable for 7 days after it becomes ready, then 404.
- `visible_size` can be lower than `size`: the Conversations list shows only
  completed calls.

## What this cannot express

Say the rule and hand off; never approximate with a lookalike predicate.

- **One joined row meeting two conditions.** Each joined leaf is its own
  `EXISTS`; two leaves can match different rows.
- **Waypoints** (`COHORT_PREDICATE_UNSUPPORTED`): use the
  [Sankey](../analytics-authoring/SKILL.md).
- **Text search in denied columns** (transcripts, summaries, payloads, phone
  numbers). "Caller asked for a human" is a classification: define a
  disposition, then filter on its value.
- **Aggregates across calls** (averages, rates, top-N, per-day series). Climb
  the [measurement](references/measurement.md) ladder: tiles, then
  `query_analytics`, then a cohort.

Worked prompts are in [examples](references/examples.md). For a headline tile
(read, add, edit, delete, backfill) follow [metrics](references/metrics.md).
