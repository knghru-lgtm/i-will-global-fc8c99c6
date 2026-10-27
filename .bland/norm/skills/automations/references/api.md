# Automations, alerts and post-call webhooks: API

Every route here is org scoped. Reads use `bland_api_get` (query values are
strings). Writes use `call_bland_api` with `{method, path, body}`. Send the
body as a JSON object. An `INVALID_JSON` 400 means the body went out as a
string. Do not write fetch scripts and do not search the docs for these
routes. Why things happen (event timing, run states, alert transitions,
cause map) is in [how it works](how-it-works.md).

## Contents

- [Model](#model)
- [Event catalog](#event-catalog)
- [Triggers](#triggers)
- [Pipelines and steps](#pipelines-and-steps)
- [Executions](#executions)
- [Alerts](#alerts)
- [Post-call webhooks](#post-call-webhooks)
- [Errors](#errors)
- [Access](#access)

## Model

```text
event (CRM sync or bland:*) ──► trigger ──filter passes──► pipeline ──► execution
                                 is_active                 ordered steps    one run
                                 filter {conditions,logic}  (nodes)         input, result, error
```

- A trigger points at one pipeline through `event_pipeline_id`. The
  dashboard's `$automationId` is the trigger id.
- Conditions live on the trigger `filter`. An event that fails the filter
  creates no execution.
- Every step receives the event plus all earlier step outputs, merged flat.
- `agent_id` on the trigger and pipeline is attribution: it decides which
  agent's Automations tab lists it. The agent that places a call is the
  `agent_id` in the `send_call` step config.

## Event catalog

`GET /v1/automation/events` returns `{events: [...]}`. Each item has
`source`, `eventKey`, `name`, `description`, `type`, `fields`,
`samplePayload`, `supportedActions`, `requiresConditions` and
`requiresChangeCondition`. `GET /v1/automation/events/<source>` filters by
source but omits `samplePayload`.

Copy `source` and `eventKey` verbatim into the trigger's `source` and
`event_type`.

Sources that exist:

- CRM sync: Salesforce, HubSpot and Notion record events. `.updated`
  events require a change-detection condition.
- Internal `bland` events: `post_call.completed` (the post-call webhook
  payload), `post_sms.completed`, `call.started`, `call.inbound_received`,
  `call.voicemail_detected`, `call.warm_transfer`, `call.cold_transfer`,
  `sms.received`, `batch.completed`, `tool.success`, `tool.failure`,
  `eval.completed`, `kb.gap_detected`, `pathway.node_reached`.

There is no schedule (cron) trigger and no inbound API or webhook trigger.
"Every morning at 9" or "when my system posts to Bland" cannot be built
here. A `schedule_window` step only delays an event-driven run into a time
window.

`supportedActions` limits the steps per event. For example `batch.completed`
supports webhook, Slack and custom code, not calls or texts.

### Input shape

The event payload is flat. A CRM record's fields sit at the top level next to
`model` (for example `"model": "Lead"`), and `_changes` holds
`{field: {previous, current}}` on update events. A `bland` event spreads its
payload at the top level (`call_id`, `to`, `from`, `variables`, …).

- Mappings resolve by plain dot path on that flat input. Map `Phone`, never
  `Lead.Phone`: the prefixed path resolves to nothing.
- Conditions tolerate a `Lead.` prefix when it matches `model`. Mappings do
  not.

## Triggers

| Method and path | Body or query | Effect |
| -- | -- | -- |
| GET `/v1/automation/triggers` | `is_active`, `source`, `q`, `agent_id`, `limit` (max 100), `offset` | `{triggers, total}`; rows carry `trigger_count`, `last_triggered_at`, `action_type`, `timing_mode` |
| GET `/v1/automation/triggers/<id>` | | `{trigger}` with `event_pipeline_id`, `filter`, `is_active`, `agent_id` |
| POST `/v1/automation/triggers` | `event_pipeline_id`, `source`, `event_type` required; `name`, `resource_id`, `filter`, `is_active`, `agent_id` | 201 `{trigger}`. **`is_active` defaults to true**: an omitted flag goes live at once |
| PUT `/v1/automation/triggers/<id>` | any create key; `agent_id: null` clears | edits a live subscription |
| PATCH `/v1/automation/triggers/<id>/toggle` | `{"is_active": true}` or `false` | sets the state. An empty body inverts it and is not retry safe |
| POST `/v1/automation/triggers/<id>/test` | see [testing](testing.md) | dry run, or a real run |
| DELETE `/v1/automation/triggers/<id>` | | removes the trigger only; the pipeline stays, inert; past runs stay with no trigger link |

`resource_id` is the CRM connection id for CRM sources. `filter` is
`{"conditions": [{"field", "operator", "value"}], "logic": "and"}` (or
`"or"`).

Operators: `equals`, `not_equals`, `contains`, `not_contains`,
`starts_with`, `ends_with`, `greater_than`, `less_than`,
`greater_than_or_equals`, `less_than_or_equals`, `is_empty`,
`is_not_empty`, `in`, `not_in`. Change detection: `changed`, `changed_to`,
`changed_from`, `changed_from_to`, `changed_to_any`, `changed_from_any`,
`changed_and_now_greater_than`, `changed_and_now_less_than`.

## Pipelines and steps

| Method and path | Body or query | Effect |
| -- | -- | -- |
| GET `/v1/automation/pipelines` | `is_active`, `category`, `include_stats`, `agent_id`, `agent_version_id`, `limit`, `offset` | `{pipelines, total}` |
| GET `/v1/automation/pipelines/<id>` | | `{pipeline}` with ordered `pipeline_nodes` |
| POST `/v1/automation/pipelines` | `name`, `nodes` required; `description`, `edges`, `is_active`, `metadata`, `settings`, `agent_id`, `agent_version_id`, `resource_id` | 201 `{pipeline}`; inert until a trigger points at it |
| PUT `/v1/automation/pipelines/<id>` | partial; `nodes` replaces the whole list | changes what live triggers do |
| DELETE `/v1/automation/pipelines/<id>` | | **deletes the pipeline, its triggers and its run history** |

A node is `{"node_id", "type", "name", "order", "config"}`. `order` starts at
0 and is unique. A config value is either a literal, `{"source": "static",
"value": <any>}`, or `{"source": "input", "value": "<dot path>"}`.

The dashboard saves in this order: create the pipeline, then the trigger;
if the trigger fails, delete the pipeline. On edit: PUT the pipeline, then
PUT the trigger.

| Step `type` | Config keys | Notes |
| -- | -- | -- |
| `send_call` | `agent_id`, `agent_version`, `to`, `from`, `max_duration` (default 12), `record`, `wait_for_greeting`, `interruption_threshold`, `block_interruptions`, `request_data`, `metadata` | Places a real call. `agent_id` is never combined with `persona_id` or `pathway_id`. Output `call_id` |
| `mock_call` | same as `send_call` | Dials nobody. Output `call_id: "mock_<n>"` and `resolved_config` |
| `send_sms` | `to`, `message` (with `{{path}}` placeholders), `agent_id` (answers replies), `from`, `request_data`, `new_conversation`, `time_out`, `webhook` | Enterprise only. Texts a person |
| `send_webhook` | `url`, `headers` `[{key, value}]`, `body`, `timeout` (ms, default 30000) | POSTs JSON signed like the post-call webhook. No `body` sends the whole event. A non-2xx response fails the run |
| `send_slack_message` | `resource_id`, `channel_id`, `message` | Needs a Slack connection |
| `run_connected_custom_code` | `snippet_id`, `variables`, `connections`, `secrets`, `timeout` | Runs a saved snippet |
| `schedule_window` | `mode` (`business_hours` or `custom`), `timezone`, `startHour`, `endHour` (excluded), `daysOfWeek` (0 = Sunday) | Put first. Sets `start_time` so the call waits for the window. Only call steps honor it. Always set `timezone`. The dashboard offers it for CRM events only |
| `evaluate_conditions`, `fetch_lead`, `run_eval_judge`, `resolve_hubspot_association` | | API-only helpers; read an existing pipeline before using one |

`send_call` stamps the call's `metadata` with `automation_execution_id`,
`automation_pipeline_id`, `automation_node_id` and, when a conversation
triggered the run, `automation_source_conversation_id`. Those keys are
reserved. `metadata` reaches the post-call webhook for every call status;
`request_data` becomes the agent's variables. A run triggered by a
conversation's end also passes `previous_conversation` (`id`, `channel`,
`summary`) unless you map that key.

Saving the trigger in the dashboard builder rewrites `nodes` from its form
(timing, CRM association lookup, one action) and drops any other step.

## Executions

| Method and path | Query | Effect |
| -- | -- | -- |
| GET `/v1/automation/executions` | `trigger_id`, `event_pipeline_id`, `status`, `limit` (default 20, max 100), `offset` | `{executions, total}`, newest first. No date filter: page with `offset` |
| GET `/v1/automation/executions/<id>` | | `{execution}` |

An execution has `status` (`pending`, `running`, `completed`, `failed`,
`cancelled`), `input` (the event as received), `result` (input plus every
step output, merged), `nodes_executed`, `error`, `started_at`,
`completed_at`, `duration_ms`, `trigger_id`, `created_at`.

- `error` reads `Node <node_id> failed: <message>` when a step reported
  failure, or `Pipeline execution failed: <message>` (with an empty
  `result`) when a step kept erroring after automatic retries. Quote it
  verbatim.
- `pending` that never turns `running` means the run never started.
- Test runs are recorded like real ones and count in the trigger's
  `trigger_count` and `last_triggered_at`. A `call_id` starting `mock_`
  marks a mock run.
- `cancelled` is defined but normal runs never reach it.
- There is no retry or re-run route.

## Alerts

| Method and path | Body or query | Effect |
| -- | -- | -- |
| GET `/v1/alerts` | `page`, `limit`, `agent_id` | configs |
| GET `/v1/alerts/<id>` | | one config |
| POST `/v1/alerts` | see below | 201; starts evaluating, `enabled` true |
| PATCH `/v1/alerts/<id>` | partial, plus `enabled` | edit or mute. Rejects `agent_id` |
| DELETE `/v1/alerts/<id>` | | removes the config |
| POST `/v1/alerts/preview?range=24h` or `7d` | a draft body | backtest; nothing is sent |
| POST `/v1/alerts/preview/calls?from=<iso>&to=<iso>` | a draft body | the calls behind one preview bar |
| GET `/v1/alerts/<id>/metrics?range=` | | chart data |
| GET `/v1/alerts/<id>/metrics/calls?from=&to=` | | violating calls |
| GET `/v1/alerts/<id>/history` | `page`, `limit` | firings |
| GET `/v1/alerts/<id>/history/<firing id>/events` | | events of one firing |
| GET `/v1/alerts/sources/citations`, `/dispositions`, `/pathway-tags`, `/eval-agents` | | pickers for `custom_condition` |

Create body:

```json
{
  "name": "<name>",
  "agent_id": "<agent id or omit for org-wide>",
  "metric": "call_length",
  "levels": {
    "WARNING": {"operator": "gt", "value": 600, "percentage": 0.2, "lookback_ms": 3600000}
  },
  "min_calls": 5,
  "delivery": {"emails": ["<email>"]}
}
```

- Exactly one of `metric` or `custom_condition`. `call_length` is in
  seconds (the example fires when 20% of calls run over 10 minutes).
- `metric`: `call_length`, `api_errors`; enterprise only: `latency`,
  `transcription_score`, `silence_count`, `user_interruption_count`,
  `low_engagement_ratio`, `sentiment_score`.
- `custom_condition` (enterprise only): `{kind: "disposition",
  disposition_id, path, value_type}`, `{kind: "citation", schema_id,
  variable, value_type}`, `{kind: "pathway_tag", tag_name}` or `{kind:
  "eval", eval_agent_id}`. The dashboard has no picker for `eval`.
- A level fires when at least `percentage` (0 to 1) of the calls in
  `lookback_ms` match `operator value`, with at least `min_calls` calls.
  `lookback_ms` is one of 600000, 1800000, 3600000, 10800000, 86400000.
  Levels: `INFO`, `WARNING`, `CRITICAL`.
- `delivery.emails[]` sends email. `delivery.tools[]` (`{id, input}`) runs a
  saved tool; this is how Slack or a webhook is reached. `delivery.phone`
  (`{numbers, from, say}`) **places real calls when the alert starts at or
  rises to CRITICAL**. Email and tools are sent when an alert starts,
  escalates and resolves; not when it drops a level.
- `agent_id` is fixed at create. To re-scope, delete and create again.
- There is no "send a test alert" route. The preview is the test.
- Ignore the legacy `/v1/alarms` routes; the product uses `/v1/alerts`.

## Post-call webhooks

Where the URL comes from, in order: the call's own `webhook` (set on the
call, or by its agent or inbound number), else the org default.

| Method and path | Body | Effect |
| -- | -- | -- |
| GET `/v1/postcall/webhooks/<call_id>` | | `{payload, url, created_at, call_id, metadata}` or `null` when no webhook was sent |
| POST `/v1/postcall/webhooks/resend` | `{"call_ids": ["<call id>"]}`, no duplicates | re-delivers the stored payload to the stored URL |
| POST `/v1/postcall/webhooks/create` | `{"call_ids": [...], "webhook_url": "<url>"}` | builds and sends for calls that never had one; refuses calls that already have one |
| GET `/user/getCurrentWebhook` | | `{webhook_url}` org default |
| POST `/user/updateCurrentWebhook` | `{"webhook_url": "<url>"}` | sets the org default; owner, admin or operator |
| GET `/user/getCurrentWebhookSecret` | | the signing secret; never echo it |
| POST `/user/newWebhookSecret` | | **rotates the secret; existing receivers fail verification until updated** |

- `metadata` is a list of deliveries: `sent_at`, `response_code`,
  `response_time`, `send_type` (`spawn` is the original send, `resend`,
  `create`, `disposition`, `eval`), `error_message`.
- The payload is the call record: `call_id`, `to`, `from`, `status`,
  `completed`, `call_length`, `summary`, `recording_url`, `variables`,
  `metadata`, `transcripts`, plus disposition results when configured. Read
  a real one rather than describing it from memory.
- Each request carries `X-Webhook-Signature`: hex HMAC-SHA256 of the raw
  JSON body with the org secret. Disposition follow-ups add
  `X-Webhook-Idempotency-Key`.
- The `bland:post_call.completed` and `bland:call.voicemail_detected`
  automations fire on the original send only, whatever the receiver
  answered. A call with no webhook URL sends nothing and fires neither. A
  resend or create does not fire them.
- A resend answers 200 even when your receiver fails. Read the new
  delivery's `response_code`. It is signed with the current secret.
- Resend checks every call before sending any. One missing or expired call
  fails the whole request and nothing is sent.
- These routes allow 100 requests per 15 minutes.
- Disposition `hold` versus `emit_followup` timing is in
  [dispositions](../../evaluations/references/dispositions.md#definition-and-dependencies).
- Payload fields can be excluded org-wide on Settings, Organization.
- The old agent outcomes webhook page now opens Dispositions.

## Errors

| Response | Meaning | Fix |
| -- | -- | -- |
| 500 `CREATE_TRIGGER_ERROR` or `UPDATE_TRIGGER_ERROR` with `… requires at least one filter condition` | the event needs a condition | add one, resend |
| same, with `… requires at least one change detection condition` | a CRM `.updated` event | add `changed`, `changed_to` or similar |
| 500 `TOGGLE_TRIGGER_ERROR` on activation | usually the same condition rule | read the filter, fix it with PUT, toggle again |
| 400 `INVALID_PARAMETER` `agent_id: Invalid UUID format` | not a v2 agent id | use the agent UUID |
| 404 `TEST_TRIGGER_FAILED` | trigger not found in this org | re-read the page context |
| 400 `Either metric or custom_condition is required` / `Cannot set both metric and custom_condition` | alert body | send exactly one |
| 400 `agent_id cannot be changed after an alert is created…` | PATCH with `agent_id` | delete and recreate |
| 403 `ENTERPRISE_REQUIRED` on custom conditions or enterprise metrics | not an enterprise org | use `call_length` or `api_errors` |
| 410 `WEBHOOK_PAYLOAD_EXPIRED` | retention cleared the stored payload | nothing was sent; it cannot be resent |
| 500 on resend | usually a call with no stored webhook | check each id with the GET first |
| 500 `CREATE_PIPELINE_ERROR` `Pipeline compilation failed: …` | duplicate `node_id` or `order`, an `order` gap, or an unknown `type` | number steps 0, 1, 2 …; use a listed type |
| 400 `INVALID_JSON` | body sent as a string | send a JSON object |

## Access

OAuth-connected hosts cannot reach `/v1/automation/**`, `/v1/alerts/**`,
`/v1/postcall/**` or the `/user` webhook routes. On
`oauth_path_not_allowed` stop and name the dashboard page: Triggers,
Alerts, or Settings, Organization for the org webhook. API-key connections
reach all of them.
