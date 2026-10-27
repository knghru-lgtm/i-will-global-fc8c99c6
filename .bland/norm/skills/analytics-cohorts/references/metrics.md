# Headline metric tiles

The Analytics page shows headline tiles above the heatmap: the system tiles,
then up to 10 tiles the customer defines. This page is the contract for
reading them, adding one, editing one, deleting one and backfilling one.

## Contents

- [The tiles](#the-tiles)
- [Attached target](#attached-target)
- [Workflow: answer a question about a tile](#workflow-answer-a-question-about-a-tile)
- [Workflow: add or edit a tile](#workflow-add-or-edit-a-tile)
- [Workflow: delete or backfill a tile](#workflow-delete-or-backfill-a-tile)
- [Routes](#routes)
- [The definition](#the-definition)
- [Write answers](#write-answers)
- [Edit, delete and backfill semantics](#edit-delete-and-backfill-semantics)
- [Reading the numbers](#reading-the-numbers)
- [Access and limits](#access-and-limits)
- [Rails](#rails)

Use the two API tools directly: `bland_api_get` for reads, `call_bland_api`
with `method`, `path` and `body` for writes. Do not write fetch scripts and do
not search the docs for these routes.

## The tiles

The metric routes are live for every organisation, self-serve included. They
are not enterprise-only.

| Page label | System id | Kind | Counts |
| -- | -- | -- | -- |
| Connected calls | `conversations` | `count` | connected conversations |
| Completed by AI | `containment` | `rate` | completed by the AI with no handoff, over connected |
| Abandoned at AI | `abandonment` | `rate` | caller hung up before completion or transfer, over connected |
| Transferred | `escalation` | `rate` | a warm or cold handoff started, over connected |
| Time to transfer | `timeToTransfer` | `median` | seconds from start to handoff, over transferred |
| Early exit rate | `earlyExit` | `rate` | connected and ended within 10 seconds, over connected |
| Average talk time | `talkTime` | `mean` | seconds per connected conversation |

- Self-serve pages draw six tiles (no Time to transfer). The API still
  returns all seven entries.
- A customer tile has a uuid id. It is drawn under the system tiles.
- An **override** is a customer definition saved on a system id. It replaces
  that tile's numbers, label and kind in place, and keeps the system id.

## Attached target

The page hands a tile to Norm with a preface line, for example:

```text
Attached target: metric "New metric" id=new context={"agentId":"<agent id>","scope":"agent","window":30}
```

- `id=new` comes from the **Add metric** tile: create a definition.
- `id=<uuid>` comes from a customer tile's **Edit** button: edit that row.
- A system id (`containment`, …) means that tile: an override.
- `context.scope` is `org` or `agent`; `agentId` is present only for `agent`.
  Use it to pick the route. Never move a metric to another scope.
- `context.window` is the page window in days (7, 14, 30 or 90). Use it for
  the read-back.

Delete has its own button on the page, which deletes without Norm.

## Workflow: answer a question about a tile

"What's my containment", "why is abandonment up", "what does this tile count".

1. Read `bland_api_get` on `/v2/analytics/agents/<agent id>/summary` (or
   `/v2/analytics/org/summary`) with `window=<7|14|30|90>`, `tz=<IANA zone>`
   and `shape=v2`.
2. Find the entry in `metrics[]` by `id` and fold `current` and `prior` by
   `kind` ([reading the numbers](#reading-the-numbers)).
3. Report the number the page shows, the prior window, and what the tile
   counts. For a breakdown, go to [measurement](measurement.md).

Budget: one read. A question never writes.

## Workflow: add or edit a tile

1. **Read** `GET …/metrics` for the scope. Note the customer count (the cap is
   10 and overrides count), each `key`, and the row being edited.
2. **Write the definition** ([the definition](#the-definition)). For a query
   metric, validate `spec.where` offline as a cohort `where`:
   `node scripts/validate-predicate.cjs` on `{ "where": … }`.
3. **Confirm a judgment save.** A judgment create, or an edit that changes
   `kind`, `source`, `denominator` or `spec` and leaves or makes the metric a
   judgment metric, starts scoring the last 90 days of calls with the
   disposition the moment it is saved. That scoring is billed. Explain it and
   wait for a yes ([rails](#rails)), even though no estimate exists before
   the save. A label or description edit needs no confirmation.
4. **Save.** New: `call_bland_api` POST `…/metrics` (201). Edit: PUT
   `…/metrics/<id>` with the whole body (200).
5. **Report** `preview` when present (the last 14 days), the `status`,
   whether numbers are `awaiting`, and `backfill.estimated_cost_usd` when
   present (the first chunk of scoring, not the whole 90 days). The page
   refreshes the tiles itself on the write receipt; never ask for a reload.
6. **Refusal:** fix exactly what `violations[]` names and resend once.

Budget: one list read, one write, at most one corrected write. A judgment
save waits for the user's yes.

## Workflow: delete or backfill a tile

- **Delete:** confirm first ([rails](#rails)), then DELETE `…/metrics/<id>`
  (204, no body). The page refreshes itself.
- **Backfill:** read `GET …/metrics/<id>/backfill` first. State the gap and the
  cost ([rails](#rails)). After a yes, POST `…/metrics/<id>/backfill` with
  `{ "days": <n> }` (202). The page does not refresh on a backfill; numbers
  fill in as ranges reach `done`.

## Routes

Base `/v2/analytics/org/metrics` or `/v2/analytics/agents/<agent id>/metrics`.
The scope and agent come from the path, never from the body. Every answer is
the envelope `{ data, errors }`; a refusal has `data: null`,
`errors: [{ error, message }]`, and its extra fields at the top level.

| Method | Path | Success | `data` |
| -- | -- | -- | -- |
| GET | `…/metrics` | 200 | `{ metrics, default_days, max_days }` |
| POST | `…/metrics` | 201 | the row plus `preview`, `backfill`, `default_days`, `max_days` |
| PUT | `…/metrics/<id>` | 200 | same as POST |
| DELETE | `…/metrics/<id>` | 204 | no body |
| POST | `…/metrics/<id>/backfill` | 202 | `{ needed, target, ranges, coverage }` |
| GET | `…/metrics/<id>/backfill` | 200 | `{ default_days, max_days, target, ranges, coverage }` |

- `<id>` is a customer uuid or a system id.
- GET lists the seven system entries in tile order (an override in place of
  its tile), then the customer rows by creation time.
- Each row carries `id`, `system_id`, `scope`, `agent_key`, `label`,
  `description`, `kind`, `source`, `denominator`, `spec`, `provenance`
  (`system` or `customer`), `status`, `coverage`, `cost_class`, `key`,
  `updated_by`, `updated_at` and `created_at`. A list row adds `backfill`.

## The definition

```json
{
  "label": "Long contained calls",
  "description": "Contained calls that ran 5 minutes or longer",
  "kind": "rate",
  "source": "query",
  "denominator": "connected",
  "spec": {
    "where": {
      "and": [
        { "col": "outcome", "op": "=", "value": "contained" },
        { "col": "call_length", "op": ">=", "value": 5 }
      ]
    }
  }
}
```

- `label` 1 to 200 characters; `description` optional, up to 2000.
- `kind`: `rate`, `count` or `mean`. `median` is the system Time to transfer
  only.
- `source`: `query` or `judgment`.
- `denominator`: `connected` or `total`.
- Unknown keys are refused, in the body and in `spec`.

**Query spec** `{ where, value? }`. `where` is the cohort grammar
([grammar](grammar.md)) with the same refusal messages, reported under
`spec.where`. `value` is `{ "col": "<column>" }`: required for `mean`,
refused for `rate` and `count`, and it must be a numeric `calls` column from
[tables](tables.md) (for example `call_length` or `price`).

**Judgment spec** over a published disposition of this agent:

```json
{
  "label": "Booked appointment",
  "kind": "rate",
  "source": "judgment",
  "denominator": "connected",
  "spec": { "disposition_id": "<disposition id>", "value_key": "booked", "numerator": ["true"] }
}
```

- `value_key` names a boolean, enum or number value of the disposition.
- `rate` and `count` take a boolean or enum value and at least one
  `numerator` bucket (`"true"`/`"false"`, or enum option keys).
- `mean` takes a number value and an empty `numerator`.
- Judgment metrics are agent-scoped only.

## Write answers

| Status | Code | Meaning and fix |
| -- | -- | -- |
| 201 / 200 | | Saved. `preview` is `{ num, den, window_days: 14 }` for a light query metric, else `null`. |
| 400 | | Shape error. The message names the body path, for example `body.spec.value: …`. |
| 403 | | The caller lacks the admin, owner, operator or prompter role for a judgment metric, or has no organisation context. |
| 404 | | `agent not found` or `metric not found`. Also a foreign id. |
| 409 | `METRIC_CAP` | 10 definitions in this scope; overrides count. Delete one first (with confirmation). |
| 409 | `CONFLICT` | The row or the disposition's published version changed during the write. Read again, then retry once. |
| 413 | | Body over 64 KiB. |
| 422 | `INVALID_METRIC` | Top-level `violations: [{ path, message }]` lists every broken rule. |
| 422 | `JUDGMENT_IS_AGENT_SCOPED` | A judgment metric was sent to `/org/metrics`. Use the agent route. |
| 422 | `PROBE_TOO_EXPENSIVE` | The one-day trial scan was over the ceiling (`bytes`, `max_bytes`). Narrow the predicate. |
| 429 | `ORG_BYTE_BUDGET` | The organisation spent its daily metric scan budget (`used_bytes`, `limit_bytes`). It resets at the UTC day change. |
| 429 | | More than 30 metric writes in 60 seconds for this caller. Wait. |
| 502 | `PROBE_FAILED` | The trial scan failed. Nothing was saved. |
| 504 | `PROBE_TIMEOUT` | The trial scan ran out of time (`retry_after_ms`). One retry after that delay is fine. |

`backfill` on a write answer is `{ needed, ranges, estimated_cost_usd? }`.
`estimated_cost_usd` appears for a judgment metric: the estimate for the first
chunk of scoring the automatic backfill admitted.

## Edit, delete and backfill semantics

- **PUT replaces** every editable field. Send the whole body.
- **Label or description only:** same `id`, same `key`, nothing recomputed.
- **Any change to `kind`, `source`, `denominator` or `spec`:** the old row is
  superseded and a new row is published with a **new uuid** and a new `key`,
  and a fresh automatic backfill is planned. An override keeps its system id.
- **PUT on a system id** with no override yet creates the override.
- **DELETE** a customer uuid: the tile goes away. DELETE a system id: the
  override goes and the system tile serves again. DELETE a system id with no
  override: 404 `metric not found`. Confirm first ([rails](#rails)).
- **Automatic backfill:** creating a metric or changing its `kind`,
  `source`, `denominator` or `spec` plans the last `default_days` (90) by
  itself. For a judgment metric that is billed scoring, and it starts on the
  save; confirm first ([rails](#rails)).
- **POST backfill** `{ "days": n }`: `n` is an integer from 1 to `max_days`
  (399); omitted means `default_days`. Outside the range: 422 with a violation
  on `days`. Only days not already done, running or pending are planned; a
  repeat answers `needed: false`. A failed range is planned again on the next
  request. A system tile with no override has no backfill: 404.
- Range `state` is `pending`, `running`, `done` or `failed`; `next` is the next
  day the backfill writes.

## Reading the numbers

`GET …/summary?window=<days>&tz=<zone>&shape=v2` returns `metrics[]`: the
seven system entries in tile order (override in place), then customer entries
by creation. Each entry is the definition plus `current` and `prior` (the
window before it).

- Fold by `kind`, not by id. `count`: `num`. `rate`: `num / den`. `mean`:
  `num / den` (seconds for Average talk time). `median`: `value`.
- A value is `null`, never 0, while the entry is `awaiting`, when the
  denominator is 0, or when no rows fall in the window. Say "no number yet",
  not zero.
- `status` is `ready` only when `coverage.days_covered` reaches
  `coverage.days_in_window`. Otherwise it is `awaiting`. A judgment metric
  stays `awaiting` until disposition results reach the analytics lake. A heavy
  query metric (`cost_class: "heavy"`) is computed a completed UTC day at a
  time. Both are normal; say so.
- A customer entry carries `as_of`: numbers are complete through that instant.
- `hours[].metrics` maps a customer entry's id to that hour's value.
- A summary whose `metrics[]` lacks the customer entries is a failed read, not
  a deletion. Read `GET …/metrics` before concluding anything.

## Access and limits

- Every route needs an organisation context (403 `ORG_SCOPE_REQUIRED`
  without one). Self-serve organisations are admitted.
- Judgment create, judgment spec edits and judgment backfills need the role
  admin, owner, operator or prompter. Every metric write takes effect at
  once; say what changes before you send it.
- At most 10 published definitions per scope, overrides included.
- Writes: 30 per 60 seconds per caller. Summary reads: 60 per 60 seconds.
- A query metric is admitted only after a one-day trial scan. Keep heavy
  tables few in one predicate.

## Rails

- **Confirm before DELETE.** The tile disappears for the whole organisation
  and cannot be restored. Use:

  ```text
  About to delete the metric tile "<label>" (<scope>): its tile leaves the page for everyone in the organisation.
  This cannot be undone; re-creating it starts a new backfill.
  Reply "yes" to proceed.
  ```

  For an override, say the system tile comes back instead.
- **Confirm before a judgment create or spec change.** Saving starts the
  automatic 90-day backfill, which scores those calls with the disposition
  and is billed. Use:

  ```text
  About to save the judgment metric "<label>" for <agent>: saving starts scoring the last 90 days of this agent's calls with the disposition "<disposition>", which is billed.
  No estimate is available before the save; I will report the first estimate the save returns.
  Reply "yes" to proceed.
  ```

- **State scan and cost before a backfill beyond the automatic 90 days.**
  Name the days requested and the days already covered. For a query metric,
  say it scans the analytics lake once per added day, more for
  `cost_class: "heavy"`. For a judgment metric, say it scores the added days'
  calls with the disposition, which is billed, and quote any
  `estimated_cost_usd` you have. No route estimates an extended backfill; say
  that too. Wait for a yes.
- **Never write a system-id override unless the user named the tile.** "Add a
  booked-rate tile" is a new uuid row, not an override of Completed by AI.
- **On `ORG_BYTE_BUDGET` or `PROBE_TOO_EXPENSIVE`, narrow; do not retry.**
  Drop heavy tables or leaves, or offer a [cohort](contract.md) count or a
  `query_analytics` read ([measurement](measurement.md)) instead.
- **Never save a dashboard panel and call it a metric.**
