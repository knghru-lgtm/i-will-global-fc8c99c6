---
name: dispositions
description: Use when working on an agent's Dispositions page or post-call outputs ("set up dispositions", "track call outcomes", "extract fields after each call", "classify every call", "send the outcome to my webhook", "why is this disposition blank", "the disposition is wrong", "it didn't run", "backfill", "score past calls", "roll back the disposition", "migrate my citations"), covering definitions, extractors, test runs, corrections and align, estimates and publish, rollback, backfills and moving v1 citations and outcomes.
---

# Dispositions

A disposition is an agent's versioned post-call output: a set of typed
values (an outcome category, fields, verdicts) produced after every
completed call and delivered with the call's webhook and on the
Conversations page. Read [how dispositions work](references/how-it-works.md)
before explaining or diagnosing anything. Routes and bodies:
[API reference](references/api.md). Values, schemas, transformation:
[definition](references/definition.md). Do not write fetch scripts and do
not search the docs for these routes.

Not this skill: evaluation judges and their rubrics
([evaluations](../evaluations/SKILL.md)); call cohorts and counts
([analytics-cohorts](../analytics-cohorts/SKILL.md)); fields the agent
collects during the call ([v2-snapshot](../v2-snapshot/SKILL.md)).

## Page context

Call `get_dashboard_page_context` (`mode: "synced"`) first. Take `agentId`,
`dispositionId` and `runId` from `route.params`.

- `/dashboard/agent/$agentId/dispositions`: opens the first disposition, or
  an unsaved new editor when there are none.
- `…/dispositions/$dispositionId`: the editor. `?value=<key>` is the open
  value.
- `…/dispositions/$dispositionId/runs/$runId`: a test run. `?call=` is the
  open call, `?compare=` the baseline run.
- `/dashboard/agent/$agentId/outcomes/*`: redirects to Dispositions.
- Conversations pages: no call id in the route. Ask for it or read the
  visible text.

No write refreshes the editor. After each one say: "Saved through the API.
The page shows it after a refresh." An open test run page updates itself
while the run is in progress.

## Workflows

Steps and call budgets: [workflows](references/workflows.md).

1. **Set up from scratch.** Interview (what uses the result, categories
   with rules, fields and types, timing, delivery) → propose → create
   (disabled) → test the draft on about 10 recent calls → show results,
   fix with draft ops → estimate → confirm → publish → read `call-runs`
   after the next live call.
2. **Change a live disposition.** Draft ops only; test draft and published
   on the same call ids and show the differences; estimate; publish.
   Rollback restores an earlier version.
3. **Calibrate.** Correct wrong values on a finished run (40+ character
   reason), align for proposed wording changes, apply the accepted ones,
   re-test the same calls.
4. **Backfill.** Availability → backfill estimate → confirm count and cost
   → create → follow.
5. **Diagnose.** Reads only: `call-runs` for the call, then the
   [cause map](references/how-it-works.md#when-it-goes-wrong).
6. **Migrate v1 citations and outcomes.**
   [Migration](references/migration.md).

A question ("how does this work", "why is it blank") is answered from
reads alone.

## Confirm before

Publish, rollback, disable, delete, backfill, `upgrade` migration and every
test run spend credits or change live output:

```text
About to <verb> <object>: <what changes, who is affected, cost or count>.
This <bills about $X per call on every new call | bills about $X for N calls | changes live post-call output | cannot be undone>.
Reply "yes" to proceed.
```

Publish must quote the estimate's expected per-call cost. The publish
drawer does not show it.

## Refusals and limits

- Never send `acknowledgeEstimate: true` without the user's yes to the
  quoted cost.
- Never claim it works from a 201, a publish or a `complete` status.
  Show values from rows or `call-runs`.
- Never invent value `schema`s for variables, extractors or judges. Copy
  them from the catalog.
- Delivery is the call's own post-call webhook; a disposition has no URL.
- Results never change the agent snapshot or the live call.
- 403 `ENTERPRISE_REQUIRED` or 404 "Not found" on every route: dispositions
  are not available to this organization. Say so and stop.
- Limits: 50 values, 3 running test runs and 10 starts an hour per
  organization, 500 calls per test or selected-call backfill, 92-day
  backfill windows.
