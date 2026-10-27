# Testing an automation

Three stages, in order. Each stage proves something the previous one did
not. Stage 2 swaps out the call only; every other node still runs.
Routes and step configs are in
[the API reference](api.md).

```text
stage 1  dryRun: true             conditions only        nothing runs
stage 2  nodes: send_call→mock_call   the whole pipeline     nobody is dialed; other nodes run
stage 3  saved nodes, no dryRun   a real run             a real call or text (confirm)
```

All three use `call_bland_api` POST `/v1/automation/triggers/<trigger id>/test`
with body keys `eventData` (required), `nodes`, `filter` and `dryRun`. No
other key is accepted. The trigger must be saved first; it can stay paused
(`is_active: false`), and should.

## Contents

- [Build the event data](#build-the-event-data)
- [Stage 1: conditions only](#stage-1-conditions-only)
- [Stage 2: mock the call](#stage-2-mock-the-call)
- [Stage 3: confirmed live run](#stage-3-confirmed-live-run)
- [Re-running a failed run](#re-running-a-failed-run)

## Build the event data

`eventData` is the flat event payload the trigger would receive.

- Start from `samplePayload` in `GET /v1/automation/events` (the
  per-source route omits it).
- Better, use a real one. For a post-call trigger, read
  `GET /v1/postcall/webhooks/<call_id>` and use its `payload`. For a failed
  run, use that execution's `input`.
- CRM events: keep fields at the top level, add `"model": "<object>"`, and
  for `.updated` events add `_changes` with `{"<field>": {"previous": …,
  "current": …}}`. Without a passing change condition the test is skipped.
- Use a phone number the user owns for any `to` field.

## Stage 1: conditions only

```json
{
  "eventData": {"call_id": "<call id>", "to": "<number>", "from": "<number>", "status": "completed", "call_length": 4.2},
  "dryRun": true
}
```

Add `"filter": {"conditions": [...], "logic": "and"}` to try conditions
before saving them.

Response `data`: `success`, `message`, `status`, `conditionsPassed`,
`conditionResults` (`[{field, operator, passed, actual, expected}]`).

- Read `conditionsPassed`, not `status`. A dry run answers `status:
  "started"` even when a condition fails.
- `status: "skipped"` with `error` naming a missing condition means the event
  requires one. Fix the filter first.
- Run one payload that should pass and one that should not.

## Stage 2: mock the call

`mock_call` takes the same config as `send_call`, resolves every mapping and
dials nobody. Swap it in through `nodes`; the saved pipeline is not changed.

1. `bland_api_get` `/v1/automation/pipelines/<event_pipeline_id>`. Copy
   `pipeline.pipeline_nodes`.
2. Keep each node's `node_id`, `type`, `order` and `config` (add `name`
   only when it is a string). Change every `"type": "send_call"` to
   `"type": "mock_call"`. Change nothing else.
3. Check every other node. The test runs each one for real. Only
   `mock_call`, `schedule_window`, `evaluate_conditions`, `fetch_lead` and
   `resolve_hubspot_association` have no outside effect. Any other node
   (`send_sms`, `send_webhook`, `send_slack_message`,
   `run_connected_custom_code`, `run_eval_judge`) texts, posts, runs code
   or bills. With one present, stop after stage 1, or send stage 2 only
   after the stage 3 confirm, naming what that node will do.
4. Send without `dryRun`:

```json
{
  "eventData": {"call_id": "<call id>", "to": "<number>", "from": "<number>", "status": "completed"},
  "nodes": [
    {
      "node_id": "action",
      "type": "mock_call",
      "order": 0,
      "config": {
        "agent_id": "<agent id>",
        "to": {"source": "input", "value": "to"},
        "from": "<caller id>",
        "request_data": {"first_name": {"source": "input", "value": "variables.first_name"}}
      }
    }
  ]
}
```

5. The response carries `executionId`. Poll `bland_api_get`
   `/v1/automation/executions/<executionId>` every few seconds until
   `completed` or `failed`.
6. Check `result`:
   - `call_id` starts with `mock_`.
   - `resolved_config.phone_number` is the number the real call would dial.
   - `resolved_config.agent_id`, `agent_version`, `from`, `max_duration`
     and `start_time` (set by a `schedule_window` step) are what the user
     expects.
7. `mock_call` does not echo `request_data` or `metadata` mapped in the
   config. Check each `{"source": "input", "value": "<path>"}` against the
   run's `input` by dot path. A path that is not there resolves to nothing.
8. `mock_call` only echoes. It does not check that the agent, version or
   caller ID would be accepted; stage 3 is the first proof of that. Its
   number comes only from `to` or an input `phone_number`, while
   `send_call` also searches common phone fields (`Phone`, `MobilePhone`,
   …). A missing `phone_number` in a mock run is not always a live failure.
9. A `failed` run quotes the step and the reason in `error`, for example a
   config that did not resolve. Fix the mapping and repeat stage 2.

Only `send_call` has a mock. A pipeline whose only action is `send_sms`,
`send_webhook`, `send_slack_message` or `run_connected_custom_code` has no
stage 2: any non-dry test performs that action. Stop after stage 1, or go to
stage 3 with confirmation.

Mock runs are recorded in run history like real runs. Tell the user so the
`mock_` rows are not mistaken for calls.

## Stage 3: confirmed live run

Confirm first, naming the number dialed (or texted), the agent and version,
and the caller id:

```text
About to run the automation "<name>" for real: it calls <number> with <agent> (<version>) from <caller id>.
This places 1 real call.
Reply "yes" to proceed.
```

Then send the stage 2 body without `nodes`, so the saved steps run:

```json
{
  "eventData": {"call_id": "<call id>", "to": "<number>", "from": "<number>", "status": "completed"}
}
```

Poll the execution. `result.call_id` is the real call; hand call review to
call-analysis. Then activate with PATCH
`/v1/automation/triggers/<id>/toggle` and `{"is_active": true}` (confirm;
from then on every matching event dials).

## Re-running a failed run

There is no retry route. After fixing the cause:

1. Stage 2 with the failed execution's `input` as `eventData`.
2. With confirmation, stage 3 with the same `input`. It creates a new
   execution; the failed one stays failed.
