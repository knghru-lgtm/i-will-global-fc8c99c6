# How outbound calls and batches work

The conceptual page for placing calls with a v2 agent. Request bodies, routes
and error codes live in [calls](calls.md) and [batches](batches.md); this page
explains what happens to a call between the request and the hang-up, and why.

## Contents

- [What it is](#what-it-is)
- [Objects and how they relate](#objects-and-how-they-relate)
- [Lifecycle and states](#lifecycle-and-states)
- [How it reaches a live call](#how-it-reaches-a-live-call)
- [On the dashboard](#on-the-dashboard)
- [Rules and limits](#rules-and-limits)
- [When it goes wrong](#when-it-goes-wrong)
- [Questions people ask](#questions-people-ask)

## What it is

An outbound call is the agent ringing a person. There are two ways to ask for
one:

- **One call**: `POST /v1/calls` with `agent_id`, a phone number and,
  optionally, which version to run.
- **A batch**: `POST /v2/batches/create` with a shared `global` block and a
  list of rows. Each row becomes one ordinary call that carries the batch id.

Both run a saved agent version. The version owns the behavior (voice,
language, interruptions, voicemail, recording, maximum length). The request
owns the dispatch (who, when, from which number, with which per-person data).

What it is not:

| People say | What it actually is |
| -- | -- |
| "A test call" | A real call to a real phone, billed per minute. For a safe test use test chat or a simulation ([testing](../../v2-testing/SKILL.md)). |
| "A campaign with pacing" | A batch is a list of single calls created together. It has no concurrency or pacing setting. |
| "Schedule a recurring call" | `start_time` is one moment for one call. Recurring or event-driven calls are [automations](../../automations/SKILL.md). |
| "Call variables" | Three different things. `request_data` is per call. `{{env.KEY}}` agent variables are per environment and set on the agent. `metadata` is your own bookkeeping, also visible to the agent. |
| "Block list" | Block rules refuse inbound callers. The do-not-call list stops outbound dials. Neither covers the other direction. |

## Objects and how they relate

```text
 org (live, unversioned)
 ├─ do-not-call list ───────── checked for every dial and every transfer target
 ├─ owned numbers ──────────── candidates for `from` (caller id)
 ├─ hourly and daily allowance  read with GET /user/rateLimits
 ├─ batch ── global + rows ──┐
 │                           ├──► call (one per row, carries batch_id)
 └─ single call ─────────────┘
          │ agent_id + agent_version (the selector)
          ▼
 agent (versioned)
 ├─ production pin, staging pin
 ├─ newest save on the main line   (selector "dev" or "latest")
 ├─ branches                        (selector "branch:<name>")
 ├─ version snapshot: voice, language, voicemail, max duration, recording,
 │                    default request_data and metadata, keywords
 └─ agent variables {{env.KEY}}, one value set per environment
```

Who wins when a field is set in more than one place:

```text
 field you send on the call (or the batch row, or global)   wins
 the agent version's own setting                            used when you sent nothing
 the platform default                                       hang up on voicemail,
                                                            30-minute cap, no recording
```

Two groups move as one value, never key by key:

- **`request_data` and `metadata`** replace the version's defaults whole. Send
  `{}` to suppress them; send a merged object to keep some.
- **Voicemail** (action, message, text) applies as a group. If you send any
  voicemail field, none of the version's voicemail settings apply.

## Lifecycle and states

### A single call

```text
 POST /v1/calls ──400 / 402 / 429 / 503──► refused, nothing dials
      │ 200 { call_id }
      ▼
   queued ──── start_time, or outside dispatch_hours ────► waiting for its time
      │                                                       │ (time arrives)
      ▼                                                       ▼
   ringing ─────────► in-progress ─────────► completed
      │
      ├──► no-answer | busy | failed (error_message set)
      └──► canceled   (stopped before it dialed)
```

| Field on the call | Values and meaning |
| -- | -- |
| `status` | The line status: `ringing` and `in-progress` while live, then one of `completed`, `no-answer`, `busy`, `failed`, `canceled`. Empty until the call dials. |
| `queue_status` | `queued` until the call dials, `started` once it does. |
| `completed` | `true` when the call is over. |
| `answered_by` | `human`, `voicemail`, `unknown`, or empty when detection reached no decision. |
| `error_message` | Why a call failed, for example "Call failed. The number you dialed is not found." |

Terminal: `completed`, `no-answer`, `busy`, `failed`, `canceled`, or any call
with `error_message` set. Nothing is reversible; a second attempt is a new
call with a new `call_id`.

A scheduled call is the exception to read with care: while it waits, it shows
`completed: true` with an empty `status`. It flips to `completed: false` when
it dials. So `wait_for_call` returns at once for a scheduled call; that is
not an outcome.

### A batch

```text
 POST /v2/batches/create ─200 { batch_id }─► initializing ─► validating
                                                                │
                      no valid rows, or a row with no number ───┼──► failed
                                                                ▼
                                                           dispatching
                                                                ▼
                                                           in_progress
                                          more than 1,000 rows │
                                   in_progress_chunked ◄───────┤ (next 1,000 start
                                                               │  after the previous
                                                               │  1,000 have ended)
                           rows with a later start_time        │
                         waiting_for_scheduled_calls ◄─────────┤
                                                               ▼
                                                           completed
 stop at any point ──► failed            24 hours without the calls ending ──► completed_partial
```

| Status | Meaning |
| -- | -- |
| `initializing` | Accepted. The `batch_id` exists; no row has been checked. |
| `validating` | Rows are checked. Bad rows are dropped one by one and logged. |
| `dispatching` | Valid rows are being turned into calls. |
| `in_progress`, `in_progress_chunked` | Calls are out; the batch waits for each to end. |
| `waiting_for_scheduled_calls` | Only rows with a future `start_time` remain. |
| `completed` | Every queued call reported an end. Not "every call succeeded". |
| `completed_partial` | The batch timed out waiting. Calls already placed are unaffected. |
| `failed` | Nothing valid to dial, or the batch was stopped. |

The final counts treat a call that ended normally, including no answer and
busy, as `calls_successful`. A call that failed or was canceled counts as
`calls_failed`. Rows refused before they became calls appear only in the
logs, so read `/v2/batches/<id>/logs` for the full per-row picture.

Every terminal status is final. A batch cannot be resumed; create a new one
with the remaining rows.

## How it reaches a live call

```text
 at create (one call), or at each row's dispatch (batch)
   1  body checked: phone numbers, selector shape, start_time
   2  selector resolved to one saved version; snapshot validated and compiled
   3  agent variables for that environment filled in
   4  version settings applied to every field you did not send
   5  checks: call allowance, do-not-call, caller id ownership, plan limits
   6  call queued, call_id returned
 at dial time
   7  the version prepared in step 2 runs; nothing is re-read
 during the call
   8  request_data keys read as {{key}}; metadata as {{metadata.key}}
 after the call
   9  call log, webhook, batch counters
```

What this means in practice:

- **The version is frozen at create.** A call scheduled for tomorrow runs the
  version its selector named when you created it. Promoting a new version
  tonight does not change it. Cancel and re-create to pick up the new one.
- **Batch rows are prepared right after the batch starts**, including rows
  scheduled for later. The same freeze applies.
- **The selector also picks the variables.** `production` and `staging` read
  that environment's agent variables. `dev`, `latest`, a semver and
  `branch:<name>` read dev values, even when that semver is the one pinned to
  production. A variable with no value fails the call at create.
- **No selector means "production, unless an experiment is running".** A
  selector-less call can be routed into a running A/B experiment arm. Any
  explicit selector, `production` included, skips experiments.
- **Voicemail detection** listens to the opening of the call. On a machine,
  the call follows its voicemail action:

| Action | What the person's voicemail gets |
| -- | -- |
| `hangup` (default) | Nothing. The call ends; the transcript notes it. |
| `leave_message` | The agent waits for the beep (or silence), says the message, then ends. |
| `leave_sms` | The call ends and a text is sent to the number. |
| `leave_message_and_sms` | Both. |
| `ignore` | The agent keeps talking as if a person answered. |

The message can use `{{variables}}` from `request_data`. A leave action with
an empty message just hangs up. A message always wins: sending a voicemail
`message` makes the action `leave_message` (or `leave_message_and_sms` when a
text is also set), whatever `action` says.

## On the dashboard

| Page | What it shows and does | What only the API does |
| -- | -- | -- |
| Send call `/dashboard/send-call` | Agent or prompt source. Version picker: Production and Staging (with semver), "Latest saved draft", and each "Version X.Y.Z". Caller ID and dialer pool, request data and metadata as JSON objects, webhook URL, scheduled time in the browser's time zone. Live request preview, paste-in JSON, saved configurations. After sending, a live transcript; a scheduled call shows "Call scheduled" until it starts. | `branch:<name>` selectors, `dispatch_hours`, `timezone`, `external_id`, `webhook_events`, voicemail override. |
| Batches `/dashboard/batches` | Org-wide list, newest first. Wizard: Recipients (CSV) → Script → Review & send. Detail panel with the live log and "View calls" (Conversations filtered to the batch). SMS batches on enterprise plans. | Inline `call_objects`, a version selector, `from`, `start_time` and `dispatch_hours`, `request_data` in `global`, `metadata`, `webhook`, `status_webhook`. |
| Agent batches `/dashboard/agent/<agentId>/batches` | The same, filtered to the agent, with the staffing agent locked. Calls only. | As above. |

Details that surprise people:

- **The Send call page always sends a selector**, `production` by default, so
  its calls never enter an experiment.
- **The Batches page sends no selector.** Its calls run the production pin and
  can enter an experiment.
- **The Batches page sets its own call settings.** It sends a 12-minute
  maximum and recording on (the wizard's defaults), which replace the agent's
  own settings for those calls. "Instructions" is required by the form, but a
  v2 agent's version drives the call, not that text.
- **CSV checks.** A file with an empty or impossible phone number is refused
  before upload, with the line numbers. A repeated number is accepted and
  skipped at dispatch. Numbers are compared as written after adding a leading
  `+`, so `+14155550100` and `+1 415 555 0100` count as two.
- **Allowance guard.** The wizard blocks "Start calling" when the recipient
  count exceeds what is left of the hourly or daily allowance: "This batch
  would exceed your hourly call limit. Remove recipients or try again later."
  This skill applies the same check, and refuses when it cannot read the
  allowance.
- **Stopping.** Stop from the list asks to confirm; Stop in the detail panel
  does not.
- **Refresh.** The list refreshes every few seconds while a batch it shows is
  active, and the live log every two seconds. `in_progress_chunked` and
  `waiting_for_scheduled_calls` show as "Unknown" and stop the auto-refresh;
  reload to see the end.
- A call or batch created through the API appears on these pages after a
  refresh.

## Rules and limits

| Rule | Limit or default | What the user sees |
| -- | -- | -- |
| Agent source | `agent_id` with an organization key or org session; never with `pathway_id` or `persona_id` | `AGENT_ORG_REQUIRED`, `AGENT_PARAM_CONFLICT` |
| Selector | `production`, `staging`, `dev`, `latest`, `X.Y.Z`, `branch:<name>` (name: letters, digits, `.`, `_`, `-`, up to 64) | Anything else is a 400: "agent_version must be a semantic version like '1.2.0', 'branch:<name>', or one of 'dev', 'latest', 'staging', 'production'." |
| Caller id | `from` must be a number on the account | 400 "Invalid 'from' - you might not own this number. Did you specify a country code?" |
| Same number twice | Calls to one number may need to be 10 seconds apart | 429 "Calls can only be sent every 10 seconds to the same number." |
| Hourly and daily allowance | Per org, counted in UTC clock hours and UTC days | 429 with `limit_type`, `limit`, `retry_after_seconds`, `reset_at` and a `Retry-After` header |
| Do-not-call | Checked for the destination and every transfer target | 400 "This number is on your organization's do-not-call list."; 503 when the list cannot be checked |
| Scheduling | `start_time` at least 5 minutes ahead and at most 30 days | 400 "Calls must be scheduled at least 5 minutes in advance, or more" |
| Dispatch window | `dispatch_hours` `{ "start": "9:00am", "end": "5:00pm" }` (also `9am`, `09:00`, `17:00:00`) with `timezone` (IANA name or `auto`) | Without `timezone` the window is ignored and the call dials at once. `auto` reads US area codes as Pacific, Central or Eastern; anything else as Pacific. |
| Length | `max_duration` in minutes; default 30 unless the version sets one | A plan cap returns `max_duration_notice` on the 200 |
| Agent Phone Plan | 1 concurrent call, 1,000 minutes a day, US and Canada only | `CALL_RL_PLAN_CONCURRENCY`, `CALL_RL_PLAN_DAILY_MINUTES`, `CALL_PLAN_DESTINATION_BLOCKED` |
| International | Needs a completed purchase | `CALL_UNPAID_INTL_BLOCK` |
| `external_id` | Up to 256 printable characters | Read the call back with `GET /v1/calls/<external id>` or `?external_id=` |
| Batch body | Unknown top-level keys refused; `description` up to 60 characters; `global` must not hold `phone_number` and needs `task`, `pathway_id` or `persona_id` | `BATCH_V2_CREATE_VALIDATION_ERROR` naming the field |
| Batch rows | A row with no phone number fails the whole batch. Duplicates, impossible numbers and do-not-call numbers are dropped and logged. | Log entries of type Validation Failure |
| Batch scheduling | A row `start_time` under 5 minutes away dials now; over 28 days away the row is dropped | Validation Failure in the logs |
| Batch size in flight | Rows run 1,000 at a time; the next 1,000 start when the previous have ended | Lifecycle notice "Batch will execute in chunks of 1000 call(s)." |
| Batch wait | 24 hours for the calls of a chunk to end (longer when rows are scheduled) | `completed_partial` |
| Recording-dependent events | `post_transfer_transcript` in `webhook_events` turns recording on when `record` is absent | 400 when `record` is explicitly not `true` |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
| -- | -- | -- | -- |
| 400 about `agent_version` | A label such as `prod` or a bare number | The 400 message lists the accepted forms | Use `production` or a real semver |
| `AGENT_ENV_UNPINNED` | No version deployed to the environment asked for (or to production, with no selector) | `GET /v2/agents/<id>/environments` shows `current_version: null` | Promote a version, or name one |
| `AGENT_VARIABLE_UNRESOLVED` | An `{{env.KEY}}` has no value in the selector's environment | The message names the keys and environment | Set the variable for that environment |
| The call ran an older version | Selector named an environment that moved after create, or no selector and an experiment arm | The version on the call in Conversations; `GET /v1/calls?agent_experiment_id=<id>` lists an experiment's calls | Pass an explicit selector; re-create scheduled calls after a promotion |
| `{{first_name}}` spoken literally or empty | `request_data` sent without that key, replacing the version's defaults | The call's `request_data` | Send the merged object |
| Voicemail message not left | A `voicemail` override without `message`, or the version's message is empty | `answered_by: voicemail` and a short transcript ending at the greeting | Send `action` and `message` together |
| Message left even though `action` was `hangup` | A `message` was also sent | The request body | Drop the message, or the action is ignored |
| Batch shows `completed` but most calls failed | `completed` means every call ended, not that they connected | `calls_failed`, the logs, `GET /v1/calls?batch_id=` | Review in call analysis |
| Batch went `failed` at once | No valid rows, a row without a number, or it was stopped | The batch logs' lifecycle entry | Fix the rows and create a new batch |
| Every row failed at dispatch | A version problem (unpinned, missing variable, bad selector) | Dispatch Failure entries naming the code | Fix the version; run a one-row canary first |
| Fewer calls than rows | Duplicates, do-not-call numbers, impossible numbers dropped | Validation Failure entries | Expected; report the count |
| A scheduled call "finished" instantly | `wait_for_call` reads the waiting call as done | `completed: true`, `status` empty, `start_time` in the future | Wait until the start time, then poll |
| A call outside business hours | `dispatch_hours` sent without `timezone` | The call's `timezone` is empty | Add `timezone` |
| 429 on the second call to a number | Same number within 10 seconds | The 429 message | Wait and retry once |
| Request timed out | The call or batch may exist | `GET /v1/calls?to_number=` or `GET /v2/batches/list` | Read before re-sending; creates are not idempotent |

## Questions people ask

**Does a typo in the version fall back to production?**
No. An unrecognized selector is a 400 and nothing dials. Only a missing
selector means production.

**Can the agent see `metadata`?**
Yes, as `{{metadata.<key>}}`. It is still stored on the call and returned in
the call log and webhook, which is what it is for.

**If I promote a new version, do already scheduled calls change?**
No. A call runs the version resolved when it was created. Stop and re-create
it.

**Why did my batch call people at 2 a.m.?**
A batch has no default calling window. Set `dispatch_hours` with a `timezone`
in `global`, or per row.

**Can I slow a batch down?**
There is no pacing setting. The platform places calls as capacity allows.
Spread the list with per-row `start_time`, use `dispatch_hours`, or split it
into smaller batches.

**What does stopping a batch do?**
Calls not yet dialed, including scheduled rows, are not placed. Calls already
connected keep going; stop each with `POST /v1/calls/<id>/stop`. The batch
ends `failed`. It cannot be resumed.

**Does a new do-not-call entry stop a call that is already scheduled?**
Check it yourself. The list is checked when a call is created, and for a
batch when the batch starts. After adding a number, look for scheduled or
queued calls to it (`GET /v1/calls?to_number=`) and stop them.

**Why is `answered_by` empty?**
Detection had not reached a decision when the call ended, for example on a
very short call. `unknown` means it ran and could not tell.

**Which number will the person see?**
The `from` you send, which must be on the account. Without one, the platform
picks one. The agent's own inbound number is not used automatically.

**Is a call that hit voicemail a failure?**
No. With the default action it ends within seconds, `answered_by: voicemail`,
and counts as a normal end in batch totals.
