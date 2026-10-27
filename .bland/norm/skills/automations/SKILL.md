---
name: automations
description: Use when someone says "when a call ends, do X", "when a CRM record changes, call them", "set up a trigger", "test my automation", "how do automations work", "why didn't my automation fire", "pause the automation", "alert me when", "resend the webhook" or asks about the "post-call webhook", on the Triggers or Alerts pages or an agent's Automations or Alerts tab.
---

# Automations, alerts and post-call webhooks

A **trigger** (event plus conditions) runs a **pipeline** (ordered steps);
each firing is an **execution**. For "how does it work" or "why did it
happen", read [how it works](references/how-it-works.md). Read [the API
reference](references/api.md) before the first request and
[testing](references/testing.md) before any test. Hand-offs: outbound-calls,
agent-channels, tool-library, [call-analysis](../call-analysis/SKILL.md).

## Page context

Call `get_dashboard_page_context` (`mode: "synced"`) first. No target chip
exists here.

- `/dashboard/triggers[/new]`: org scope. `/dashboard/triggers/$automationId[/runs]`:
  the **trigger** id; its pipeline is `event_pipeline_id`.
- `/dashboard/agent/$agentId/automations/**`: agent id, plus trigger id.
- `/dashboard/alerts/**`, `/dashboard/agent/$agentId/alerts/**`: `$alertId`,
  agent id.

Mutate through the API, never the page's forms. After every write say:
"Saved through the API. The page shows it after a refresh."

## Workflow: set up a trigger safely

Budget: catalog, two POSTs, three tests, toggle.

1. `bland_api_get` `/v1/automation/events`; copy `source` and `eventKey`.
   Events are CRM sync or platform (`bland:post_call.completed`, …). No
   schedule or inbound-API trigger exists; say so.
2. Pick a [step](references/api.md#pipelines-and-steps) the event's
   `supportedActions` allows (`send_call`, `send_sms`, `send_webhook`, …).
3. Map fields as `{"source": "input", "value": "<path>"}`. Input is FLAT:
   `Phone`, never `Lead.Phone`.
4. `call_bland_api` POST `/v1/automation/pipelines`, then
   `/v1/automation/triggers` with `"is_active": false` (omitted means live).
   On an agent page set `agent_id` on both and in `send_call`.
5. Test in order: `"dryRun": true`; a `nodes` override swapping `send_call`
   for `mock_call` (dials nobody, checks no agent or caller ID; other nodes
   run for real); then, confirmed, one live run.
6. PATCH `/v1/automation/triggers/<id>/toggle` `{"is_active": true}`. An
   empty body flips the state.

## Workflow: diagnose a run

Budget: trigger reads, run pages, one detail, one dry run. Change nothing
before the reads explain it.

1. `bland_api_get` `/v1/automation/triggers?q=<name>` (`is_active`,
   `last_triggered_at`), then the trigger's `filter`.
2. `/v1/automation/executions?trigger_id=<id>&limit=100`, newest first, no
   date filter. Page past the window; say how far you read.
3. Failed: `/v1/automation/executions/<id>`; quote `error`, show
   `nodes_executed`, `input`, `result.call_id`. A call's
   `metadata.automation_execution_id` traces back.
4. No run: the event never came or the filter dropped it. Dry-run the saved
   filter on the real payload. Post-call triggers fire only when the call
   sent a post-call webhook.
5. No retry route exists. A re-run is a live test with the failed `input`.

## Workflow: alerts

1. `bland_api_get` `/v1/alerts` (`agent_id` from the page), `/<id>/history`.
2. Draft `metric` or `custom_condition`, `levels`, `min_calls`, `delivery`.
   Backtest with POST `/v1/alerts/preview?range=7d`.
3. POST `/v1/alerts`; mute with PATCH `{"enabled": false}`. Agent scope is
   fixed at create.
4. `delivery.phone` calls people at CRITICAL. There is no test send.

## Workflow: post-call webhooks

1. URL: the call's own (call, agent or number), else the org default
   (`/user/getCurrentWebhook`).
2. `/v1/postcall/webhooks/<call_id>`: `payload`, `url`, deliveries with
   `response_code`. `null` means nothing was sent.
3. Resend: POST `/v1/postcall/webhooks/resend` `{"call_ids": [...]}`. All
   or nothing; automations do not re-fire.

## Confirm before

Activating a trigger that calls or texts; non-dry tests that keep any node
with a real effect; re-runs; alert phone or tool delivery; resends; secret
rotation; deletes (a pipeline delete removes its triggers and runs).

```text
About to <verb> <object>: <what changes, who is affected, count>.
This <places N calls | texts +1… | re-delivers N webhooks | cannot be undone>.
Reply "yes" to proceed.
```

## Refusals and limits

- `oauth_path_not_allowed`: say "this connection cannot reach automations;
  do it on /dashboard/triggers" (or `/dashboard/alerts`) and stop.
- `WEBHOOK_PAYLOAD_EXPIRED`: retention cleared it; nothing was sent.

## Do not

- Omit `is_active: false` on create, or toggle without a body.
- Delete to stop a misfire; pause it.
- Use legacy `/v1/alarms` or echo the webhook secret.
- Write fetch scripts, search the docs for these routes, or guess fields.
