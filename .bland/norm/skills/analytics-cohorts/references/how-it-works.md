# How cohorts and headline tiles work

This page explains how a finished call becomes a number on a headline tile and
a member of a cohort, how fresh each one is, and why two numbers that look the
same can differ. Routes and bodies are in [the contract](contract.md) and
[metrics](metrics.md); what a predicate leaf means is in
[semantics](semantics.md).

## What it is

Three things on the Analytics page answer "how many" and "which calls":

- **Headline tiles**: Connected calls, Completed by AI, Abandoned at AI,
  Transferred, Time to transfer, Early exit rate, Average talk time, plus up
  to 10 tiles the customer defines.
- **Cohorts**: a saved, expiring list of call ids that matched a condition in
  a window. Opening one fills the Conversations page with exactly those calls.
- **Aggregate queries** (`query_analytics`): one-off breakdowns by version,
  disposition value or column; per-day series need a
  [time bucket](measurement.md#time-buckets).

The two Overview pages show a caller globe and live lists that people compare
with these numbers ([Overview pages](#overview-pages)).

They are not:

- **A judgement of what was said.** "Calls where the caller was angry" needs a
  [disposition](../../evaluations/references/dispositions.md) first; a cohort
  can then filter on its value.
- **The journey chart.** Which stages calls passed through is the
  [Sankey](../../analytics-authoring/references/how-it-works.md).
- **Live.** Every number here is computed from processed call data that trails
  real time (below). The Conversations page list itself is live.

## Objects and how they relate

```text
 call (live record) ──ends──► outcome assigned (one of nine)
        │                         │ copied to the analytics store
        │                         ▼
        │                 processed call data (org-scoped)
        │                    │                  │                  │
        │      hourly rollup │      per-metric  │      cohort build│ (on request)
        │      (system tiles)│      rollup      │                  │
        │                    ▼                  ▼                  ▼
        │            system tiles      customer tiles        cohort (org-scoped,
        │            (7, fixed)        (≤10 per scope,       expires after 7 days)
        │                              versioned rows)             │ opens
        ▼                                                          ▼
 Conversations page list ◄──────────────────────── /dashboard/conversations?cohort=<id>
 (live, completed calls)
```

- **Org versus agent scope.** Tiles and customer metric definitions exist at
  both org scope and agent scope. A cohort is org-owned; `agent_key` narrows
  it to one agent.
- **Outcomes are shared.** Tiles, cohorts (`outcomes`, `metric`, `outcome`)
  and the Sankey terminals all use the same nine outcomes and the same
  "connected" definition ([semantics](semantics.md#outcomes)).
- **Excluded everywhere.** Simulated calls and the second leg of a warm
  transfer are never counted on a tile.

## Lifecycle and states

A cohort:

```text
 POST /v2/analytics/cohorts ──202──► building ──► ready ──(7 days)──► expired (404)
                                        │
                                        └──► failed (terminal; build a new one)
```

- `building` past the build timeout reads as `failed`, so a poll always ends.
- `ready` is a snapshot. New calls never join it; build a new cohort to
  refresh.
- Expiry is final. The same request builds a new cohort with a new id.

A customer metric definition:

```text
 POST …/metrics ──► published ──PUT (label or description only)──► published (same id)
                       │
                       ├─PUT (kind, source, denominator or spec)──► superseded
                       │                                            + new published row, new id
                       └─DELETE──► gone (an override: the system tile returns)
```

Each published definition's numbers are `awaiting` until its days are
computed, then `ready`. A backfill range is `pending`, `running`, `done` or
`failed`; a failed range is planned again on the next backfill request.

## How it reaches a live call or conversation

Nothing here changes a call. These are reads over calls that have ended. The
timing of each surface:

| Surface | When a finished call shows up |
| -- | -- |
| Conversations page list | As soon as the call completes. In-progress calls are on the Active tab. |
| Processed call data | Usually within the hour after the call ends. |
| System tiles and heatmap | Recomputed about every 15 minutes over recent days, so usually within about an hour of the call ending. |
| Light query metric tiles | On the same 15-minute cycle as the system tiles. |
| Heavy query metric tiles (`cost_class: "heavy"`) | One completed UTC day at a time: yesterday's calls, not today's. |
| Judgment metric tiles | After the disposition has scored the call and the result has been processed. A correction to an older day can take several hours. |
| Cohorts | Whatever had been processed when the build ran. Calls from roughly the last hour may be missing. |
| Sankey | The next UTC day ([Sankey timing](../../analytics-authoring/references/how-it-works.md#how-it-reaches-a-live-call-or-conversation)). |

Consequences worth saying out loud:

- **A tile and a cohort built from it can differ by a few calls** when the
  window ends near now. Build the cohort with the predicate key `metric` so
  the population matches; the remaining gap is freshness.
- **A cohort's `size` and the list can differ.** `size` counts every match;
  the Conversations list shows completed calls only, so `visible_size` can be
  lower. A cohort of `not_connected` calls shows an empty list.
- **A new customer tile starts empty.** Creating it plans the last 90 days
  automatically; tiles read "no number yet" until those days are computed.
  For a judgment tile that plan scores calls with the disposition, which is
  billed, so Norm confirms before saving one.
- **Windows are in the page's time zone for tiles** (`tz`), but cohort `day`
  and `hour_utc` keys are UTC.

## On the dashboard

| Page | What it shows | What the user can do there |
| -- | -- | -- |
| `/dashboard/analytics` (org) and `/dashboard/agent/<id>/analytics/analytics` (agent) | Tiles, prior-window trend, day-by-hour heatmap | Pick the window. Open a day, an outcome or a Sankey terminal as a cohort (admin, owner or operator). Send a tile to Norm with **Add metric** or **Edit**. Delete a customer tile. |
| Heatmap | One cell per day (or hour) for the chosen measure | Export the table as CSV (in the browser; no API route). |
| `/dashboard/conversations?cohort=<id>` | The cohort's calls; the page's own filters are hidden | Open a call, page the list. |

- **Add metric** and **Edit** do not open a form. They attach a `metric`
  target to Norm, which writes through the API
  ([metrics](metrics.md#attached-target)).
- After Norm creates a cohort or writes a metric, the page refreshes by
  itself. A backfill does not trigger a refresh; numbers appear as ranges
  finish.
- Self-serve pages draw six tiles (no Time to transfer) and no Sankey. The API
  returns all seven system entries either way.

### Overview pages

The two Overview pages are where people first see a number, and the one they
compare with Analytics. Neither has tiles of its own.

```text
 /dashboard  (org Overview)                  /dashboard/agent/<id>  (agent Overview)
 ├─ Ask Norm box (or "Welcome, <name>")      └─ opens the agent's Analytics page:
 ├─ caller globe: whole org, last 30 days        /dashboard/agent/<id>/analytics/analytics
 ├─ migrations in progress                       (90 days unless ?window= is set)
 ├─ Your agents: numbers, versions, experiment
 └─ Your conversations with Norm (Norm on)
    or Your conversations (Norm off)
```

`?overview=classic` switches this browser to the classic layout and
`?overview=new` switches it back; the browser remembers the choice. The
classic org Overview has the agents, a per-agent chart and the conversations
list. The classic agent Overview has the agent's card, a setup checklist until
setup is done, and the agent's conversations list.

| Section | What it shows | Source | Window and freshness |
| -- | -- | -- | -- |
| Caller globe (also at the top of each Analytics page) | Connected calls and text conversations by caller area code (country for international callers). Caption: "N connected calls and M messages in the last 30 days, P on the map", then "live calls on map: K". | `GET /v2/analytics/org/geography` or `/v2/analytics/agents/<id>/geography`, `window` and `tz` | Org Overview: 30 days. Analytics page: the page's window. Calls follow the tiles' processing cycle; texts are counted within minutes; live calls come from the active-calls list. |
| Your agents | Each agent's phone numbers, the version in production and in staging, and a running experiment (enterprise) | The agent, number and environment reads | Current; read again when a pane opens. |
| Your conversations | Newest calls (in progress included) and text threads; on the agent Overview, web chats too | The Conversations list reads | No window. Live. |
| Classic chart | Connected calls per day, one line per agent, the first 8 agents by name | The agent summary's `hours[]`, one read per agent | 30 days, browser time zone, same freshness as the tiles. |
| Setup checklist (classic agent Overview) | Create; talk (a call of at least 5 seconds since the agent was created); promote (production runs a version); view call analysis (this browser opened one of the agent's calls on its Conversations page) | Call log, environments, the browser | Rechecks for the first call every few seconds. |

Every window is whole days in the browser's time zone, today included: "the
last 30 days" is today and the 29 days before it.

**Why an Overview number can disagree:**

- **Different window.** The org globe counts 30 days. Analytics opens on 90.
  Compare like with like: read the summary with `window=30`.
- **Texts.** The caption's message count has no tile. Only its connected-calls
  figure compares with the Connected calls tile.
- **Small lag, same definition.** The globe's call count uses the Connected
  calls definition and stops where the tiles' processed data stops, so for the
  same scope and window the two normally agree. A few calls can differ: a call
  that finished after the last processing run, a later correction to an
  older call, or day edges in time zones offset by a part hour.
- **Live calls are separate.** Calls in progress draw as rings and are never in
  the window counts.
- **The list is not a count.** Your conversations includes calls in progress,
  calls that never connected, texts and web chats, so its rows never match a
  tile, and it shows calls the tiles count only after processing.
- **The chart stops at 8 agents.** With more agents the lines add up to less
  than the org tile. Each classic paint spends up to 8 of the organisation's
  60 summary reads a minute.
- **Not on the map is still counted.** Toll-free, web or withheld callers,
  and area codes or countries the map cannot place, are in the total but not
  drawn.

"How is my agent doing" from an Overview: answer from the summary
([measurement](measurement.md#step-1-the-summary-tiles)), name the window, and
say why it may differ from what the page shows.

## Rules and limits

| Rule | Value | What the user sees |
| -- | -- | -- |
| Cohort window | end after start, at most 92 days, start at most 400 days ago | 400 `COHORT_INVALID_REQUEST` |
| Cohort size | 50,000 calls | `truncated: true` |
| Cohort lifetime | 7 days after ready | 404 `COHORT_EXPIRED` |
| Cohort creates | 20 per minute | 429 |
| Cohort role | admin, owner or operator (for an API key, its creator's role) | 403 |
| Predicate | depth 8, 64 leaves, 200 values per list | 400 `COHORT_PREDICATE_INVALID` |
| Ids page | 1 to 1000 per page | 400 |
| Customer tiles | 10 per scope, overrides included | 409 `METRIC_CAP` |
| Metric writes | 30 per minute | 429 |
| Metric trial scan | one day, under a ceiling | 422 `PROBE_TOO_EXPENSIVE` |
| Daily metric scan budget | per organisation, resets at the UTC day change | 429 `ORG_BYTE_BUDGET` |
| Backfill | 1 to 399 days; 90 by default | 422 on `days` |
| Summary reads | 60 per minute per organisation | 429 |
| `query_analytics` with a cohort | `calls` table only, cohort ready, at most 4000 calls | refused with a message naming which |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
| -- | -- | -- | -- |
| A call from minutes ago is not in the cohort or tile | Not processed yet | Call `created_at` within the last hour | Wait, then rebuild the cohort or reread the summary. |
| Cohort `size` 1,284 but the list shows fewer | List shows completed calls only | `visible_size` lower than `size` | Explain. Read `/ids` for every member. |
| Cohort list empty but `size` > 0 | All members never connected | `visible_size: 0`, predicate selects `not_connected` | Explain; use the ids route. |
| Cohort `failed` | Build could not finish (often heavy leaves on a long window) | `status: "failed"` | Narrow the window or drop heavy leaves; resend once. |
| `truncated: true` | Over 50,000 matches | `size` = 50,000 | Narrow before drawing conclusions. |
| Tile reads a dash | `awaiting`, denominator 0, or no rows | `status: "awaiting"` or `den: 0` | Say "no number yet", never zero. |
| New judgment tile stays `awaiting` | Disposition results not processed for the window yet | `coverage.days_covered` below `days_in_window` | Wait; check the disposition is published and scoring calls. |
| Tile number differs from a query | Different table or fold | Compare with `ai_completion_rate`, not `containment_rate` | Answer tile questions from the summary ([measurement](measurement.md)). |
| Cohort by disposition value is smaller than expected | Results not processed, or a different disposition version | `version_id` on the predicate | Report it plainly; do not swap in a lookalike `where`. |
| 403 on create from an API key | The key's creator lacks the role | 403 `UNAUTHORIZED` | Use a key created by an admin, owner or operator. |
| Overview globe and Analytics tile differ by thousands | Different windows: the org Overview counts 30 days, Analytics opens on 90 | Globe caption names its days; Analytics URL `window` | Read the summary with `window=30` and compare. |
| Globe a few calls off the Connected calls tile, same window | Processing lag or a later correction | Gap of a handful of calls on recent or corrected days | Explain; neither is wrong. |
| Overview list shows calls no tile counts | The list is live and includes unconnected and in-progress calls, texts and chats | Row status in the list | Explain; count from the summary. |
| "Caller locations aren't available here." | No organisation selected, or the read was refused | The globe offers no Retry | Select the organisation. |

## Questions people ask

**Why does the tile say 412 connected calls but my cohort has 409?**
The cohort was built a little later or earlier against processed data that
trails real time, or the windows differ. Build it with `metric: "conversations"`
on the same window and say freshness explains any remainder.

**How quickly does a call show on the Analytics page?**
In the tiles, usually within about an hour. On the Sankey, the next UTC day.
On the Conversations page, as soon as it completes.

**Does a cohort update when new calls come in?**
No. It is a snapshot taken at build time. Build a new one.

**Why can't I open my cohort after a week?**
Cohorts expire 7 days after they become ready. The same request builds a new
one.

**Are test calls counted?**
No. Simulations and warm-transfer second legs are excluded from every tile.

**Can I search transcripts with a cohort?**
No. Content columns are refused. Define a disposition that classifies the
calls, then filter on its value.

**Why is my new metric tile empty?**
It backfills the last 90 days by itself, and heavy or judgment metrics fill in
a day at a time. It reads "no number yet" until then.

**Why does my agent's Overview open the Analytics page?**
That is the agent Overview now. `?overview=classic` shows the classic page
(agent card, setup checklist, conversations) in this browser.

**Why does the Overview say fewer calls than Analytics?**
The org Overview's globe counts the last 30 days; Analytics opens on 90. On
the same window the globe's connected calls match the Connected calls tile
within a few calls. Its message count has no tile.

**Can a deleted tile come back?**
No. Deleting removes it for the whole organisation; re-creating it starts a
new backfill. Norm confirms before every delete.
