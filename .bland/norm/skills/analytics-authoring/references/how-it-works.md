# How the analytics Sankey works

This page explains how a finished call becomes a path on the "Where
conversations go" chart, when it shows up, and why the chart sometimes does
not look the way a definition says it should. Routes and bodies are in
[the contract](contract.md); field rules are in [concepts](concepts.md).

## What it is

The Sankey on an agent's Analytics page shows where real conversations went:
which parts of the agent they passed through, in order, and how they ended.
The parts it draws are **stages**: groups of the agent's nodes and tools,
named in business language by a **waypoint definition**.

It is not:

- **The builder graph.** The builder shows every node and edge that could be
  taken. The Sankey shows only what calls actually did.
- **A per-call outcome classifier.** It cannot say why a call ended or whether
  a booking succeeded. That is a [disposition](../../evaluations/references/dispositions.md).
- **A headline number.** Containment and the other tiles come from the
  summary read ([metrics](../../analytics-cohorts/references/metrics.md)), not
  from the chart.

## Objects and how they relate

```text
 agent (live)
   │ production pin ──► agent version (versioned, frozen)
   │                      │ compiles to
   │                      ▼
   │                    waypoints: one per node, one per tool:<name>
   │                      │ hashed (set of waypoints + node-tool bindings)
   │                      ▼
   │                    fingerprint  = the "structure"
   │                      │ one structure has:
   │                      ├─ inferred definition (made by the platform, read-only)
   │                      ├─ published customer definition (at most one)
   │                      └─ (agent-wide) one pending customer draft
   ▼
 conversations ──► recorded transitions between waypoints ──► daily traffic
                                                                │ folded through
                                                                ▼ the served definition
                                                         Sankey: stages + 3 terminals
```

- Definitions are agent-scoped and keyed by structure, not by version. Two
  versions with the same nodes and tools (a prompt-only change) share one
  structure and one definition.
- Traffic is org- and agent-scoped and is counted per day.
- The three right-hand terminals (completed by AI, transferred, hung up) come
  from each call's outcome, not from the definition.

## Lifecycle and states

A customer definition moves through three states:

```text
            PUT …/definition/pending          POST …/definition
  (none) ─────────────────────────► pending ───────────────────► published
                 ▲   │ save again overwrites                          │
                 │   └──────────────┘                                 │ next publish
                 │                                                    ▼ for this structure
                 └──────────── publish deletes the pending row     superseded (history, reads 404)
```

- **pending** is a draft. It is previewable with `?definition=<id>` and never
  drawn by default. One per agent.
- **published** is drawn once the structure is ready (below). One per agent
  and structure.
- **superseded** is terminal. Nothing restores it; publish a new definition
  with the same groups instead.

Separately, the read reports the state of the platform's own grouping for the
displayed structure in `waypoints.status`:

| `status` | Meaning |
| -- | -- |
| `ready` | A definition exists for this structure and can be drawn. |
| `pending` | The platform is still preparing its inferred grouping (shortly after a promotion). |
| `failed` | The inferred grouping could not be produced. A customer definition still works. |
| `none` | No definition for this structure yet. |
| `unavailable` | A part of the read failed; the chart was drawn without any definition. Read again later. |

When a promotion changes the structure, the platform prepares an inferred
grouping in the background, and re-checks the newest published customer
definition against the new structure. If every member still exists, it is
published for the new structure automatically. If not, the read marks it
`stale: true` with `missing_members`, and the chart falls back until you
publish a new one.

## How it reaches a live call or conversation

The chart never affects a call. It is read-only analytics over calls that have
already ended. The path from a call to the chart:

```text
 call ends ──► outcome assigned ──► transitions stored with the call
                                         │
                       once a day, after the UTC day closes
                                         ▼
                              daily traffic for that day
                                         │ read on page load
                                         ▼
                         folded through the served definition ──► chart
```

What that means for timing:

- **The chart is a day behind.** Traffic is built once for each whole UTC day,
  early on the following UTC day, with a second pass later that day that
  fills gaps. Calls from today are not on the chart yet. A call made at 23:50
  UTC appears the next day; a call at 00:10 UTC waits almost two days.
- **Readiness uses the same daily data.** The chart folds through a definition
  only after the structure has 5 conversations counted since its first
  deployment (`readiness.count` against `readiness.threshold`). After a
  promotion that changes the structure, expect the definition to draw the day
  after the fifth conversation, not the minute it happens.
- **Excluded calls.** Simulated calls and the second leg of a warm transfer
  are never counted. They are not customer conversations.
- **Which version.** The chart draws the production version's structure by
  default. The page's version picker (the read's `agent_version`) draws
  another. `displayed_version_id` names the one drawn.
- **Edits are felt on the next read.** Publishing changes how the next chart
  read groups the same traffic. No traffic is reprocessed and no call is
  touched, so a published definition also regroups the days already in the
  window.

## On the dashboard

