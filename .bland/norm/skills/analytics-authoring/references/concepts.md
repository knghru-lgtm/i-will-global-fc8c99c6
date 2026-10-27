# How the analytics Sankey works

## Waypoints

Every agent version compiles to a list of **waypoints**: one per node (its
compiled node id) and one per tool (`tool:<name>`). The hub node of most agents
has the literal id `agent`; it is groupable. Four synthetic ids are never stored
in a definition and are rejected as members: `__entry__` and `global-prompt`
(excluded) and `__start` and `__initialization` (placed with the entry node's
group at fold time).

Traffic is recorded per conversation as transitions between waypoints. The
Sankey draws those transitions, folded through a definition.

## Fingerprint

The **fingerprint** hashes the version's set of waypoints and node-to-tool
bindings. Labels, prompts, edges and positions do not change it, so a
prompt-only version keeps the same fingerprint and the same definitions. A
promotion that adds or removes a node or tool produces a new fingerprint and
therefore a new structure.

- Readiness is counted per structure: the chart folds through a definition only
  when at least 5 conversations have run on versions with that fingerprint
  since the first of them was deployed, regardless of the page's window
  (`waypoints.served`). Below that, the definition is stored and reported in
  `waypoints.customer` but the chart keeps the inferred layout.
- A write should name the structure it was written for via `expected_fingerprint`
  (the definition read's `fingerprint`). A stale value is refused with 409 and
  nothing is written; omitting it skips that guard, so always send it.

## Definitions

A **definition** is `{ groups: [...] }`. Each group has:

| Field | Rule |
| -- | -- |
| `id` | non-blank, up to 128 characters, unique across groups, never `__unclassified__`; keep it stable across edits |
| `label` | non-blank, up to 512 characters, business language |
| `members` | 1 to 256 waypoint ids from the definition read's `members`; each id in exactly one group |
| `stage` | optional integer of 1 or more; all-or-none across the definition, dense from 1 (so never above the group count, and the group count is capped at 7) |

Rules that matter for design:

- **At most 7 groups.** Seven is a cap, not a target.
- **One group per member.** A definition partitions the waypoints once. Four
  independent categorisations of the same calls are not expressible; that is a
  dispositions problem.
- **Order is conversation order.** Without `stage`, a group's stage is its list
  position. With `stage`, groups that share a number are **parallel branches**
  drawn side by side, not steps a call moves through in sequence.
- **Whatever is left is `__unclassified__`.** Derived at read time, never
  stored. `unclassified_share` reports its share of traffic; keep plumbing out
  of groups on purpose, but say what the unclassified bucket holds.

Two kinds exist per agent and structure:

- **inferred** (`provenance: inferred`): produced by the platform's own
  inference job. Immutable; the fallback when no customer definition is served.
- **customer** (`provenance: customer`): written through the API by a person or
  by you on their behalf. Takes precedence on read.

## Lifecycle

`pending` → `published` → `superseded`.

- One **pending** row per agent, any fingerprint. Saving again overwrites it. It
  is a draft: previewable through `?definition=<id>`, never served by default.
- One **published** customer row per agent and fingerprint. Publishing
  supersedes the previous published row for that fingerprint and deletes the
  pending row.
- **Superseded** rows are history; reading one answers 404.
- **Carry-forward.** When a promotion creates a new fingerprint, the newest
  published customer definition is re-validated against the new structure and,
  if every member still exists, published under the new fingerprint
  automatically. If any member is gone, nothing is written: the read reports the
  old row as `stale: true` with `missing_members`, and the chart falls back to
  the inferred definition until a new one is published.

## Readiness and `served`

`waypoints` on a pathway read carries `definition_id`, `fingerprint`,
`provenance`, `status`, `unclassified_share`, `served`, and `customer`
(`definition_id`, `lifecycle`, `fingerprint`, `stale`, `missing_members`).

`served` is true only for `view=simple` when the structure is ready (5+
conversations since its first deployment) and the organisation's serve mode
allows it. A freshly published
definition on a quiet structure is stored, reported, and not drawn.

## Terminals

Each conversation ends in one engine-assigned terminal: `contained`,
`escalated_cold`, `escalated_warm`, `ai_abandoned`, `abandoned`, `agent_ended`,
`voicemail`, `not_connected`, `errored`. The chart folds these to three outcome
colours: completed by AI, transferred to staff, hung up. A definition cannot
rename, split or reassign terminals. "Transferred because the caller asked"
versus "transferred by design" is not visible here; the engine records both as
an escalation. Per-call reasons belong in dispositions.

## Views

`view=simple` folds through the definition and is the only view a definition
affects; both the Simplified and Detailed tabs draw it. `view=full` returns
the compiled waypoints themselves with their traffic; read it through the API
to understand node-level traffic before designing groups. The page draws the
full read only when no definition is served. Those are the only two values. See
[rendering](rendering.md) for what each tab draws.
