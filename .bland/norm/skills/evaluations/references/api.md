# Evaluation API map

Verified contract notes for judges, test cases, eval runs and workbench panels.
Placeholder IDs below must come from reads or creates in the intended
organization. Reads go through `bland_api_get` (query values are strings).
Writes go through `call_bland_api` with `{method, path, body}`. Do not write
fetch scripts and do not search the docs for these routes.

## Contents

- [Page context and refresh](#page-context-and-refresh)
- [Judge identity and rubric are separate resources](#judge-identity-and-rubric-are-separate-resources)
- [Judge configuration](#judge-configuration)
- [Test scenario with attached judges](#test-scenario-with-attached-judges)
- [Test cases from calls](#test-cases-from-calls)
- [Evaluate existing calls](#evaluate-existing-calls)
- [Run create: remaining fields](#run-create-remaining-fields)
- [Workbench panels](#workbench-panels)
- [After a run](#after-a-run)
- [Confirm before](#confirm-before)

## Page context and refresh

Call `get_dashboard_page_context` first. On judge pages, take `agentId` and
`evalAgentId` from `route.params`.

| Pathname | Yields |
|---|---|
| `/dashboard/judges/agents/<judge id>` | an org-wide judge |
| `/dashboard/agent/<agent id>/judges/agents/<judge id>` | a judge scoped to a voice agent; send that `agent_id` on runs |
| `/dashboard/agent/<agent id>/judges/workbench` | workbench panels for the agent |
| `/dashboard/agent/<agent id>/judges/test-cases` | test cases and their rosters |
| `/dashboard/agent/<agent id>/judges/runs` | multi-case runs (see [Test cases from calls](#test-cases-from-calls)) |
| `/dashboard/agent/<agent id>/dispositions` | dispositions; read the [dispositions skill](../../dispositions/SKILL.md) |

The open page refreshes by itself only after: judge create, judge identity or
version PATCH, judge fork, publish and copy, `POST /v1/evals/runs`, test-case
create and PUT, roster PUT and POST, `POST …/source-calls`, and
`POST …/run`. After any other write (`/simulate`, annotations, alignment,
analyze, apply, workbench setups, test configs, deletes, owner moves,
regenerate) say: "Saved through the API. The page shows
it after a refresh."

## Judge identity and rubric are separate resources

| Operation | Route | Contract / next step |
|---|---|---|
| List/create judges | `GET /v1/evals/agents[?agent_id=]`, `POST /v1/evals/agents` | Create with optional `name`, `description`, `modality` (`text` or `audio`), `agent_id`, and one seed: `template_key` or `user_template_id` (the user template wins when both are sent). Do not send rubric fields here. |
| Read judge | `GET /v1/evals/agents/{id}` | Obtain `current_version_id` (the draft) and `active_version_id` (published). `agent_id` means the voice agent, not another judge. |
| Read/edit version | `GET /v1/evals/agents/{id}/versions/{version_id}`, `PATCH` same path | Edit `prompt_md`, `system_prompt_md`, `levels`, `target_level_keys`, `weight`, `modality`, `judge_config`. Only the editable draft accepts a PATCH; an archived version answers 409 `IMMUTABLE_VERSION`. |
| Fork version | `POST /v1/evals/agents/{id}/versions` | Optional `from_version_id`; follow with a version edit. |
| Publish judge | `POST /v1/evals/agents/{id}/publications` | Archives the draft, points `active_version_id` at it, and opens a new draft. Read back both pointers; do not confuse this with publishing a voice agent. |

Minimal identity request:

```json
{"name":"Confirms before booking","modality":"text"}
```

Example PATCH body for an existing editable judge version:

```json
{
  "prompt_md":"Determine whether the agent requested and received explicit confirmation before committing a booking. Cite the relevant turns. If the supplied evidence cannot establish the criterion, return is_insufficient_evidence=true and selected_level_key=null in the structured judge result, explaining the missing evidence in reasoning_md. Do not infer failure or commitment from missing evidence.",
  "levels":[
    {"level_key":"not_confirmed","label":"Not confirmed","prompt_md":"The agent committed a booking without prior explicit caller agreement."},
    {"level_key":"confirmed","label":"Confirmed","prompt_md":"The caller explicitly agreed before the booking was committed."}
  ],
  "target_level_keys":["confirmed"]
}
```

Order scored levels worst to best: numeric scoring maps the first to 0 and the
last to 100. Target keys specify the passing level independently.

Only judge what the chosen evidence can establish. If backend commitment is not
observable in transcript evidence, add `tool_logs` to
[`judge_config.context_sources`](#judge-configuration) or report insufficient
evidence; do not infer commitment from reassuring language alone.

- Restrict this judge's cohort to applicable booking cases. Report cases with no
  booking attempt as not applicable, separately from scored results. If cohort
  eligibility is unknown, establish it before claiming a booking pass rate.
- Missing evidence uses the judge's structured `is_insufficient_evidence:true`
  and `selected_level_key:null` (or `verdict:null` for a pass/fail judge), not a
  custom failure or "inconclusive" level. These are judge output fields, not new
  PATCH configuration keys. Prompt wording alone does not prove compliance:
  inspect the actual result and its explanation of the missing evidence.
- The literal custom level `inconclusive` is excluded from numeric scoring in
  the current contract, but can still produce `is_target_match:false` (a non-match). It is not
  equivalent to the structured insufficient-evidence flag.
- Insufficient-evidence results have null score/target match and are excluded
  from scoring; they are not passes. A simulation summary can still count an
  all-insufficient call in its unsuccessful total. Report that separately from
  observed behavior failures and include the scored denominator.

## Judge configuration

`judge_config` lives on the version and is frozen into every run that uses it.
A PATCH merges its keys into the stored object; `context_sources` is replaced
as a whole list.

| Key | Contract |
|---|---|
| `context_sources` | 1 or more unique values from: `transcript`, `call_metadata`, `pathway_logs`, `pathway_semantics`, `transfer_context`, `disposition_results`, `citation_variables`, `post_call_webhook`, `tool_logs`, `variables`, `analysis`, `call_metrics`, `call_config`, `agent_config`, `pathway_config`, `persona_config`, `contact_memory`, `call_notes`, `generated_call_log_files`, `full_call_log_data`, `audio_recording`. The judge sees only what is listed. |
| `model_profile_key` | Leave unset for the organization default. Copy a key only from an existing version or from the user. A key that is not selectable answers 400 `INVALID_MODEL_PROFILE`. |
| `temperature` | 0 to 2, or null. |
| `max_output_tokens` | 1 to 64000, or null. |

```json
{"judge_config":{"context_sources":["transcript","tool_logs","variables"],"temperature":0}}
```

Level modes. A runnable version is either **graded** (2 to 5 levels, each
`level_key` up to 64 chars, `label` up to 80, `prompt_md`, optional `color`)
or **pass/fail** (exactly 0 levels, no `target_level_keys`). A draft may hold
any count while it is being edited, but 1 level or more than 5 cannot run or
publish. Every target key must name an existing level (400 `INVALID_TARGET_LEVEL`).

Identity changes. `PATCH /v1/evals/agents/{id}` accepts `name`, `description`,
`metadata`, `active_version_id` (repoint the published version, or `null`), and
`agent_id` (move the judge to another voice agent, or `null` for org-wide).
Moving a judge changes which agent's dispositions can pick it, so `agent_id`
needs an editing role.

Copy and delete.

- `POST /v1/evals/agents/{id}/copies` with `{"agent_id":"<agent id>"}` creates
  a new judge under that voice agent, seeded from the source's published
  version (else its draft). Workbench and check attachments do not follow.
- `DELETE /v1/evals/agents/{id}` soft-deletes. Past runs keep their frozen
  snapshots; the judge leaves every list. Confirm first.

Seeds.

| Seed | Route | Notes |
|---|---|---|
| Shipped templates | `GET /v1/evals/agent-templates`, `GET /v1/evals/agent-templates/{template_key}` | Create with `template_key`. |
| Saved org templates | `/v1/evals/user-templates` (GET, POST; GET, PATCH, DELETE `/{id}`) | Create a template from a judge with `from_agent_id` and `from_version_id`, or from inline rubric fields. `visibility` is `private`, `org` or `public`. Create a judge with `user_template_id`. |
| Draft from evidence | `POST /v1/evals/agent-drafts/from-triage` | Returns a **draft rubric, not a judge**. Create the identity, then PATCH its draft version with the returned `draft` fields. |

The draft body is one of `{source_type:"triage_issue", issue_id}`,
`{source_type:"triage_flag", issue_id, flag_id}`,
`{source_type:"call_note", note_id, call_id?}` (each with optional
`example_call_ids`, up to 100), or `{source_type:"prompt", prompt_text}` (up to
6000 chars). The draft has three levels: `observed_issue`, `not_observed`,
`inconclusive`. **Targets are inverted by source.** A triage issue, flag or call
note describes a defect, so the target is `not_observed`. A prompt describes the
wanted behavior, so the target is `observed_issue`. Keep the returned
`target_level_keys`; do not "fix" them to match the other source.

## Test scenario with attached judges

1. `POST /v1/agent-testing/scenarios`: create the caller case using the
   [testing contract](../../v2-testing/SKILL.md). Keep the returned scenario ID.
2. `GET /v1/agent-testing/scenarios/{id}/eval-agents`: inspect existing attachments.
3. `POST /v1/agent-testing/scenarios/{id}/eval-agents`: attach one judge:

   ```json
   {"eval_agent_id":"<judge UUID>","eval_agent_version_id":"<version UUID>","weight":100,"target_level_keys":["confirmed"]}
   ```

4. `PUT` on that collection replaces the roster; prefer POST for an additive
   attachment so existing judges are not accidentally removed.
   `DELETE /v1/agent-testing/scenarios/{id}/eval-agents/{eval_agent_id}`
   detaches one judge. Read back after either.
5. `POST /v1/agent-testing/scenarios/{id}/simulate` with
   `{"simulations_count":3}` starts conversation generation and scoring, returning
   202 and a `simulation_set_id`. This is not a completed score. The case needs
   at least one attached judge (else 400). The count defaults to 5 and is cut to
   50; the plan's per-test cap (10 by default) and per-minute conversation
   budget answer 429. A pass/fail judge needs `"target_level_keys":["pass"]` on
   its attachment, or its verdicts never count as on target.
6. Poll `GET /v1/agent-testing/simulation-runs/{simulation_set_id}/results`.
   Despite the route name, this endpoint accepts the **set ID** returned by
   `/simulate`, not an individual run ID.
   The assembled result has `summary`, `assertions`, and `logs`.
   `summary.eval_run_id` stays null and the arrays empty until every
   conversation has been generated; scoring starts after that.
   That is not proof that no judges were attached or the test passed.
   The verdict is `assertions[].passed` (at least half of the conversations
   on target). `summary.passed` and `logs[].passed` only mean the
   conversations were scored cleanly.
7. Reconcile all three requested simulations against `logs[]` and
   `summary.total_calls` after generation/scoring. Each `logs[].run_id` identifies
   an individual scenario run; read `GET /v1/agent-testing/runs/{run_id}` for its
   details. One returned log is not evidence all three succeeded. Inspect the
   linked evaluation run when available; report execution status, judge
   assertions, conversation evidence, and missing/failed results separately.

The `/scenarios/{id}/run` → `/runs/{id}` inline-assertion workflow is different
from `/simulate` → `/simulation-runs/{id}/results`. Use the matching read path.
Agent-owned cases always run the agent's latest saved version with dev
variable values; `version_number` applies only to v1 pathway cases. Each
conversation run records the version it ran in `metadata.agent_version_id`.
To score a specific candidate, use a promotion check run; see
[agent environments](../../agent-environments/SKILL.md).

## Test cases from calls

A simulated-caller test case (`scenario_type` `AGENT`, the default) can carry
production calls as evidence for its caller persona.

| Operation | Route | Contract |
|---|---|---|
| Create from calls | `POST /v1/agent-testing/scenarios` with `source_call_ids` | 1 to 50 production call IDs of this org. Other scenario types refuse them. Send the generated `tester_persona_prompt` too, or the calls stay pending. |
| List evidence | `GET /v1/agent-testing/scenarios/{id}/source-calls` | Each call shows whether the persona already reflects it. |
| Add evidence | `POST /v1/agent-testing/scenarios/{id}/source-calls` with `{"call_ids":[…]}` | 1 to 50 per request. Attaches only; the persona does not change. Returns `added_count`. |
| Fold evidence in | `POST /v1/agent-testing/scenarios/{id}/source-calls/regenerate` | Rewrites `tester_persona_prompt` from pending calls with a model pass. 409 when calls are still finishing (wait about ten minutes after the call ends) or the case changed meanwhile. |
| Move to an agent | `POST /v1/agent-testing/scenarios/{id}/owner` with `{"agent_id":"<agent id>"}` | Moves a case a v1 pathway or persona owns onto a v2 agent. A case that an agent already owns stays put (409). A name clash on the target is 409. |

Multi-case runs on the Runs page are batches the browser keeps in its own
storage. The server has no batch resource. A `/simulate` you start shows under
its test case, not as one run on that page. Say so when you report.

## Evaluate existing calls

| Operation | Route / notes |
|---|---|
| Save a cohort | `POST /v1/evals/test-configs` with `name` and `call_ids` (1 to 5000); `GET`, `PATCH`, `DELETE /v1/evals/test-configs/{id}` |
| Estimate | `POST /v1/evals/runs/estimates`, using the same body planned for the run |
| Start | `POST /v1/evals/runs`, returns 202 and an asynchronous run |
| Status | `GET /v1/evals/runs/{run_id}` |
| Call results | `GET /v1/evals/runs/{run_id}/call-results?include_agent_results=true`; follow documented pagination |
| Judge results | `GET /v1/evals/runs/{run_id}/agent-results` |
| Frozen roster | `GET /v1/evals/runs/{run_id}/agent-snapshots` |
| Cancel | `POST /v1/evals/runs/{run_id}/cancellations`, only when requested/authorized |

Selection example (not executable until real IDs are supplied):

```json
{
  "call_ids":["<call ID>"],
  "attached_agents":[{"eval_agent_id":"<judge UUID>","eval_agent_version_id":"<version UUID>"}],
  "run_mode":"text",
  "pass_threshold_pct":100
}
```

`call_ids` is required (1 to 5000). Do not replace it with an invented
`test_config_id`: read the saved cohort and send its IDs. `attached_agents`
holds up to 50 judges; an omitted `eval_agent_version_id` resolves to the
judge's current draft. `run_mode` is `text`, `audio` or `full` (default `full`).
To run a saved panel instead, see [Workbench panels](#workbench-panels). Use
the actual estimate's counts and `estimated_cost_usd_cents`, never hardcoded
pricing.

Run statuses: `PENDING`, `QUEUED`, `RUNNING`, then `COMPLETE`, `PARTIAL`, `FAILED`,
or `CANCELLED`. Queueing is not a failed judge. `PARTIAL` also covers a run
where nothing failed but one call came back insufficient evidence. A run's `error_code` /
`error_message` describe execution; per-judge `failed`, `failure_code`, and
`is_insufficient_evidence` must be distinguished from `is_target_match:false`.

Refusals: 402 `BILLING_RECORD_REQUIRED` or `BILLING_NOT_ALLOWED` (hand to
billing), 429 `RATE_LIMITED` (30 submissions a minute by default; wait, do
not retry in a loop), 404 `CALL_NOT_FOUND` (an ID outside this org), 400
`NO_RUNNABLE_AGENTS` (no attached judge matches `run_mode`).

## Run create: remaining fields

| Field | Contract |
|---|---|
| `agent_id`, `agent_version_id` | The voice agent and its version. Agent-scoped judge pages (the Testing rail, the workbench run list) filter on `agent_id`. Without it the run is missing there. Take it from `route.params`. |
| `async` | Omitted means `true`: the delay-tolerant lane, so completion can be slow. Send `false` only when the user is waiting on the verdict. |
| `triggered_by` | `manual` (default), `auto` or `backfill`. |
| `metadata` | String to string, keys 1 to 40 chars, values up to 500. `name` is shown as the run name. |

Judge test runs. When the user tests one judge from its page, send exactly one
attached judge pinned to the version under test, plus three metadata markers.
The judge's Testing rail lists runs by these markers, and comparison reads the
version from them.

```json
{
  "call_ids":["<call ID>"],
  "attached_agents":[{"eval_agent_id":"<judge UUID>","eval_agent_version_id":"<version UUID>","weight":100,"target_level_keys":["confirmed"]}],
  "run_mode":"text",
  "agent_id":"<agent UUID>",
  "triggered_by":"manual",
  "metadata":{"judge_test":"1","judge_test_population":"production","judge_test_version":"<version UUID>"}
}
```

`judge_test_population` is `production` for real calls or `simulated` for
calls a simulation produced.

List runs: `GET /v1/evals/runs` with optional `agent_id`, `agent_version_id`,
`eval_agent_id`, `workbench_setup_id`, `status` (a run status above),
`triggered_by`, `limit` (1 to 100), `starting_after`, `ending_before`. A bad
`status` or `triggered_by` answers 400 `invalid_filter`. List items carry
`metadata` but not the attached roster; read `agent-snapshots` for that.

## Workbench panels

A workbench setup is a saved, versioned panel of judges. Its identity holds
`current_version_id` (the draft) and `active_version_id` (published).

| Operation | Route | Contract |
|---|---|---|
| List/create | `GET`, `POST /v1/evals/workbench-setups` | Create with optional `name`, `description`, `agent_id`. Returns the setup and its first draft. |
| Read/edit/delete | `GET`, `PATCH`, `DELETE /v1/evals/workbench-setups/{setup_id}` | PATCH `name`, `description`, `metadata`, or `active_version_id` (`null` un-publishes). |
| Versions | `GET`, `POST /v1/evals/workbench-setups/{setup_id}/versions` | POST forks a draft; optional `from_version_id`, `name`, `description`. |
| Read/edit version | `GET`, `PATCH …/versions/{version_id}` | Only the draft is editable (409 `IMMUTABLE_VERSION`). |
| Publish | `POST /v1/evals/workbench-setups/{setup_id}/publications` | Archives the draft, makes it active, opens a new draft. |

Version fields:

| Field | Contract |
|---|---|
| `attached_agents` | Up to 20, each `{eval_agent_id, eval_agent_version_id, weight (0 to 100), target_level_keys (1 or more)}`, no judge twice. |
| `pass_threshold_pct` | Integer 0 to 100, or null. |
| `run_mode` | `text`, `audio` or `full`. |
| `default_test_config_id`, `default_call_ids` | The panel's default cohort (up to 5000 IDs). The run does not apply it for you. |

Publish refuses an empty roster (400 `EMPTY_SETUP`), a judge listed twice
(400 `DUPLICATE_ATTACHED_AGENT`), or a judge without a version or target
(400 `INVALID_BODY`).

Run a panel. Send `workbench_setup_id` and `workbench_setup_version_id`
together, plus `call_ids` (read them from `default_call_ids` or the default
test config). `attached_agents` may then be omitted: the version's pinned roster
is used. A non-empty `attached_agents` replaces that roster entirely. `run_mode`
and `pass_threshold_pct` default from the version. A setup id without a
version id answers 400 `INVALID_BODY`; a version from another setup answers
400 `INVALID_WORKBENCH_SETUP_VERSION_ID`.

```json
{"call_ids":["<call ID>"],"workbench_setup_id":"<setup UUID>","workbench_setup_version_id":"<setup version UUID>","agent_id":"<agent UUID>"}
```

## After a run

**Annotations (human corrections).** The run must be terminal (409
`RUN_NOT_TERMINAL`).

- `PUT /v1/evals/runs/{run_id}/call-results/{call_id}/annotations` appends one
  revision. Nothing is overwritten; the judge's own verdict is kept as
  `original`. Limit: 300 per hour per organization.
- `GET` the same path for one call's history; `GET /v1/evals/runs/{run_id}/annotations`
  for the whole run (bounded; `truncated:true` when cut).
- Body `{eval_agent_id, corrected, explanation}`. `corrected` is one of
  `{"kind":"level","level_key":"<key>"}`, `{"kind":"insufficient_evidence"}`,
  `{"kind":"reasoning_only"}`. `explanation` is 40 to 4000 characters after
  trimming. Say why, in terms of the evidence.

```json
{"eval_agent_id":"<judge UUID>","corrected":{"kind":"level","level_key":"confirmed"},"explanation":"The caller says yes at turn 6 before the booking tool runs at turn 7, so confirmation came first."}
```

**Alignment (a proposal only).**
`POST /v1/evals/agents/{id}/versions/{version_id}/alignments` with
`{"run_id":"<run UUID>","instructions":"<optional, up to 4000>"}`. The version
must be the one the run graded with (409 `EVAL_ALIGNMENT_VERSION_MISMATCH`), and
the run needs corrections for this judge (400 `EVAL_ALIGNMENT_NO_CORRECTIONS`).
It returns `proposal` (`prompt_md`, `system_prompt_md`, `levels` with the same
keys and labels), `rationale_md`, `corrections_used`, `calls_with_evidence`.
Nothing is saved. Show the proposal; to apply it, PATCH the draft version with
it. Limit: 60 per hour per organization.

**Analyze.** `POST /v1/evals/runs/{run_id}/analyze` answers 202 and runs a
model pass over the flagged verdicts. Poll `GET /v1/evals/runs/{run_id}` until
`summary.analysis.analyzed_at` is set or moves. 409 `RUN_NOT_TERMINAL` or
`ANALYSIS_ALREADY_RUNNING`. A re-run overwrites the previous analysis.

**Apply verdicts as tags (a production write).**
`POST /v1/evals/runs/{run_id}/apply` with `targets` (`call_tags`,
`pathway_tags`, or both) and optional `call_ids` or `eval_run_agent_result_ids`
(each up to 10000). It writes each scored result's level label onto the real
calls: `call_tags` merges into the call's review tags, `pathway_tags` merges
into its pathway tags. Results with no label are skipped. The response counts
`updated_call_count` and lists `skipped_call_ids`. REQUIRED confirm.

## Confirm before

Use this template for apply, judge `DELETE`, and roster `DELETE` or `PUT`:

```text
About to <verb> <object>: <what changes, who is affected, count>.
This <writes tags onto N production calls | cannot be undone>.
Reply "yes" to proceed.
```

Billed runs (`POST /v1/evals/runs`, `/simulate`) state the estimate first.