The chart lives on the agent's Analytics page,
`/dashboard/agent/<agent id>/analytics/analytics`, under "Where conversations
go". It needs an enterprise organisation; self-serve Analytics pages show the
tiles and heatmap only.

| Control | What it does |
| -- | -- |
| Window picker | 7, 14, 30 or 90 days. The chart and the readiness count are separate: readiness ignores the window. |
| Simplified tab | Stages as columns; parallel branches merged into one column labelled with "+N" ([rendering](rendering.md)). |
| Detailed tab | Same stages, each branch drawn apart. |
| Version picker | Draws another version's structure. |
| Edit flow / stage chip | Attaches a `pathway` or `stage` target to Norm ([contract](contract.md#attached-target)). The page has no form to edit groups itself. |

After Norm saves or publishes through the API, the page refreshes the chart on
its own. Nothing else (a promotion, new traffic) pushes an update; the next
page load shows it.

## Rules and limits

| Rule | Value | What the user sees |
| -- | -- | -- |
| Groups per definition | at most 7 | 422 `too_many_groups` |
| Members per group | 1 to 256 | 422 `empty_group`, or 400 over 256 |
| Each member | in exactly one group, from the read's `members` | 422 `duplicate_member` / `unknown_member` |
| Group id | up to 128 characters, unique, not `__unclassified__` | 400 or 422 |
| Label | up to 512 characters, non-blank | 400 or 422 `missing_label` |
| `stage` | all-or-none, dense from 1 | 422 `stage_missing` / `stage_not_dense` |
| Body size | 256 KiB | 413 |
| Writes | 30 per minute per organisation | 429 |
| Window | 7, 14, 30, 90 days | 400 otherwise |
| Readiness | 5 conversations on the structure | `served: false` until met |
| Organisation | enterprise | 403 `ENTERPRISE_REQUIRED` |
| Production pin | required to write | 409 `NO_PRODUCTION_VERSION` |
| Stale write | `expected_fingerprint` must match | 409 `PRODUCTION_VERSION_CHANGED`, nothing written |

The full validation list is in [the contract](contract.md#validation-rules-422-violations).

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
| -- | -- | -- | -- |
| Published, but the chart still shows the old layout | Structure not ready (under 5 conversations) | `served: false`, `readiness.count` below `readiness.threshold` | Wait for traffic. Say so; do not republish. |
| Published, `served: false`, readiness met | The platform is not drawing customer definitions right now | `served: false` with `readiness.ready: true` | Nothing to fix in the definition. Say so and report it. |
| Today's calls missing | The chart is a day behind | `readiness.data_through` is yesterday or earlier | Wait for the next daily build. Use the tiles for today. |
| Chart reverted after a promotion | New structure, a member was removed | `customer.stale: true`, `missing_members` listed | Redesign without the missing ids and publish. |
| Large "Unclassified" band | Busy waypoints not named in any group | `unclassified_share`; `view=full` shows which waypoints carry the traffic | Add those waypoints to a business stage, or say what the band holds. |
| A stage looks bigger than its call count | Transitions, not calls: a stage visited twice counts twice | The column's own count vs the band widths | Explain; group repeated steps into one stage. |
| Parallel branches look merged | Simplified tab merges siblings | Same `stage` on several groups | Show the Detailed tab. |
| 409 on save | The production pin moved since the read | `PRODUCTION_VERSION_CHANGED` | Read the definition again, rebuild against the new `members`, resend. |
| `?definition=<id>` answers 404 | The pending draft was published (consumed) or superseded | The publish response's `definition_id` | Use the published id. |
| "Transferred" cannot be split by reason | Terminals are fixed outcomes | n/a | Hand to dispositions ([measurement and persistence](measurement-and-persistence.md)). |

## Questions people ask

**Why does my chart not show today's calls?**
The chart is built once per UTC day. Today's calls appear after the next
daily build. The headline tiles refresh much sooner.

**I changed a prompt. Do I need a new definition?**
No. Prompt, label, edge and position changes keep the same structure, so the
published definition keeps drawing.

**I added a node and promoted. What happens to my definition?**
It carries forward only if every member still exists; a new node lands in
"Unclassified" until you add it to a group. If a member was removed, the
chart falls back to the inferred grouping until you publish a new one.

**Can I count a call as "booked" on the chart?**
No. A stage means "the call passed through these waypoints". Whether the
booking worked is an outcome judgement: a disposition.

**Why do the stage numbers add up to more than my call count?**
Bands count transitions. A conversation that loops through a stage twice adds
two. The count printed under a column counts conversations once.

**Does editing the chart change my agent?**
No. A definition only regroups how traffic is drawn. It never edits versions,
deployments or calls.

**Can the whole organisation have one Sankey?**
No. The chart is per agent; the org scope is refused with
`ORG_SANKEY_UNSUPPORTED`.

**Are test calls in the chart?**
No. Simulations and warm-transfer second legs are excluded everywhere on the
Analytics page.
