# How automations, alerts and post-call webhooks work

The concepts behind the [automations skill](../SKILL.md). Routes and field
tables are in [the API reference](api.md); the safe test ladder is in
[testing](testing.md). This page explains what happens and why, so you can
predict a run and diagnose one that went wrong.

## Contents

- [What it is](#what-it-is)
- [Objects and how they relate](#objects-and-how-they-relate)
- [Lifecycle and states](#lifecycle-and-states)
- [How it reaches a live call or conversation](#how-it-reaches-a-live-call-or-conversation)
- [On the dashboard](#on-the-dashboard)
- [Rules and limits](#rules-and-limits)
- [When it goes wrong](#when-it-goes-wrong)
- [Questions people ask](#questions-people-ask)

## What it is

Three separate features react to what happens on calls and texts:

- **An automation** ("when X happens, do Y"). Something happens: a call
  ends, a CRM record changes, a batch finishes. If it matches your
  conditions, a short list of steps runs: place a call, send a text, post a
  webhook, message Slack, run a code snippet.
- **An alert** watches a measure across many calls ("more than 20% of
  calls in the last hour were longer than 10 minutes") and tells people when
  it crosses a line and when it recovers.
- **The post-call webhook** is the one message the platform sends to your
  URL when a call is over: the call record, transcript, summary and
  variables.

They are not:

- **A schedule.** Nothing runs "every morning at 9". Every automation starts
  from an event. A timing window can only delay the call an event already
  caused.
- **An inbound API.** Your system cannot post to an automation to start it.
  To start calls from your system, place calls or batches directly
  (outbound-calls skill).
- **A tool.** A tool runs during a conversation when the agent calls it.
  Automations and webhooks run before or after, without the agent.
- **A disposition.** A disposition labels a call. It can hold or follow up
  the post-call webhook, but it is not a delivery target of its own.

## Objects and how they relate

```text
 org scope, all live (no versions, no environments)

 event catalog            trigger                         pipeline
 (fixed list)  ──source──► is_active                      ordered steps
 CRM record events          filter {conditions, logic}  ──event_pipeline_id──►  0 schedule_window (optional)
 platform events            agent_id (attribution only)                        1 send_call | send_sms |
                            resource_id (CRM connection)                         send_webhook | slack | code
                                   │
                                   │ every matching event
                                   ▼
                              execution (one run)
                              input = the event, result = input + step outputs
                                   │
                                   └─ send_call ──► a call whose metadata carries
                                                    automation_execution_id

 alert config ── metric or custom_condition, levels, min_calls, delivery, agent_id (fixed)
      └── firing ── events (one per evaluation while open)

 call ── post-call webhook (one stored payload + URL + list of deliveries)
      └── fires the post_call.completed event above
```

- A trigger points at exactly one pipeline. The dashboard's
  `$automationId` is the trigger id.
- Nothing here is versioned. An edit is live for the next event. Runs
  already started keep the steps they started with.
- `agent_id` on a trigger only decides which agent's Automations tab lists
  it. The agent that answers a call is the `agent_id` inside the
  `send_call` step. Without `agent_version` that step calls with the
  agent's production version.
- Alerts are their own object. They do not run pipelines.

## Lifecycle and states

### Trigger

```text
   POST (is_active omitted or true) ──► ACTIVE ◄──toggle {"is_active": true}──┐
   POST {"is_active": false} ───────► PAUSED ──────────────────────────────────┘
                                        ▲  └──toggle {"is_active": false}── ACTIVE
   DELETE trigger    : gone; past runs stay, unlinked; the pipeline stays, inert
   DELETE pipeline   : pipeline, its triggers and all their runs are gone
```

Only the trigger's flag stops runs. Pause the trigger; do not rely on the
pipeline's own `is_active`. A paused trigger can still be tested.

### Execution (one run)

```text
 event ──filter fails──► (nothing recorded)
   │
   └─filter passes──► pending ──first step starts──► running ──all steps ok──► completed
                         │                              │
                         └─could not start──► failed ◄──┘ a step failed
```

- A step that reports failure (no phone number, a rejected call request,
  a non-2xx from your webhook, conditions not met) ends the run at once. The
  error reads `Node <node_id> failed: <reason>` and later steps never run.
- A step that errors (invalid config, a temporary service error) is retried
  automatically a few times. If it still errors, the run fails with a
  generic `Pipeline execution failed: …` message and an empty `result`.
- `completed` and `failed` are terminal. Nothing re-runs a run. A test with
  the same input creates a new run.
- `cancelled` exists in the type but normal runs do not produce it.

### Alert

```text
 quiet ──a level is met──► FIRING(level) ──higher level met──► FIRING(higher)   notify
   ▲                           │      └──lower level met──► FIRING(lower)        no notify
   │                           │      └──too few calls──► holds its level        no notify
   └──────── resolved ◄────────┘ no level met                                    notify
 disabled or deleted while firing ──► resolved at the next evaluation            no notify
```

### Post-call webhook for one call

```text
 call ends ── no URL resolves ──► nothing stored, nothing sent, no post-call automation
     │
     └─ URL ──► stored ──► sent once ("spawn") ──► post_call.completed fires
                             (held first when a disposition or extraction holds it)
 later: resend (same URL, same payload) or create (only calls with none) ──► delivery appended
        retention clears the payload ──► resend refused, WEBHOOK_PAYLOAD_EXPIRED
```

## How it reaches a live call or conversation

### When each event fires

| Event | Fires |
|---|---|
| `call.started`, `call.inbound_received` | as the call starts or the inbound call arrives |
| `call.cold_transfer`, `call.warm_transfer` | when the transfer happens, mid-call |
| `pathway.node_reached`, `tool.success`, `tool.failure` | mid-conversation |
| `post_call.completed` | after the post-call webhook is sent, with that exact payload |
| `call.voicemail_detected` | at the same moment, when the call ended on voicemail |
| `sms.received`, `post_sms.completed` | on an inbound text; when a text conversation ends |
| `batch.completed`, `eval.completed`, `kb.gap_detected` | when the batch, eval run or gap check finishes |
| CRM record events | after the CRM connection's next sync reports the change, one run per changed record |

Two consequences matter most:

1. **Post-call and voicemail automations need a post-call webhook URL.**
   The URL comes from the call itself, else the inbound number, else the
   org default. With no URL nothing is sent and neither event fires.
2. **They fire on the send, not the delivery.** Your receiver can return
   500 and the automation still runs. A resend never fires them again.

When a disposition in `hold` mode (or an extraction step) holds the
webhook, the automation waits with it. The payload the automation sees is
the webhook payload after the org's excluded fields are removed.

### What a run does

1. Every active trigger in the org on that event checks its filter against
   the event. All that pass start their own run, in parallel.
2. Steps run in `order`. Each step sees the event plus every earlier
   step's output, merged into one flat object. A later key overwrites an
   earlier one with the same name.
3. Mappings `{"source": "input", "value": "<path>"}` read that object by
   plain dot path. A path that is not there becomes empty.
4. `send_call` dials the mapped `to`. If that is empty it looks for common
   phone fields in the event (`phone_number`, `Phone`, `MobilePhone`, …).
   It stamps the call's `metadata` with the run, pipeline and step ids,
   plus the triggering conversation when there was one.
5. When the run was started by a conversation ending, the called agent also
   receives a `previous_conversation` variable (id, channel, and summary
   when there is one), unless you mapped that key yourself.

### Timing windows

A `schedule_window` step does not pause the run. It computes the next
moment inside the window and the call step schedules the call for then.
The run shows `completed` at once; the call itself waits. Only call steps
honor the window: a text, webhook, Slack or code step still runs
immediately.

### Alerts

After each call, its measures (length in seconds, latency, interruptions,
disposition and extraction values, eval verdicts) are recorded for 24
hours. Alerts are evaluated on a recurring schedule, not per call. Each
evaluation checks CRITICAL, then WARNING, then INFO, each over its own
lookback, counting only calls that have the measure. The first level met
wins.

### Post-call webhook delivery

One signed POST when the call is done. There is no automatic retry. A
failed delivery is recorded with its `response_code` (or `null` and an
`error_message`) and stays failed until someone resends it.

## On the dashboard

| Page | What it shows and does | After an API write |
|---|---|---|
| `/dashboard/triggers` | All triggers: search, sort, active state, run count, last run | Refresh |
| `/dashboard/triggers/new`, `/$automationId` | Builder: event, CRM connection wizard, conditions, timing, one action, field mapper with a real call's payload preview, secret picker for webhook headers, test panel | Refresh |
| `/dashboard/triggers/$automationId/runs` | Runs: All, Completed, Failed; Today, 7 days, 30 days; status chart; run detail with raw payload and a shortened error | Updates by itself every few seconds |
| `/dashboard/agent/$agentId/automations/**` | Same pages, only triggers attributed to that agent | Refresh |
| `/dashboard/alerts/**`, `/dashboard/agent/$agentId/alerts/**` | Alert list, form with templates and backtest preview, detail with metric chart, violating calls, history, mute | Refresh |
| `/settings/organization` | Org default webhook URL, signing secret (generate, reveal, regenerate), payload field toggles | Refresh |
| A call on the Conversations page | "Webhook & tools": the URL, response code and time | Refresh |

Only the dashboard can connect a CRM or Slack account. Only the API can
use `mock_call`, add more than one action or an `evaluate_conditions` or
`run_eval_judge` step, pin `agent_version`, put a timing window on a
platform event (the builder offers Immediately only), alert on an eval
verdict, or resend a webhook.

The builder's "Conditions only" test is a dry run. With it off, "Run test"
runs the steps for real, including a real call. When a timing window is
set, the builder only allows conditions-only tests.

Saving in the builder rebuilds the step list from the form: an optional
timing window, an optional CRM association lookup, and one action. Any step
the form does not know is removed on save.

## Rules and limits

| Rule | Limit or behavior | What you see |
|---|---|---|
| New trigger state | `is_active` defaults to true | Live on the next event |
| CRM `.updated` events | Need a change condition (`changed`, `changed_to`, …) | 500 `CREATE_TRIGGER_ERROR` naming the rule |
| Filter | `logic` is `and` or `or`; no conditions means every event passes | 400 on a bad body |
| Text comparisons | `contains`, `starts_with`, `ends_with` ignore case; `equals` matches `"true"` to `true` and `"5"` to `5` | |
| Step list | `node_id` unique, `order` 0, 1, 2 … with no gaps, known `type` | 500 `Pipeline compilation failed: …` |
| Test override `nodes` | Not checked before the run | The run fails instead |
| `send_call` defaults | `max_duration` 12, `record` true, `wait_for_greeting` false, production version | |
| Reserved call metadata | `automation_execution_id`, `automation_pipeline_id`, `automation_node_id`, `automation_source_conversation_id` | Your value is replaced |
| Timing window | Hours 0 to 23, end hour excluded, days 0 (Sun) to 6 (Sat); defaults 9 to 17, Mon to Fri; calls start on the hour; at most 7 days ahead; start after end spans midnight | Bad timezone or no days fails the step |
| Timezone | Always set it; an omitted timezone runs on US Eastern while the builder displays US Pacific | |
| `send_sms` | Enterprise only; empty message fails; unresolved `{{…}}` text is sent as written | |
| `send_webhook` | POST JSON, signed, default timeout 30 s; no body means the whole event; non-2xx fails the run | |
| Lists | Triggers up to 100 per page; runs default 20, up to 100, newest first, no date filter | |
| Alert lookback | 10 min, 30 min, 1 h, 3 h or 24 h per level | 400 on any other value |
| Alert threshold | `percentage` 0 to 1 of calls that have the measure; `min_calls` default 5 | |
| Alert scope | `agent_id` fixed at create; deleting the agent deletes its alerts | 400 on PATCH with `agent_id` |
| Alert delivery | Email and tools on start, escalation and resolve; phone only when it starts at or escalates to CRITICAL | |
| `call_length` | Seconds | |
| Preview range | `24h` or `7d`; anything else is treated as `24h` | |
| Webhook routes | 100 requests per 15 min; no duplicate ids; resend all or nothing | 400, 410 `WEBHOOK_PAYLOAD_EXPIRED` |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| Post-call trigger never runs | No webhook URL for those calls | `GET /v1/postcall/webhooks/<call_id>` is `null` | Set a URL on the call, number or org default |
| Trigger never runs, events do happen | Paused, or the filter drops them | `is_active`; dry run the saved filter on a real payload | Toggle with an explicit body; fix the condition |
| CRM trigger never runs | Wrong connection, or no change condition passed | `resource_id`; `_changes` in a recent record | Point at the right connection; test with `_changes` |
| Runs fail `No phone number provided` | `to` maps a path the event lacks (`Lead.Phone` on flat input) | Run `input` vs the mapping | Map the flat path (`Phone`) |
| Same failure, `input` has no call at all | A simulation or test run with a webhook URL may also fire post-call triggers | `input` has `is_simulation` or `agent_test.run.completed` | Add condition `to` `is_not_empty` |
| Run fails with a call error (`AGENT_…`, 404) | Agent deleted, wrong id, or a persona or pathway set beside the agent | `error`, step config | Fix the step's `agent_id` |
| Run fails `Pipeline execution failed: …` | A step kept erroring: bad config or unknown step type | `nodes_executed` shows how far it got | Read the pipeline; fix the step |
| Run stays `pending` | The run never started | No `running` after minutes | Test again; report it if it repeats |
| Agent's variables arrive empty | Mapping path missing, so the value is empty | Compare `request_data` paths with `input` | Fix the path; test with `mock_call` |
| Call placed at the wrong hour | Timezone omitted or wrong | Step config `timezone` | Set an explicit timezone |
| Text sent outside the window | Windows only delay calls | Step order | Accept it, or use a call step |
| Extra steps vanished | Someone saved the trigger in the builder | Pipeline `pipeline_nodes` | Re-PUT through the API; edit only there |
| Run count includes tests | Tests are recorded like real runs | `call_id` starting `mock_`, or runs at test times | Read run times before concluding |
| Webhook "never arrived" | Your receiver failed | Deliveries `response_code` not 2xx, or `error_message` | Fix the receiver, then resend |
| Signature fails | Secret rotated, none generated, or verified on re-serialized JSON | Settings, Organization | Verify the raw body with the current secret |
| Resend returns 410 | Retention cleared the payload | `WEBHOOK_PAYLOAD_EXPIRED` | Cannot resend; nothing was sent |
| Alert never fires | Fewer than `min_calls` calls with the measure, wrong agent, muted, or wrong unit | Preview with the same body | Lower `min_calls`, fix scope or value |
| Alert phone did not ring | Phone rings only at CRITICAL | The firing's severity in history | Add a CRITICAL level or email |
| Alert will not clear | Too few calls in the window holds the level | History shows no change | Wait for traffic, or mute |

## Questions people ask

**Can an automation run every morning at 9?**
No. Every automation starts from an event. Use a batch for scheduled
outreach, or put a timing window before a call step so event-driven calls
wait for business hours.

**Does editing a trigger affect calls already placed?**
No. Runs already started keep their steps. The next event uses the edit.

**Why did my post-call automation run when the webhook failed?**
It fires when the webhook is sent, not when your server accepts it.

**Will resending a webhook run my automations again?**
No. Only the original send fires them. To re-run an automation, test it
with the failed run's `input` (see [testing](testing.md)).

**Which agent version does an automation call use?**
The agent's production version, unless the step sets `agent_version`.
Promoting the agent changes what the next automated call runs.

**Is a test run a real run?**
A test without `dryRun` runs every node it is given for real. A `mock_call`
swap stops the call only: a text, webhook, message, code or judge step in
the same pipeline still happens. All test runs show in the run history and
in the run count.

**Why does the dashboard show a different error than the API?**
The runs page shortens messages. The API's `error` is the full text; quote
that.

**Why did my alert email say resolved but nobody was called?**
Phone delivery only rings when an alert starts at, or rises to, CRITICAL.
Resolves and lower levels go to email and tools only.

**How do I stop an automation in a hurry?**
Pause the trigger with `{"is_active": false}`. Deleting it removes the
configuration you need to diagnose it.

**How do I verify a webhook really came from the platform?**
Generate a signing secret on Settings, Organization. Compute HMAC-SHA256
of the raw request body with it and compare with `X-Webhook-Signature`.
Automation webhook steps are signed the same way.
