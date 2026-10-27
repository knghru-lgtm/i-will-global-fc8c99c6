---
description: Work on the Analytics page for the agent in view. Build, edit or simplify the analytics Sankey ("Where conversations go") through a customer waypoint definition, or build a conversation cohort ("show me the calls where…", "how many calls…") from outcomes and lake columns and open it on the Conversations page. Explains what the chart or a cohort cannot express and hands that to dispositions or query_analytics.
argument-hint: "<what to change or ask about the Sankey, or which calls to list>"
allowed-tools:
  - "Read"
  - "Write"
  - "Edit"
  - "Glob"
  - "Grep"
  - "Bash"
  - "mcp__plugin_norm_bland__*"
---

# /norm:analytics: the Sankey or a conversation cohort

Request:

```text
$ARGUMENTS
```

Resolve the agent, window and filters from the attached page context first.
Then pick one branch.

- **Cohort branch.** The request asks for a list, a cohort, "which calls",
  "show me the calls where…", or "how many calls where…". Go to
  [Cohort](#cohort).
- **Sankey branch.** The request is about the chart: stages, groups, labels,
  parallel branches, the unclassified share. Go to [Sankey](#sankey).

When a request mixes both, do the Sankey part and the cohort part as separate
steps and report each.

## Cohort

Load the [analytics cohorts skill](../skills/analytics-cohorts/SKILL.md) and
follow its workflow exactly:

1. Translate the ask into a predicate with the skill's grammar. If it cannot
   be expressed, say the rule and hand off; do not build a lookalike.
2. Validate offline with the skill's `scripts/validate-predicate.cjs`.
3. `call_bland_api` POST `/v2/analytics/cohorts`. On a 400, fix exactly the
   named node and resend.
4. `bland_api_get` the cohort until `ready` or `failed`: a few seconds apart
   at first, then about every 15 seconds.
5. Report `size`, `visible_size`, `truncated`, and what the predicate means in
   words. In a connected dashboard session the Conversations page opens the
   list by itself. In a standalone session, give the link
   `/dashboard/conversations?cohort=<id>` and say the page was not opened.
   Read `/ids` only when the user asks for the ids.

## Sankey

Load the [analytics authoring skill](../skills/analytics-authoring/SKILL.md)
and follow its workflow exactly:

1. `bland_api_get` the definition (members, fingerprint, published, pending).
2. `bland_api_get` the chart on the page's `window` when the request depends
   on traffic.
3. **If the request is a question, stop here and answer from the reads.** No
   design, no pending save, no publish unless a change was asked for.
4. Design the groups; validate offline with the skill's
   `scripts/validate-definition.cjs`.
5. `call_bland_api` PUT the pending draft with `expected_fingerprint`; fix any
   422 by the named ids; on 409 re-read and resend.
6. **Preview first** through `?definition=<pending id>` on the same `window`
   whenever the user asked to preview or see it before it goes live, and
   whenever the change is large or the request was ambiguous. After a preview,
   wait for the user's confirmation; do not publish in the same turn.
7. Otherwise, or once confirmed, `call_bland_api` POST to publish.
8. Re-read on the same `window` and report: stage table, unclassified share,
   `served` as it actually is, and anything the request asked for that a
   definition cannot express, with the surface that can.

## Both branches

The page refreshes itself after a save, a publish or a new cohort; never ask
for a reload. Use only the analytics routes for this command. Never script
fetch and never search the docs for these routes.
