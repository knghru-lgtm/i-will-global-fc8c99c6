# How evaluations work

The conceptual page for judges, eval runs, verdicts, the workbench and
verdict tags. Routes and bodies live in the [API map](api.md); the
calibration procedure lives in [workflows](workflows.md). How a simulated
conversation is produced is in
[how agent testing works](../../v2-testing/references/how-it-works.md).

## Contents

- [What it is](#what-it-is)
- [Objects and how they relate](#objects-and-how-they-relate)
- [Lifecycle and states](#lifecycle-and-states)
- [How a verdict becomes a score](#how-a-verdict-becomes-a-score)
- [How it reaches a live call or conversation](#how-it-reaches-a-live-call-or-conversation)
- [On the dashboard](#on-the-dashboard)
- [Rules and limits](#rules-and-limits)
- [When it goes wrong](#when-it-goes-wrong)
- [Questions people ask](#questions-people-ask)

## What it is

An evaluation answers one question about conversations that already
happened: "did the agent do X?" A **judge** reads the evidence of one
conversation and picks a verdict from a rubric the user wrote. An **eval
run** applies a fixed set of judges to a fixed set of conversations and
reports a score per conversation and per judge.

It is not:

- **A test that produces conversations.** Judges only read. Simulated
  conversations come from test cases (see
  [agent testing](../../v2-testing/references/how-it-works.md)); an eval run
  of existing calls generates nothing.
- **A disposition.** [Dispositions](../../dispositions/SKILL.md) write
  structured outcomes onto every completed call automatically. A judge
  runs only when someone starts a run, or when a disposition or a
  promotion check uses it.
- **A guardrail.** Nothing a judge decides changes a call while it is live.
- **Proof of audio behavior.** A text judge reads transcripts and logs. Only
  an audio judge on a recorded call hears the call.

## Objects and how they relate

```text
 ORG-SCOPED or AGENT-SCOPED                    FROZEN AT RUN START
 ┌───────────────────────────┐
 │ Judge (identity)          │  agent_id: a voice agent, or none = org-wide
 │  current_version_id ──────┼──► draft version   (editable)
 │  active_version_id  ──────┼──► published version (archived, immutable)
 └───────────────────────────┘          │
        ▲          ▲                    │ pinned by id
        │          │                    ▼
 ┌──────┴─────┐ ┌──┴──────────────┐  ┌──────────────────────────────┐
 │ Workbench  │ │ Test case roster│  │ Eval run                     │
 │ setup      │ │ (judge+version  │  │  calls[] x judges[]          │
 │  versions  │ │  +weight+target)│  │  agent-snapshots: one frozen │
 │  (roster,  │ └─────────────────┘  │  copy of each judge version  │
 │  threshold,│                      │  call-results ─► judge       │
 │  run_mode) │──── run a panel ───► │   results (verdicts)         │
 └────────────┘                      └──────────────┬───────────────┘
 ┌────────────┐                                     │ optional writes
 │ Test config│── its call ids are sent ──►         ▼
 │ (saved     │                      call tags / pathway tags on the
 │  call list)│                      real calls ("apply")
 └────────────┘
```

- A **judge version** holds the rubric: `prompt_md`, optional
  `system_prompt_md`, `levels`, `target_level_keys`, `weight`, `modality`
  (`text` or `audio`) and `judge_config` (evidence sources and sampling).
- An **attachment** (on a run, a workbench version or a test case) names a
  judge, a version, a weight and the target levels. The attachment's weight
  and targets override the version's defaults.
- A **run** freezes a copy of each attached judge version when it is
  created. Editing or publishing the judge later never changes a past run.
- **Annotations** (human corrections) attach to one call's verdict inside
  one run. **Alignment** reads them and proposes a rubric rewrite.

## Lifecycle and states

### Judge versions

```text
 create judge ──► draft v1 ──PATCH──► draft v1 (edited in place)
                     │
                 publish ──► v1 archived + active ──► new draft v2 opens
                     │
            fork (POST versions, from_version_id) ──► another draft
 PATCH on an archived version ──► 409 IMMUTABLE_VERSION
 DELETE judge ──► gone from every list; past runs keep their snapshots
```

Publish refuses an incomplete draft (400 `INCOMPLETE_EVAL_AGENT_VERSION`):
an empty prompt, a level count other than 0 or 2 to 5, a level missing its
key, label or prompt, or targets on a pass/fail judge.

A roster that pins the **draft's** version id picks up every later PATCH to
that draft until it is published. Pin a published version when two runs must
be comparable.

### Eval runs

```text
 POST /v1/evals/runs ──► PENDING ──► QUEUED ───► RUNNING
   (202)                    │      waiting for     first judge
                            │      scoring         starts scoring
                            │      capacity
                            ▼
                 ┌──────────┼───────────┬───────────┐
              COMPLETE   PARTIAL      FAILED     CANCELLED
              every call  some calls  every call  cancel on PENDING,
              scored      failed,     failed      QUEUED or RUNNING;
                          insufficient            finished results
                          or missing              are kept
```

- All four end states are terminal. Cancel on a terminal run answers 409
  `EVAL_RUN_ALREADY_TERMINAL`. A run is never restarted; start a new one.
- `QUEUED` means no judge is scoring yet. It is not a failure, and it is
  skipped when scoring starts at once.
- One call that ends in insufficient evidence makes the whole run
  `PARTIAL`, even if nothing failed.

### Per call and per judge

| Level | States | Meaning |
|---|---|---|
| Call result | `PENDING`, `QUEUED`, `RUNNING`, then `COMPLETE`, `INSUFFICIENT_EVIDENCE`, `FAILED` | `COMPLETE` when at least one judge produced a score. `FAILED` when every judge errored. `INSUFFICIENT_EVIDENCE` when no judge produced a score and not all errored. |
| Judge result | scored, insufficient evidence, failed | Scored has `selected_level_key`, `score_normalized_0_100` and `is_target_match`. Insufficient evidence has `is_insufficient_evidence:true`, a null score and a null match (`false` when an audio judge found no recording). Failed has `failed:true` and `failure_code` `JUDGE_ERROR`. |

A failed judge result carries a plain message: a temporary rate limit, no
valid structured result, cancelled before it ran, or a generic failure. All
of these can be retried with a new run.

## How a verdict becomes a score

```text
 graded judge, levels in order worst ─► best (2 to 5)
   selected level ─► 0 ... 100, evenly spaced; a level keyed
                     "inconclusive" is left off the scale
 pass/fail judge (0 levels)
   verdict "pass" ─► 100     verdict "fail" ─► 0
 insufficient evidence or failed ─► no score

 call score = weighted mean of the scored judges (weight > 0)
              in the run's mode; text and audio sub-scores too
 run score  = mean of the call scores
 overall_pass = run score >= pass_threshold_pct (null when no threshold)
```

- **Target match** is separate from the score. It is true when the selected
  level is one of the attachment's targets. It is null when the judge had
  insufficient evidence or the attachment has no targets.
- A pass/fail judge has no targets on its version. Attach it with
  `target_level_keys: ["pass"]` on runs, test-case rosters and workbench
  panels (the workbench does this for you), or its target match stays null
  and it never counts as passing. The verdict chip still reads "Passed".
- `summary.target_match_count` counts judge verdicts on target across all
  calls, not calls. With three judges and ten calls the ceiling is 30.
- A weighted score and a target-match rate answer different questions.
  Report the one the user asked for, with its denominator.

## How it reaches a live call or conversation

Judges are read-only toward live traffic. The only paths from a verdict to
anything a caller or a teammate sees:

| Path | When it happens | What changes |
|---|---|---|
| Eval run on existing calls | When a run is started | Nothing on the calls. Results live on the run. |
| Apply verdicts as tags | Only on `POST …/runs/{id}/apply` | Each scored verdict's level label is merged into the real calls' review tags (`call_tags`) or pathway tags (`pathway_tags`). |
| Test case simulation | On `/simulate` | New simulated conversations, scored by the case's roster. No production call changes. |
| Promotion checks | On a check run for an environment | Promotion waits until the required judges pass. See [agent environments](../../agent-environments/SKILL.md). |

What the judge sees is decided by the version's
`judge_config.context_sources`, frozen into the run. A judge sees only the
sources listed. For a call that lacks a source (no tool calls, no recording)
that part of the evidence is empty, and a well-written rubric returns
insufficient evidence instead of guessing.

- **Text judges** read transcript and logs. **Audio judges** need the call
  recording. An audio judge on a call with no recording returns insufficient
  evidence with "No call recording was attached to this call".
- **Run mode** filters judges at run start: `text` keeps text judges,
  `audio` keeps audio judges, `full` keeps both. A judge that does not match
  is dropped silently. If none is left the run is refused (400
  `NO_RUNNABLE_AGENTS`).
- **Simulations** are scored in text mode only, and their judges can see
  only the sources a simulated conversation produces: transcript, call
  metadata, pathway logs and semantics, variables, call config, pathway
  config, persona config and tool logs. Recording, call metrics, transfer
  context, dispositions, webhooks, memory and notes are empty there. An
  audio judge on a test case is scored as a text judge on the transcript.
- **Timing.** Runs are asynchronous. With `async` omitted (the default) the
  run takes the delay-tolerant lane and can take a while to start. Send
  `async:false` only when the user is waiting on the verdict.
- **Versions.** An omitted `eval_agent_version_id` resolves to the judge's
  draft at the moment the run starts. Publishing does not re-score anything.

## On the dashboard

The Evaluations section has an org twin (`/dashboard/judges/...`) and an
agent twin (`/dashboard/agent/<agent id>/judges/...`).

| Page | What it shows | Notes |
|---|---|---|
| Judges (`judges/agents`) | Judges for the org, or for this agent | New judge: Blank, Templates (shipped or saved), or Generate from a prompt, conversation comments or a triage issue. |
| Judge detail (`judges/agents/<judge id>`) | Rubric editor, levels and colors, evidence sources, Save and Publish | **Test** runs the version on screen against recent production calls, specific calls, or simulated calls. The Testing rail lists those runs. |
| Judge testing view | Per-call verdicts, "Refute / correct" on each verdict, revision history, compare two runs, align | Compare runs is computed in the browser. |
| Test cases (`judges/test-cases`) | Simulated-caller cases, rosters, source calls, conversations | The org tab lists only cases a pathway or persona still owns, with a move action. |
| Runs (agent only, `judges/runs`) | Multi-case runs, promotion check runs, the starter run | A multi-case run is kept in the browser that started it. |
| Workbench (`judges/workbench`) | Saved judge panels, cost preview, results, verdict tags, analysis, export | No tab links to it; open it by its address. |

- Verdict chips show the level's label; a pass/fail judge shows "Passed" or
  "Did not pass"; nothing scored shows "No verdict". Run status pills read
  Pending, Queued, Running, Complete, Partial, Failed, Cancelled.
- The workbench UI holds up to 10 judges per panel; the API allows 20.
- Export (CSV or JSON) is built in the browser from the call results.
- The open page refreshes by itself after judge create, edit, fork, publish
  and copy, `POST /v1/evals/runs`, and test-case create, edit, roster and
  source-call writes. After annotations, alignment, analysis, apply,
  workbench, test configs and deletes, say: "Saved through the API. The page
  shows it after a refresh."
- If every evaluation route answers 404 `EVALS_DISABLED`, the pages show
  "Judges are disabled". Evaluations are not enabled for this organization;
  the user contacts support.

## Rules and limits

| Rule | Limit or default | What the user sees |
|---|---|---|
| Calls per run | 1 to 5,000, all from this org | 404 `CALL_NOT_FOUND` naming the missing ids |
| Judges per run | Up to 50, no judge twice | 400 `DUPLICATE_ATTACHED_AGENT` |
| Judges per workbench version | Up to 20 (10 in the UI) | 400 on save or publish |
| Levels | 0 (pass/fail) or 2 to 5; key up to 64, label up to 80 | 400 `INCOMPLETE_EVAL_AGENT_VERSION`, `INVALID_TARGET_LEVEL` |
| Weight | 0 to 100; 0 means the judge never moves the score | none |
| `pass_threshold_pct` | Integer 0 to 100, or null | `overall_pass` stays null without it |
| Run metadata | Keys 1 to 40 chars, values up to 500 | 400 |
| Run submissions | 30 per minute per org by default | 429 `RATE_LIMITED` |
| Corrections | 300 per hour per org; explanation 40 to 4,000 chars; run must be terminal | 429; 400; 409 `RUN_NOT_TERMINAL` |
| Alignments | 60 per hour per org; needs corrections on that run for that judge version | 429; 400 `EVAL_ALIGNMENT_NO_CORRECTIONS`; 409 `EVAL_ALIGNMENT_VERSION_MISMATCH` |
| Analysis | One at a time per run, terminal runs only | 409 `ANALYSIS_ALREADY_RUNNING`, `RUN_NOT_TERMINAL` |
| Apply tags | `call_ids` or result ids, up to 10,000 each | 400 when both are empty |
| Org caps (defaults) | 1,000 judges, 200 workbench setups, 100 versions per setup, 500 saved templates | 409 `RESOURCE_LIMIT_REACHED` |
| Billing | A billing record and an allowed plan | 402 `BILLING_RECORD_REQUIRED`, `BILLING_NOT_ALLOWED` |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| Run sits in `QUEUED` | Waiting for scoring capacity, often on the default delay-tolerant lane | `status`, `completed_atom_count` not moving yet | Wait; do not start a duplicate. Use `async:false` next time if someone is waiting. |
| Run is `PARTIAL` with no failures | At least one call came back insufficient evidence | `summary.insufficient_evidence_count` > 0 | Read those calls' reasoning; add the missing evidence source or narrow the cohort. |
| Every audio verdict is insufficient | The calls have no recording | The insufficient-evidence message names the recording | Use recorded calls, or a text judge. |
| A judge vanished from the results | Its modality does not match `run_mode` | `agent-snapshots` lacks it | Use `full`, or the matching mode. |
| Pass/fail judge never "passes" in a summary | Attached without `["pass"]` as target | `is_target_match` is null on every result; `assertions[].passed` is null | Re-attach with `target_level_keys: ["pass"]`. |
| Same calls, different scores in two runs | Different judge version, or the roster pinned a draft that was edited | Compare `agent-snapshots` of both runs | Pin a published version; re-run. |
| Verdict tags missing on some calls | Result unscored or a pass/fail judge (no label) | `skipped_call_ids` in the apply response | Apply only graded, scored results. |
| `JUDGE_ERROR` on many results | Temporary rate limit or malformed judge output | `failure_code` and its message | Re-run the failed calls; simplify very long evidence by trimming `context_sources`. |
| Run missing from the agent's run list | Created without `agent_id` | `GET /v1/evals/runs/{id}` shows no agent | Send `agent_id` from the page on every run. |

## Questions people ask

**Does publishing a judge re-score old runs?** No. Every run keeps the
judge copy it started with. Run again to see the new rubric.

**Why did a run come back `PARTIAL` when every verdict looks fine?** One
call had no scorable verdict (insufficient evidence) or a judge errored on
it. Count `failed_call_count` and `insufficient_evidence_count`.

**Is "inconclusive" the same as insufficient evidence?** No. A level keyed
`inconclusive` is a rubric level the judge chose; it gets no 0 to 100
score and counts as a non-match unless it is a target. Insufficient
evidence is the judge declining to decide, with no score and no match. At
the call level both leave no score, so a call whose only verdicts are
`inconclusive` is counted as insufficient evidence.

**What does the composite score mean?** The weighted average of the scored
judges on each call, averaged over calls. Judges with insufficient evidence
or errors are left out, so check the counts before trusting the mean.

**Can I undo applied tags?** Not through this API. Apply merges labels into
the calls' existing tags and never removes any. Confirm the count first.

**Do evaluations cost money?** Yes. Estimate first with the same body; the
estimate returns `estimated_cost_usd_cents` and the number of judgments.

**Why does a simulated judge test not show my edits?** The run froze the
version at start. Save the draft, then test again.

**Can a judge see my agent's prompt?** Only if its evidence sources include
the agent, pathway or call configuration. It sees only the sources its
version lists.
