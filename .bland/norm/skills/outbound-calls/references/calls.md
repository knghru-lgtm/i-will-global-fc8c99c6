# Calls: the v2 dispatch contract

How to place, schedule, follow and stop one outbound call staffed by a v2
agent. Every route here goes through `bland_api_get` (reads) or
`call_bland_api` (`{method, path, body}`). Do not write fetch scripts and do
not search the docs for these routes.

## Contents

- [Why not create_call](#why-not-create_call)
- [The body](#the-body)
- [Which version runs](#which-version-runs)
- [Caller id](#caller-id)
- [request_data and metadata](#request_data-and-metadata)
- [Voicemail](#voicemail)
- [Webhooks](#webhooks)
- [Scheduling](#scheduling)
- [Your own carrier account](#your-own-carrier-account)
- [Response and follow-up](#response-and-follow-up)
- [Stopping](#stopping)
- [Do-not-call check](#do-not-call-check)
- [Errors](#errors)

## Why not create_call

The `create_call` tool accepts only `phoneNumber`, `task`, `pathwayId`,
`voice`, `from` and `firstSentence`. It has no `agent_id` and no
`agent_version`, so it cannot run a v2 agent. Use `call_bland_api` with
`POST /v1/calls`.

## The body

Send the dispatch fields and nothing else. The agent version owns the
behavior: voice, language, keywords, interruption settings, `max_duration`,
`record`, `noise_cancellation`, background track, voicemail and the default
`request_data` and `metadata`. A value you send for any of those overrides the
version for this call only.

| Field | Required | Notes |
|---|---|---|
| `phone_number` | yes | E.164, for example `+1<ten digits>`. |
| `agent_id` | yes | The agent UUID. Cannot be combined with `pathway_id` or `persona_id`. Needs an organization API key or an org session. |
| `agent_version` | no | Selector. Omitted means the production pin. See [which version runs](#which-version-runs). |
| `from` | no | Caller id in E.164; must be a number on the account. Omitted means the system picks one. |
| `request_data` | no | Object the agent reads as call variables. |
| `metadata` | no | Object stored on the call for your own systems. |
| `webhook` | no | URL that receives the post-call payload. |
| `webhook_events` | no | Extra event types for the same URL. |
| `voicemail` | no | Overrides the version's voicemail behavior. |
| `start_time` | no | Schedules the call. |
| `external_id` | no | Your own id for the call, up to 256 characters; filter later with `GET /v1/calls?external_id=`. |
| `max_duration` | no | Minutes. Overrides the version's cap. |
| `record` | no | Overrides the version's recording setting. |

Synthetic example:

```json
{
  "phone_number": "+15555550100",
  "agent_id": "00000000-0000-4000-8000-000000000000",
  "agent_version": "production",
  "from": "+15555550199",
  "request_data": { "first_name": "Jordan", "appointment_date": "2026-01-15" },
  "metadata": { "crm_contact_id": "<your id>" }
}
```

## Which version runs

The selector grammar and the per-channel table live in
[the lifecycle skill](../../v2-lifecycle/SKILL.md). For outbound calls:

- Accepted selectors: `production`, `staging`, `dev`, `latest`, a minted
  semver `X.Y.Z`, `branch:<name>`.
- **An unrecognised selector is refused.** A typo such as `prod`, or a bare
  number, returns a 400 that lists the accepted forms, and nothing dials. Echo
  the exact selector back before dialing anyway.
- `dev` and `latest` both mean the newest save on the main line, not a branch
  and not a pin.
- A call with no selector runs the production pin, and it can be routed into
  a running A/B experiment arm. Pass `agent_version: "production"` to pin it
  and skip the experiment.
- The selector also picks which environment's variables resolve. `dev`,
  `latest`, a semver and `branch:` resolve dev variables, even when that
  semver is the production pin.
- The version is fixed when the call is created. A scheduled call keeps it
  even if the pin moves before the call dials.

Read the pins with `bland_api_get` on `/v2/agents/<agent id>/environments`:
three rows, each with `env_type` and `current_version` (`name`, `semver`) or
`null`. A `null` production pin means a selector-less call fails with
`AGENT_ENV_UNPINNED`.

## Caller id

Read the account's numbers with `bland_api_get` on `/v1/inbound`
(`inbound_numbers[].phone_number`). Pass the chosen one as `from`. Say which
number the person will see, or that the system will pick one. Do not invent a
`from`; a number not on the account is refused.

## request_data and metadata

- `request_data` is what the agent reads during the call, as `{{key}}`.
- `metadata` is stored on the call. It comes back in the call log and in the
  post-call webhook payload, so downstream systems can match the call to their
  own record. The agent can also read it, as `{{metadata.<key>}}`; a
  `request_data` key named `metadata` is replaced by it.
- Both are **whole-object replacements**. If the agent version has default
  `request_data` and you send `request_data`, the default is dropped, not
  merged. Read the version's defaults first if the call depends on them, and
  send the merged object. An explicit `{}` suppresses the default.

## Voicemail

Leave `voicemail` out to keep the version's behavior. To override:

```json
{
  "voicemail": {
    "action": "leave_message",
    "message": "Hi, this is <business> calling about <topic>. Please call us back at this number."
  }
}
```

`action` is one of `hangup` (the runtime default), `leave_message`,
`leave_message_and_sms` (add `sms: { "message": "<text>" }`), `leave_sms`, or
`ignore` (keep talking through the greeting). Decide this before a cold
campaign: many calls reach voicemail.

- Any `voicemail` object replaces the version's whole voicemail setting.
- A `message` forces `leave_message` (or `leave_message_and_sms` with `sms`),
  whatever `action` says. Leave `message` out for `hangup` or `leave_sms`.
- The message may use `{{variables}}` from `request_data`. An empty message on
  a leave action hangs up instead.
- What each action does on the line: [how it works](how-it-works.md#how-it-reaches-a-live-call).

## Webhooks

- `webhook` receives the post-call payload when the call ends.
- `webhook_events` adds event types to the same URL. Accepted values:
  `latency`, `queue`, `call`, `dynamic_data`, `webhook`, `tool`, `citations`,
  `evals`, `post_transfer_transcript`.
- `post_transfer_transcript` needs recording. It turns recording on when
  `record` is left out, and the call is refused with a 400 when `record` is
  set to anything but `true`.
- Setting up org-wide webhooks or resending a payload is not this skill's
  job.

## Scheduling

- `start_time` is an ISO 8601 timestamp. Always include the offset or `Z`
  (`2026-01-15T17:30:00-05:00`). Confirm the time back in the user's own
  timezone. It must be at least 5 minutes and at most 30 days ahead.
- The response returns a `call_id` at once; the call waits until the time.
  `stop_call` on that id cancels it.
- While it waits, the call reads `completed: true` with an empty `status`, so
  `wait_for_call` returns at once. That is not an outcome; check again after
  the start time.
- `dispatch_hours` (`{ "start": "9:00am", "end": "5:00pm" }`) and `timezone`
  (an IANA name, or `auto` for US area codes) restrict when a call may start.
  A call outside the window is held until the next opening. **Without
  `timezone` the window is ignored** and the call dials at once.

## Your own carrier account

Some orgs dial through their own carrier account and select it with an
`encrypted_key`. The dashboard sends it as a request header. The passthrough
cannot set headers, but the API also reads `encrypted_key` from the body of a
single call. Never print the key in chat. For batches, see
[batches](batches.md#what-needs-the-dashboard).

## Response and follow-up

A 200 returns `{ status: "success", call_id, message }`, sometimes with a
`max_duration_notice` when a plan cap shortened the call. The call is queued,
not finished. State the `call_id` in your reply at once.

1. `wait_for_call` with `{ "id": "<call id>" }` holds 30 seconds by default
   (`timeoutSeconds` up to 45) and returns at a terminal status:
   `completed`, `failed`, `error`, `no-answer`, `busy`, `canceled`. Call it again while the call runs. Where the host has
   no `wait_for_call`, poll `bland_api_get` on `/v1/calls/<call id>` every
   15 seconds or so.
2. `get_call_log` with `{ "id": "<call id>" }` for the transcript, summary,
   recording URL and `answered_by`.
3. A few-second call with `answered_by: voicemail` worked: it reached
   voicemail and followed the voicemail action.

Why a finished call went wrong is [call analysis](../../call-analysis/SKILL.md).

## Stopping

- One call: `stop_call` with `{ "id": "<call id>" }`, or `call_bland_api`
  `POST /v1/calls/<call id>/stop`. It hangs up on the person, or cancels a
  scheduled call.
- Never `POST /v1/calls/active/stop`. It ends every live call in the org,
  including inbound calls and other people's campaigns.

## Do-not-call check

`call_bland_api` `POST /v1/org_dnc/search` with
`{ "phone_number": "<E.164>" }` returns `{ entries[], total_count }`. Any
entry means the number is on the org's list. Call creation enforces the list
anyway, for the destination and for every transfer target (a 400 naming the
do-not-call list, or a 503 when the list cannot be checked), but checking
first avoids a confirm for a call that cannot happen. After a number is added
to the list, stop any call to it that is already scheduled. The lookup takes
the number in the body on purpose; do not put numbers in query strings. Adding or removing
entries is owner or admin work in a signed-in session, not this skill.

## Errors

Never retry a 4xx unchanged. Fix the cause or tell the user what unlocks it.

| Code or status | Meaning | Fix |
|---|---|---|
| 400 naming `agent_version` | The selector is not one of the accepted forms. | Use `production`, `staging`, `dev`, `latest`, `X.Y.Z` or `branch:<name>`. |
| 400 "Invalid 'from' …" | The caller id is not a number on the account. | Pick one from `/v1/inbound`, or omit `from`. |
| `AGENT_PARAM_CONFLICT` | `agent_id` sent with `pathway_id` or `persona_id`. | Remove the other two. |
| `AGENT_ORG_REQUIRED` | The key is not an organization key. | Use an org key or session; do not switch orgs. |
| `AGENT_ID_INVALID` | `agent_id` is not a UUID. | Read the id from the page or `/v2/agents`. |
| `AGENT_NOT_FOUND` | No such agent in this org. | Check the org and the id. |
| `AGENT_ENV_UNPINNED` | No version deployed to the environment asked for. | Promote one, or pass an explicit selector the user agrees to. |
| `AGENT_VERSION_NOT_FOUND`, `AGENT_BRANCH_NOT_FOUND` | Selector names a missing semver or branch, or the agent has no versions. | Read versions or branches and pick a real one. |
| `AGENT_VARIABLE_UNRESOLVED` | An `{{env.KEY}}` has no value in the selector's environment. | Set the variable for that environment. |
| `AGENT_SNAPSHOT_INVALID` | The version fails validation or compile. | Fix and save a new version; do not dial. |
| `CALL_PLAN_DESTINATION_BLOCKED`, `CALL_PLAN_TRANSFER_BLOCKED` | The plan calls and transfers to allowed countries only. | Use an allowed destination. Credits do not change this. |
| `CALL_RL_PLAN_CONCURRENCY`, `CALL_RL_PLAN_DAILY_MINUTES` | A plan limit is reached. | Wait for the running call or the next day. |
| `CALL_UNPAID_INTL_BLOCK` | International calling needs a completed purchase. A saved card alone does not unlock it. | Buy credits or turn on auto-recharge under Billing; it unlocks once the payment settles. |
| 400 naming the do-not-call list | The number is on the org's list. | Do not dial. |
| 429 with `limit_type`, `retry_after_seconds`, `reset_at` | Hourly or daily call limit. | Wait until `reset_at`; do not loop. |
| 429 "Calls can only be sent every 10 seconds to the same number." | A second call to the same number too soon. | Wait a few seconds; retry once. |
| Timeout or connection loss | The call may have been placed. | Read `GET /v1/calls?to_number=<E.164>` for a fresh call before sending again. |
| `oauth_path_not_allowed` | This connection cannot reach the route. | Say so and name the dashboard page. Do not route around it. |
