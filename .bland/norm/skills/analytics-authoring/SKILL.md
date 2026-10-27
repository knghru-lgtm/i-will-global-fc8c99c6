---
name: analytics-authoring
description: "Use when building, editing, simplifying or explaining an agent's analytics Sankey (\"Where conversations go\"): waypoint stages and groups, parallel branches, the unclassified share, what the Simplified and Detailed views draw, or why an end state cannot be split. Covers the customer waypoint-definition API (read, validate, save pending, preview, publish), its caps, and the boundary with dispositions."
---

# Author an agent's analytics Sankey

The Sankey on an agent's Analytics page folds real traffic through a
**waypoint definition**: ordered groups, each naming the compiled waypoints
(nodes and tools) it contains. You change the chart by publishing a new
definition. You never change the agent, its versions or its deployment.

Read [concepts](references/concepts.md) before designing, [the
contract](references/contract.md) before writing,
[rendering](references/rendering.md) before promising what the user sees, and
[how it works](references/how-it-works.md) to explain timing or a chart that
disagrees with its definition.

## Attached target

An `Attached target:` preface line names the agent, window and view, or one
stage to change alone ([contract](references/contract.md#attached-target)).

## Questions versus changes

A question about the chart ("why are these merged", "what is unclassified",
"which stage loses the most calls") is answered from reads alone: the
definition read and a chart read on the page's `window`. Design groups or save
a draft only when the user asked for a change; a pending save is a write.

## Workflow

Routes, bodies and every status are in [the contract](references/contract.md).
Reads use `bland_api_get`, writes `call_bland_api`; no fetch scripts, docs
searches or other API families.

1. **Read the page** for the agent, window and filters. Ask only if the agent
   is absent.
2. **Read the definition** (`…/pathway/definition`): the production version,
   the structure `fingerprint`, the groupable `members`, the `published` and
   `pending` rows.
3. **Read the chart** (`…/pathway?view=simple&layout=stages&window=<n>`) on
   the page's window when the request depends on traffic. Numbers come only
   from it.
4. **Design the groups** per [design](references/design.md): 3 to 5 business
   stages unless asked otherwise, exact member ids, plumbing left out, siblings
   sharing a `stage` for parallel branches, stable ids when only relabeling.
   Caps: at most 7 groups, each member in exactly one group, stages dense from 1.
5. **Validate offline** with `node scripts/validate-definition.cjs <definition.json> <members.json>`
   (in this skill). Fix every named violation before the first write.
6. **Save pending** (PUT `…/pathway/definition/pending`) with
   `expected_fingerprint` from the read. A 422 names ids to fix; a 409 means the
   pin moved: read the definition again, then resend.
7. **Preview** (`…/pathway?…&definition=<pending id>`, same window) when the
   user asked to see it first, or the change is large or ambiguous. Then stop
   and wait for confirmation.
8. **Publish** (POST `…/pathway/definition`, same body). The pending row is
   consumed; the response names the new and superseded ids.
9. **Confirm** with one more chart read on the same window. `served` stays
   false until the structure is ready; say so and report `unclassified_share`.

## What to tell the user

- The stage table: stage, label, member count, business meaning.
- `unclassified_share` and what it holds, in business terms.
- The page refreshes itself on save and publish. Never ask for a reload.
- The chart counts whole UTC days; today's calls are not on it yet.
- After publishing parallel branches: Simplified merges siblings, Detailed
  shows them apart ([rendering](references/rendering.md)).
- Anything the request asked for that a definition cannot express, named
  precisely, with the surface that can (usually dispositions; see
  [measurement and persistence](references/measurement-and-persistence.md)).
  Never approximate an unexpressible split with a lookalike grouping.

## Boundaries

- A definition regroups, renames and reorders compiled waypoints. It cannot add
  waypoints, change terminals, or classify calls by anything but the waypoints
  they visited.
- The three terminals are fixed. Splitting one by reason is a dispositions
  task.
- Edits apply to the production version's structure. A promotion that changes
  the node or tool set changes the fingerprint; a published definition carries
  forward only when every member still exists.
- Read-only instructions cover pending saves too.

See [examples](references/examples.md).
