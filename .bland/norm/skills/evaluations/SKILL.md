---
name: evaluations
description: Use when creating or calibrating Bland evaluation judges ("align this judge", "correct this verdict"), configuring test cases and attached judges, building judge workbench panels, running or interpreting evaluations and simulations, applying verdicts as call tags, or investigating failed, partial, or inconclusive scores. Distinguishes voice agents, evaluation judges, test scenarios, saved call cohorts, and asynchronous run results.
---

# Evaluation work

Use API operations and workspace code, not dashboard clicks, to build and run
evaluations. Read [workflow and evidence](references/workflows.md) and the
[API map](references/api.md) for the chosen task. Follow
[API identity and permission rules](../api-workspace/references/api.md).
Do not write fetch scripts and do not search the docs for these routes.
To explain how judges, runs, verdicts and scores fit together, or why a run
ended `PARTIAL`, read [how evaluations work](references/how-it-works.md).

Choose the right object before writing:

- A **voice agent** is the system being tested.
- An **evaluation judge** scores one dimension, with a versioned rubric.
- A **test scenario** defines a simulated caller and its inputs. It may attach
  evaluation judges; it is not the same as a saved list of real calls.
- A **test config** is a reusable cohort of existing call IDs.
- A **run** is one execution with fixed inputs and judge snapshots.

Required loop:

1. Define the observable pass condition and needed evidence.
2. Fetch/create the judge, then edit its version, not the identity object.
3. Calibrate on known examples, including a failure and an inconclusive case,
   with the [platform loop](references/workflows.md#calibrate-the-judge).
4. Attach the intended judge version to the scenario or run.
5. Estimate supported billed operations and stay within the user's scope.
6. Persist the returned operation ID, follow status, fetch result details.
7. Separate a valid failing verdict from execution failure or missing evidence.
8. Read back changes and request UI synchronization if the host supports it.

Where to look:

- Evidence sources, model, levels, copies, templates and drafts from triage:
  [judge configuration](references/api.md#judge-configuration).
- Saved judge panels: [workbench panels](references/api.md#workbench-panels).
- `agent_id`, `async`, judge-test markers and run lists:
  [run fields](references/api.md#run-create-remaining-fields).
- Corrections, alignment, analysis and tag apply:
  [after a run](references/api.md#after-a-run). Apply writes tags onto
  production calls; confirm first.
- Test cases built from calls: [test cases from calls](references/api.md#test-cases-from-calls).

Do not claim “passed” from a 202, a finished spinner, or `COMPLETE` alone. State
which version was tested, which judge version scored it, the denominator, and
unscored cases. Text evaluations cannot establish audible interruption timing.

For live audio evidence read [voice testing](../v2-testing/references/voice.md).
For agent-testing inline assertions and traces read
[v2 testing](../v2-testing/SKILL.md). These are related but distinct surfaces;
do not substitute one surface's status names or request fields for another's.

Post-call outputs produced on every call (dispositions: their values,
extractors, test runs, corrections, backfills and moving v1 citations and
outcomes) belong to the [dispositions skill](../dispositions/SKILL.md). A
disposition value can pin a published judge version; changing the judge
does not change the disposition until it is repinned and republished.
