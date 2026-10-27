# Rollouts and A/B tests (the Experiments page)

A rollout moves live traffic from a baseline onto a candidate, step by step,
with guardrails watching both arms. The agent's Experiments page runs on
rollouts. An A/B test is a rollout with preset `ab`. The model summary is in
the [lifecycle skill](../SKILL.md#rollouts-the-experiments-page); the bare
`/experiments` primitive is in [standalone experiments](lifecycle.md#standalone-experiments).

Do not write fetch scripts and do not search the docs for these routes. Read
with `bland_api_get` (query values are strings); write with `call_bland_api`
(`{method, path, body}`).

## Contents

- [Page context](#page-context)
- [Model](#model)
- [Routes](#routes)
- [Create body](#create-body)
- [Metric names](#metric-names)
- [Actions and their traffic effect](#actions-and-their-traffic-effect)
- [Results and arm calls](#results-and-arm-calls)
- [Workflows](#workflows)
- [Refusals](#refusals)

## Page context

Call `get_dashboard_page_context` (`mode: "synced"`) first. On
`/dashboard/agent/<agentId>/experiments` (overview) or
`/dashboard/agent/<agentId>/experiments/settings` (create or edit), take
`agentId` from `route.params`. No attached-target chip exists for this page.
The page does not refresh after an API write: say "Saved through the API. The
page shows it after a refresh." Do not drive the page's controls to mutate.

## Model

- **Enterprise only.** Every route returns `403 ENTERPRISE_REQUIRED` for other
  orgs. Writes need an editor role.
- **One live rollout per agent.** Live statuses: `running`, `paused`,
  `awaiting_approval` (a plan checkpoint or a reached limit), `tripped` (a
  guardrail paused it). Terminal: `rolled_back`, `finished`. `ended_reason`:
  `completed`, `manual`, `guardrail`, `superseded`.
- **`kind: "version"`**: baseline = the production pin, candidate = another
  version of this agent. It runs an experiment underneath (`experiment_id`).
  It needs a pinned production, no active standalone experiment, and passes
  the staging check policy at start and at finish.
- **`kind: "migration"`**: baseline = a v1 pathway, candidate = this agent's
  production pin. It runs the pathway-to-agent migration split (`split_id`).
- **Presets.** `standard`, `cautious`, `fast` and `custom` are staged ramps:
  steps rise to 100%, then a bake window, then `auto_finish` (default true)
  makes the candidate permanent. `ab` holds one share for as long as it runs;
  `auto_finish` is forced false, so only a person or a limit ends it. Presets
  are labels: the request always carries explicit `steps`.
- **Promote interaction.** While a migration rollout is live, promote returns
  `409 ROLLOUT_IN_PROGRESS`. A promote during a version rollout completes its
  experiment and the rollout settles as `superseded`. Rollback is never
  blocked.

## Routes

All under `/v2/agents/:agentId`. Envelope `{data, errors}`.

| Route | Body or query | Returns |
|---|---|---|
| `GET /rollouts` | none | `{rollouts}` |
| `GET /rollouts/live` | none | `{rollout}` or `{rollout: null}` |
| `GET /rollouts/metric-sources` | none | `{dispositions}`: this agent's published dispositions and their measurable values |
| `GET /rollouts/:rolloutId` | none | `{rollout}` |
| `GET /rollouts/:rolloutId/events` | none | `{events}`: the activity log |
| `GET /rollouts/:rolloutId/metrics` | `?window_hours=` 1 to 336, default 24 | `{metrics}`: both arms over the window |
| `POST /rollouts` | [create body](#create-body) | `{rollout}` |
| `PATCH /rollouts/:rolloutId` | any of `plan`, `guardrails`, `watched_metrics`, `notifications` | `{rollout}` |
| `POST /rollouts/:rolloutId/pause` | none | `{rollout}` |
| `POST /rollouts/:rolloutId/resume` | none | `{rollout}` |
| `POST /rollouts/:rolloutId/advance` | none | `{rollout}` |
| `POST /rollouts/:rolloutId/traffic` | `{traffic_percentage}` integer 1 to 100 | `{rollout}` |
| `POST /rollouts/:rolloutId/step-back` | none | `{rollout}` |
| `POST /rollouts/:rolloutId/rollback` | none | `{rollout}` |
| `POST /rollouts/:rolloutId/finish` | none | `{rollout}` |
| `GET /experiments/:experimentId/metrics` | `?window_hours=` 1 to 336, default 24 | `{metrics}` for a standalone experiment |

A rollout view carries `kind`, `status`, `traffic_percentage` (the candidate share
served now), `current_step` (0-based; equal to the step count while
baking at 100%), `plan`, `guardrails`, `guardrail_verdicts`,
`tripped_guardrail_id`, `limit_reached`, `scheduled_start_at`,
`experiment_id` or `split_id`, and the baseline and candidate version ids.

## Create body

```text
{
  kind: "version", candidate_version_id: <uuid>      (or kind: "migration", pathway_id: <uuid>)
  plan: {
    preset_id: standard | cautious | fast | custom | ab
    steps: 1-12 items (exactly 1 for ab) of
      { id: unique label, traffic: integer 1-100, never lower than the step before,
        hold_hours: 0-336, requires_approval: boolean }
      a staged plan must end at 100
    bake_hours: 0-336
    assignment: call | caller          (caller keeps a repeat caller on one arm)
    min_calls_per_step: integer 0-1000000
    failed_checks_before_acting: integer 1-100
    roll_back_under_sampled_steps: boolean
    auto_finish?: boolean              (default true; always false for ab)
    limits?: { candidate_call_limit?: 1-10000000, starts_at?: ISO, ends_at?: ISO (future, after starts_at),
               run_hours?: { timezone, days: { mon: { start, end }, ... } } }
  }
  guardrails?: up to 25 of
    { id, source, origin: production | rollout, scope: absolute | delta,
      operator: above | below, value, window_hours: 1-168, from_step: 1-13,
      action: notify | pause | roll_back, channel: string, is_enabled: boolean }
  watched_metrics?: up to 25 metric names
  notifications?: null | { transport: webhook | email, channel }
}
```

- `scope: "delta"` compares the candidate against the baseline arm.
- A metric where lower is worse (containment, or an outcome marked `down`)
  requires `operator: "below"`.
- A guardrail on a metric read from the analytics lake needs
  `window_hours` of at least 6; the lake trails by up to an hour.
- Limits gate the candidate without moving the share. `starts_at` and
  `run_hours` are exact per call. `ends_at` and `candidate_call_limit` are
  checked every five minutes; reaching one parks the rollout in
  `awaiting_approval` with `limit_reached` until a person finishes, rolls back,
  or raises the limit and resumes.
- Notifications: a webhook must be an `https://` URL. Email may be refused on
  some deployments ("use a webhook"). Slack is refused. Default to a webhook
  the user names, or none.

Synthetic A/B example: 20% of selector-less traffic on the candidate.

```json
{
  "kind": "version",
  "candidate_version_id": "<candidate version id>",
  "plan": {
    "preset_id": "ab",
    "steps": [{ "id": "ab-share", "traffic": 20, "hold_hours": 24, "requires_approval": false }],
    "bake_hours": 0,
    "assignment": "caller",
    "min_calls_per_step": 50,
    "failed_checks_before_acting": 3,
    "roll_back_under_sampled_steps": false,
    "limits": { "candidate_call_limit": 500 }
  },
  "guardrails": [
    { "id": "transfers", "source": "Transfer to human", "origin": "rollout", "scope": "delta",
      "operator": "above", "value": 5, "window_hours": 6, "from_step": 1,
      "action": "pause", "channel": "", "is_enabled": true }
  ],
  "watched_metrics": ["Average handle time"],
  "notifications": null
}
```

## Metric names

- **Built-in**: the `source` names a metrics response lists in
  `metrics[].source`, for example `Transfer to human`, `Caller hangs up early`,
  `Average handle time` and `Containment rate`. Rows with `is_measured: false`
  cannot be measured yet; do not guard on them.
- **Customer outcomes**: `disposition:<up|down>:<disposition id>:<value id>`,
  plus `:<option key>` for a list-of-options value. `up` means a higher share
  is worse. Build them from `GET /rollouts/metric-sources`. The disposition
  must be this agent's own and published, or the create is refused.

## Actions and their traffic effect

Every write below changes what live callers get or what the ramp does next.
Confirm each one with the template in the [skill](../SKILL.md#confirm-before).

| Action | Effect |
|---|---|
| `pause` | Only from `running`. Holds the share where it is and stops the ramp. |
| `resume` | Restarts a paused or tripped rollout. Starts a scheduled one now. A rollout a limit stopped resumes only after the limit is raised or removed. |
| `advance` | Moves to the next step's share. From `awaiting_approval` this is the approval. Refused for `ab` and at full traffic. |
| `traffic` | Sets the candidate share (1 to 100) and lands on the matching step. Use `rollback` for 0. |
| `step-back` | Drops to the earlier step with less traffic. Stays live. |
| `rollback` | Sends every call back to the baseline. Terminal. |
| `finish` | `version`: **promotes the candidate to production** and ends the rollout. Subject to the check policy (`409 CHECKS_BLOCKED`). Only a production rollback undoes it. `migration`: moves the split to 100% on the agent. Needs explicit approval. |

A rollout that has not started (`scheduled_start_at` set) or that a limit
stopped refuses `advance`, `traffic` and `step-back` with a message naming the
way out.

## Results and arm calls

- `GET /rollouts/:rolloutId/metrics?window_hours=24` returns `window_start`,
  `window_end`, `baseline` and `candidate` arm counts, and `metrics[]` rows of
  `{source, unit, is_measured, baseline, candidate, measured_from, sample?}`.
  `lake_as_of` says how fresh lake-measured rows are. A null value means no
  calls on that arm in the window.
- A standalone experiment: `GET /experiments/:experimentId/metrics` returns
  `{metrics}` for both arms from the same reader and metric names. Its window
  never reaches before the experiment started.
- **Arm calls**: `GET /v1/calls` with `agent_experiment_id` set to the
  rollout's `experiment_id` (version) or `split_id` (migration). For a version
  rollout, rows whose `agent_version_id` equals `candidate_version_id` are the
  candidate arm. For a migration rollout, rows with `agent_id` set are the
  candidate arm. Page and read them as in [call retrieval](../../call-analysis/references/retrieval.md).
  For counts by arm across many calls, build a cohort on `agent_experiment_id`
  with the [cohort skill](../../analytics-cohorts/SKILL.md).

## Workflows

**Start an A/B test.** Call budget: three reads, one confirmed write, one
read-back.

1. `GET /v2/agents/:agentId/rollouts/live` must return `null`;
   `GET …/experiments` must show no `active` experiment;
   `GET …/environments` must show a production pin.
2. Pick the candidate version id. It must belong to this agent and differ from
   the production pin. Name the share, guardrails and any call limit.
3. Confirm, then `POST …/rollouts` with preset `ab`.
4. Read back `GET …/rollouts/live` and report the status and share.

**Start a staged rollout.** Same budget. Steps rise to 100% and the plan
promotes on its own unless `auto_finish: false`. Say that in the confirm.

**Report how it is going.** Two to three reads: `GET …/rollouts/live`,
`GET …/rollouts/:rolloutId/metrics`, and the arm calls if asked. Quote the
window and the call counts with every rate; a rate on a handful of calls is
not a result.

**Change a live rollout or pick a winner.** One confirmed write and a
read-back. "Ship the candidate" on a version rollout is `finish`, which is a
production promote. "Keep the old one" is `rollback`.

## Refusals

| Status and code | Meaning and fix |
|---|---|
| `403 ENTERPRISE_REQUIRED` | Not an enterprise org. Stop; there is no workaround. |
| `409 CONFLICT` "already has a rollout in progress" | Finish or roll back the live one first. |
| `409 CONFLICT` "already ended" | The rollout is terminal. Read `GET …/rollouts/live`. |
| `409 CONFLICT` with a state message | The action does not fit the status. Follow the message. |
| `409 EXPERIMENT_ACTIVE` | A standalone experiment is active. Stop it first, with approval. |
| `400 BASELINE_UNPINNED` | Production has no pin. Publish and promote once first. |
| `400 ALREADY_CURRENT` / `400 VERSION_NOT_FOUND` / `400 VERSION_INVALID` | Wrong candidate, or it does not compile. |
| `409 PATHWAY_SPLIT_ELSEWHERE` / `409 SPLIT_ALREADY_ACTIVE` | The pathway already splits traffic. Set that split to 0 first. |
| `409 FLEET_NOT_ELIGIBLE` | The org's call routing cannot run this rollout. Relay the message. |
| `409 CHECKS_BLOCKED` | The staging check policy blocks start or finish. Run the checks; never force. |
| `409 SPLITTER_GONE` | The split was changed outside the rollout. Read it again. |
| `400 BAD_REQUEST` | A body field failed validation; the message names the field. |
