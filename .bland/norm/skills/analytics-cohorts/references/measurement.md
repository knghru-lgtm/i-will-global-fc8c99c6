# How is the agent doing

A ladder for "how is the agent doing", "what's my containment this week",
"average talk time by version", "abandonment by day". Climb only as far as
the question needs.

## Contents

- [The rule](#the-rule)
- [Step 1: the summary tiles](#step-1-the-summary-tiles)
- [Step 2: query_analytics](#step-2-query_analytics)
- [Time buckets](#time-buckets)
- [Step 3: the cohort drill-down](#step-3-the-cohort-drill-down)
- [Recipes](#recipes)
- [Do not](#do-not)

## The rule

Numbers come only from reads you actually ran in this turn. Name the read
behind each number (the summary, or a query). Never estimate, extrapolate or
fill a gap with a plausible figure. A `null` is "no number yet", not zero.

## Step 1: the summary tiles

Start here, so the numbers match the Analytics page the user is looking at.

`bland_api_get` on `/v2/analytics/agents/<agent id>/summary` (or
`/v2/analytics/org/summary`) with:

| Query | Values |
| -- | -- |
| `window` | `7`, `14`, `30` or `90` (days; default `7`) |
| `tz` | an IANA zone such as `America/New_York` (default `UTC`) |
| `shape` | `v2` |

- `current` and `prior` hold the counts for the window and the window before
  it: `total`, `connected`, `ai_completed`, `abandoned_at_ai`, `transferred`,
  `early_exit`, `transfer_seconds_p50`, `talk_seconds`.
- `metrics[]` holds every tile, system and customer, with `current` and
  `prior` values. Fold them as in [metrics](metrics.md#reading-the-numbers).
- `hours[]` holds the same counts per UTC hour, for a trend inside the window.
- Take the window from the page context or the attached target. Reads are
  limited to 60 a minute per organisation.

Answer from this read when the question is about a tile, its trend against
the prior window, or a comparison of tiles. Budget: one read.

## Step 2: query_analytics

Go here for a breakdown the tiles do not have: by day, by version, by
disposition value, by a call column. `query_analytics` runs one aggregate
query, scoped to the caller's organisation, and needs no confirmation.

```text
{ table, metrics, dimensions?, filters?, filter_mode?, date_range?,
  order_by?, limit?, cohort_id?, ratio?, visualization_hint? }
```

- **`table`**: `calls` (one row per call), `agent_hour_stats` (the hourly
  rollup behind the system tiles) or `metric_hour_stats` (the hourly rollup
  behind customer tiles).
- **`metrics`** (1 to 10): `{ fn, col?, source?, filters?, label? }` with
  `fn` one of `count`, `count_distinct`, `sum`, `avg`, `min`, `max`. Per-metric
  `filters` make a conditional count, the idiom for rates: a total count and a
  filtered count in one query. On `agent_hour_stats` a metric can also be
  named: `{ "metric": "<name>" }`.
- **`ratio`**: `{ "num": "<label>", "den": "<label>" }` names two metric
  labels and returns one `ratio` column in their place. Label the metrics.
- **`dimensions`** (up to 10): a column name; `{ col, label? }`;
  `{ col, source: "citation" }`; or `{ col: "<result key>", source: "disposition" }`.
  `query_analytics` takes no time bucket: a `trunc` key is dropped and the
  rows come back per raw timestamp (per call on `calls`, per hour on the
  hourly tables). For a series by day, week or month, see
  [time buckets](#time-buckets).
- **`filters`** (up to 20), combined by `filter_mode` `AND` (default) or `OR`:
  `{ col, op, val, source? }`. Ops `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`,
  `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`. Citation and disposition sources
  and JSON array columns allow only `=`, `!=`, `IN`, `NOT IN`, `IS NULL`,
  `IS NOT NULL`. `IN` takes at most 500 values.
- **`date_range`**: `{ since?, until? }`, each relative (`"-7d"`) or a date
  (`YYYY-MM-DD`). Default the last 30 days; at most 365.
- **`limit`** 1 to 10000, 100 when omitted; **`order_by`** up to 5
  `{ col, dir }` by output label.
- **Output**: `{ rows, rowCount, query, visualization }`. Rows are flat
  objects keyed by the snake_cased labels, so name labels deliberately.

`query_analytics` aggregates only. It has no row mode; a `mode` key is
dropped. For individual calls, use a cohort (Step 3).

### calls

Useful columns: `created_at`, `status`, `completed`, `inbound`,
`answered_by`, `call_ended_by`, `call_length` (minutes), `price`,
`transferred_to`, `error_message`, `pathway_id`, `batch_id`, `campaign_id`,
`disposition_tag`, `is_web`, `platform`, `version_number`, `version_label`.
Numeric functions apply to `call_length`, `price`, `max_duration`,
`version_number`, or a disposition result key with `source: "disposition"`.

`calls` has no agent column. To scope it to one agent, or to any set a
predicate can describe, build a cohort and pass `cohort_id`:

- calls only; another table refuses it;
- the cohort must be `ready`, belong to the organisation, and hold at most
  4000 calls. Otherwise the query is refused with a message saying which.

### agent_hour_stats

One row per agent per UTC hour. Columns: `agent_key` (the agent id),
`hour_utc`, `total`, `connected`, `contained`, `escalated_cold`,
`escalated_warm`, `ai_abandoned`, `abandoned`, `agent_ended`, `voicemail`,
`not_connected`, `errored`, `talk_seconds`, `early_exit`, `taxonomy_version`,
`updated_at`. Filter `agent_key` to one agent. `date_range` applies to
`hour_utc`.

Named metrics on this table:

| Name | Matches the tile |
| -- | -- |
| `total_calls` | (all calls, connected or not) |
| `ai_completion_rate` | Completed by AI |
| `containment_rate` | narrower than Completed by AI: `contained` only |
| `abandonment_rate` | caller and AI drops combined |
| `ai_abandonment_rate` | AI drops only |
| `escalation_rate` | Transferred |
| `early_exit_rate` | Early exit rate |
| `avg_talk_seconds` | Average talk time |
| `transfer_seconds_p50` | Time to transfer (never sum or average medians) |

Use `ai_completion_rate`, not `containment_rate`, when the number must match
the Completed by AI tile.

### metric_hour_stats

One row per hour per customer metric series and value bucket. Columns:
`agent_key`, `hour_utc`, `source`, `key`, `value_bucket`, `n_calls`,
`num_sum`, `num_count`, `updated_at`.

- **Filter `key` at the top level** with `=` or `IN` (ANDed). Without it the
  query is refused with `METRIC_KEY_FILTER_REQUIRED`. Each definition's `key`
  is on `GET …/metrics` ([metrics](metrics.md#routes)).
- Do not filter `agent_key`: refused with `METRIC_AGENT_KEY_NOT_FILTERABLE`.
  The system pins it to the organisation total row unless the session is
  scoped to one agent. For an agent-scoped metric, prefer the agent summary
  (Step 1).
- Rate or count: `sum(n_calls)` where `value_bucket` is a numerator bucket
  (`'true'` for a query metric), over `sum(n_calls)` across every bucket of
  the key. Mean: `sum(num_sum)` over `sum(num_count)`.

### Errors

| Message or code | Fix |
| -- | -- |
| `Column "<col>" is not a column of table "<table>"` | Use that table's columns. |
| `Column "<col>" is reserved` | Remove that column; the system scopes the organisation itself. |
| `Named metric "<name>" is only available on the "agent_hour_stats" table` | Switch table or use `fn`. |
| `cohort_id is only valid with table "calls"` | Query `calls`. |
| `Cohort is not ready yet` | Poll the cohort to `ready` first. |
| `Cohort has <n> members, over the 4000-id limit` | Narrow the cohort. |
| `Query would scan too much data` | Narrow `date_range` or add filters. |
| A timeout | Narrow `date_range` or split it into windows. |
| `Date range exceeds maximum of 365 days` | Shorten the range; say the cap. |

## Time buckets

For a series by hour, day, week, month or year:

- **Enterprise organisations:** send the same query through `call_bland_api`
  POST `/v2/analytics/query` with body
  `{ "mode": "structured", "query": { …the query_analytics fields… } }`.
  This route applies `{ col, trunc, label? }` with `trunc` one of `hour`,
  `day`, `week`, `month`, `year` on a timestamp column: `created_at`,
  `updated_at`, `started_at` or `transferred_at` on `calls`, `hour_utc` on the
  hourly tables. The POST runs a read and changes nothing; say so if a
  confirmation prompt appears. Other organisations get 403
  `ENTERPRISE_REQUIRED`.
- **Every organisation:** group `agent_hour_stats` by `hour_utc` with `sum`
  of count columns (`connected`, `contained`, `escalated_cold`, …) and a
  `limit` that covers every hour (the default is 100 rows), or read the
  summary's `hours[]`, and add the hours into days yourself. Sum
  numerators and denominators per day; never average hourly rates.

Buckets on `hour_utc` are UTC days. Say so when the page shows another zone.

## Step 3: the cohort drill-down

Go here for "which calls", or to scope a `calls` query to one agent.

1. Build a cohort ([contract](contract.md)). To get exactly the calls a system
   tile counts, use the predicate key `metric` with the tile's system id.
2. Then either pass its id as `cohort_id` to a `calls` query, open it on the
   Conversations page, or read its ids for a judge run.

## Recipes

- **Containment this week, as the page shows it:** Step 1, `window=7`, the
  `containment` entry.
- **Completed by AI by day for one agent** (enterprise,
  [time buckets](#time-buckets)): POST `/v2/analytics/query` with
  `query: { "table": "agent_hour_stats",
  "metrics": [{ "metric": "ai_completion_rate", "label": "completed_by_ai" }],
  "dimensions": [{ "col": "hour_utc", "trunc": "day", "label": "day" }],
  "filters": [{ "col": "agent_key", "op": "=", "val": "<agent id>" }] }`.
  Otherwise fold the summary's `hours[]` (`ai_completed` over `connected`).
- **Average call length by version for one agent:** build a cohort with
  `agent_key`, then `calls` with `cohort_id`,
  `metrics: [{ "fn": "avg", "col": "call_length", "label": "avg_minutes" }]`,
  `dimensions: ["version_number"]`.
- **A disposition rate:** `calls`, two metrics (`count` labelled `total`, and
  `count` with a disposition filter labelled `hits`), `ratio: { "num": "hits",
  "den": "total" }`. Or save it as a judgment tile ([metrics](metrics.md)).
- **A customer tile's daily trend:** `metric_hour_stats` with the tile's
  `key`, grouped by `hour_utc` and `value_bucket`, folded into days
  ([time buckets](#time-buckets)). The summary's `hours[].metrics` holds
  per-hour values; never add hourly rates into a day.

## Do not

- Do not answer a tile question from `query_analytics` when the summary has
  the tile. The two can differ (rollup timing, the named-metric fold).
- Do not average averages or medians across groups. Sum numerators and
  denominators, then divide.
- Do not write fetch scripts and do not search the docs for these routes.
