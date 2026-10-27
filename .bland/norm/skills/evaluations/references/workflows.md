# Reliable evaluation workflow

## Contents

- [Define before generating](#define-before-generating)
- [Calibrate the judge](#calibrate-the-judge)
- [Simulate and score](#simulate-and-score)
- [Existing-call batches](#existing-call-batches)
- [Diagnose outcome, not just status](#diagnose-outcome-not-just-status)

## Define before generating

- One judge = one observable dimension. A vague “good conversation” rubric is
  not reproducible; separate confirmation, correctness, resolution, and tone.
- Specify what evidence establishes each level and what is inconclusive.
- Keep passing direction explicit. “Issue observed” may be a failure even when
  a positive Boolean sounds like a pass.
- Decide text versus audio based on the claim, not convenience. Silence,
  overlap, pronunciation, or audible emotion requires appropriate audio.
- A test scenario needs a caller goal, all necessary fixture values, and clear
  behavior. A saved cohort contains existing calls; it generates nothing.

## Calibrate the judge

Use the platform loop, not a hand comparison. Routes and bodies are in the
[API map](api.md#after-a-run). Call budget per round: one estimate, one run,
its polls, one results read, one PUT per disagreement, one alignment, one
version PATCH, then the same estimate, run and read again. Stop after three
rounds or when no disagreement is left.

```text
test run -> annotate disagreements -> align -> review proposal
   ^                                                  |
   |                                                  v
compare <- re-run on the same cohort <- PATCH the draft version
   |
   v
publish (only when asked)
```

1. **Pick the cohort.** A small known set with a clear pass, a clear fail and a
   missing-evidence case. Use authorized calls. Freeze the call IDs; save them
   as a test config if the user will come back.
2. **Test run.** Estimate, then `POST /v1/evals/runs` with exactly one judge
   pinned to its draft (`current_version_id`), the judge-test markers and the
   page's `agent_id` ([run fields](api.md#run-create-remaining-fields)). Keep
   the run ID. Poll to a terminal status.
3. **Find disagreements.** Read `call-results?include_agent_results=true`.
   List each call where the verdict differs from the known answer. Keep
   execution failures and insufficient evidence apart from wrong verdicts.
4. **Annotate.** One `PUT …/annotations` per disagreement, with the corrected
   level and a 40 to 4000 character explanation tied to the evidence. Never
   annotate a verdict you have not checked against the call.
5. **Align.** `POST …/versions/{version_id}/alignments` with the run ID and the
   version that run graded with. Nothing is saved yet.
6. **Review the proposal.** Show `rationale_md` and the changed prompts to the
   user. Reject a proposal that names specific calls or callers, or that
   widens the criterion beyond what the user asked.
7. **PATCH the draft.** Apply the accepted `prompt_md`, `system_prompt_md` and
   level prompts to the same draft version. If the run graded a published
   version, fork it first (`POST …/versions` with `from_version_id`) and edit
   the fork.
8. **Re-run on the same cohort.** Same call IDs, run mode and markers, pinned
   to the edited version.
9. **Compare.** Diff the two runs call by call: fixed, regressed, unchanged.
   Report each count and the scored denominator of both runs.
10. **Publish only when asked.** `POST …/publications`, then read back
    `active_version_id`. Test-case rosters, workbench panels and dispositions
    that pin an older version keep it until they are re-pinned.

## Simulate and score

- Use synthetic fixtures and check every reachable integration for side effects.
- Attach the intended judge versions to the test case; fetch the roster back.
- Start the `/simulate` operation once. Record `simulation_set_id` before polling.
- Follow assembled results, then linked evaluation details. Generation finishing
  does not establish that scoring finished.
- Check both behavioral assertions and execution coverage. A completion status
  or a summary with no configured pass threshold is not a universal quality pass.
- Keep the voice-agent candidate stable throughout the comparison.
  `/simulate` always runs the latest saved version; record
  `metadata.agent_version_id` from a conversation run and disclose that a
  save during the comparison changes the candidate.
- Read the verdict from `assertions[].passed`, not `summary.passed`; see
  [how evaluations work](how-it-works.md).

## Existing-call batches

- Build a bounded, reproducible cohort through the API; see
  [call analysis](../../call-analysis/references/retrieval.md).
- Freeze selected call IDs, judge versions, weights, targets, and threshold.
- Estimate, submit, persist run ID, follow status, then page through results.
- Match returned IDs to submitted IDs. Show scored, failed, insufficient, and
  missing counts independently; never silently shrink the denominator.
- A target-match rate and a weighted composite score are different metrics.
  Use the API summary for official rollups and label any local calculations.
- Preserve frozen judge snapshots so later rubric edits do not change the
  interpretation of an earlier report.

## Diagnose outcome, not just status

| Evidence | Meaning / response |
|---|---|
| `failed:true` or execution error | The judge did not successfully score; investigate the service/input, not the agent's quality |
| `is_insufficient_evidence:true` | The available evidence does not support a verdict; request relevant evidence or revise the dimension |
| Successful result with `is_target_match:false` | A genuine non-passing rubric result; inspect quotes and actual behavior |
| `PARTIAL` run | Some calls failed, came back insufficient evidence, or are missing; report coverage and affected IDs |
| Empty in-progress result | Continue following the same job; do not create duplicate runs |
| Passing score with wrong version/fixture | Does not verify the requested candidate |

End with a compact report: target/version, judge/version, cohort, run IDs,
terminal status, counts, passing criterion, evidence-backed failures, and
untested cases. Do not expose model/provider fields from raw audit payloads.
