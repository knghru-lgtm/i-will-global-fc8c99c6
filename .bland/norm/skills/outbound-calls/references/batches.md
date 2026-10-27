# Batches: the v2 contract

How to create, watch and stop a voice batch staffed by a v2 agent. Reads use
`bland_api_get`; writes use `call_bland_api` (`{method, path, body}`). Do not
write fetch scripts and do not search the docs for these routes.

## Contents

- [Create](#create)
- [The global trap](#the-global-trap)
- [How a row combines with global](#how-a-row-combines-with-global)
- [What happens to rows after create](#what-happens-to-rows-after-create)
- [Rate-limit pre-flight](#rate-limit-pre-flight)
- [DNC pre-flight](#dnc-pre-flight)
- [The canary](#the-canary)
- [Status lifecycle](#status-lifecycle)
- [status_webhook](#status_webhook)
- [Read and stop](#read-and-stop)
- [What needs the dashboard](#what-needs-the-dashboard)
- [Errors](#errors)

## Create

`call_bland_api` `POST /v2/batches/create`. Unknown top-level keys are
refused.

| Key | Notes |
|---|---|
| `call_objects` | Array of call bodies, one per recipient. Each needs `phone_number`. |
| `file_id` | An uploaded CSV. Not reachable from here; see [what needs the dashboard](#what-needs-the-dashboard). |
| `global` | Fields every row inherits. Must not contain `phone_number`. |
| `description` | Up to 60 characters. Name the campaign so the user can find it. |
| `status_webhook` | URL that receives lifecycle and completion posts. |
| `column_mapping` | Only with `file_id`. |

One of `call_objects` or `file_id` is required. A 200 returns
`{ batch_id }`. State it in your reply at once.

Synthetic example:

```json
{
  "description": "<campaign name>",
  "global": {
    "agent_id": "00000000-0000-4000-8000-000000000000",
    "agent_version": "production",
    "task": "Staffed by the v2 agent.",
    "from": "+15555550199",
    "metadata": { "campaign": "<campaign name>" }
  },
  "call_objects": [
    { "phone_number": "+15555550101", "request_data": { "first_name": "Ana" } },
    { "phone_number": "+15555550102", "request_data": { "first_name": "Ben" } }
  ],
  "status_webhook": "https://example.com/<your endpoint>"
}
```

## The global trap

`global` must carry a fallback: one of `task`, `pathway_id` or `persona_id`.
That check runs before the agent check, so a `global` with only `agent_id`
returns 400 `BATCH_V2_CREATE_VALIDATION_ERROR`. `pathway_id` and
`persona_id` conflict with `agent_id`, so a v2 batch sends `agent_id` **and**
a non-empty `task`. The agent version drives the call; the `task` text is a
placeholder. The dashboard sends one too.

## How a row combines with global

Each row is laid over `global` key by key. A key in the row replaces the
same key in `global` whole: a row's `request_data` replaces the global
`request_data`, it is not merged. Put shared values in `global` and only
per-person values in the row, or repeat the shared keys inside each row's
object.

Do not put `agent_id`, `pathway_id` or `persona_id` in a row. A row that
staffs something else fails at dispatch.

The version rules, `request_data` versus `metadata`, voicemail and webhooks
are the same as for one call: read [calls](calls.md#the-body).

## What happens to rows after create

A 200 with a `batch_id` means the batch was accepted, not that its rows are
good. Rows are checked right after, and the result is in the logs:

- A row with no `phone_number` fails the whole batch.
- A repeated number, an impossible number, or a number on the org's
  do-not-call list is dropped and logged as a validation failure. Numbers are
  compared as written after adding a leading `+`.
- A row `start_time` less than 5 minutes away dials now; more than 28 days
  away, the row is dropped.
- `dispatch_hours` works per row or in `global`, and needs `timezone`;
  without it the window is ignored.
- Every row's call is prepared as the batch starts, so the agent version is
  fixed then, even for rows scheduled later.
- Rows run 1,000 at a time. The next 1,000 start once the previous 1,000 have
  ended. There is no pacing or concurrency setting; spread a list with
  per-row `start_time` or split it.

The full lifecycle, with what each status means, is in
[how it works](how-it-works.md#a-batch).

## Rate-limit pre-flight

The Batches page refuses a batch larger than what is left of the org's
hourly or daily call allowance. Apply the same check before every batch.

1. `bland_api_get` `/user/rateLimits` returns
   `{ hourlyCount, dailyCount, template: { hourly_limit, daily_limit, … } }`.
2. Hourly remaining = `hourly_limit - hourlyCount`. Daily remaining =
   `daily_limit - dailyCount`. The windows are the current UTC clock hour and
   the current UTC day.
3. If the recipient count, plus one for a planned canary, is greater than
   either remaining value, **refuse**. Quote both numbers you read. Offer to
   split the list into batches that fit, sent after the window resets, or to
   remove recipients.
4. Read the allowance again right before creating the full batch, after the
   canary, and apply step 3 to the list alone. Calls placed since the first
   read (the canary, other traffic) count against it.
5. If a read fails, has no `template`, or answers `oauth_path_not_allowed`,
   do not create the batch. Say the allowance could not be checked and stop.

## DNC pre-flight

Rows on the org's do-not-call list are dropped when the batch validates and
logged as "Number is on your organization's do-not-call list." Check first so
the confirm states the real count.

- Up to about 20 recipients: `call_bland_api` `POST /v1/org_dnc/search` with
  `{ "phone_number": "<E.164>" }` per recipient.
- More: page `bland_api_get` `/v1/org_dnc` with `limit` (up to `1000`) and
  `offset` until you hold `total_count` entries, and compare the
  `entries[].phone_number` values with the list.
- Remove hits from `call_objects`. Report how many were removed, not the
  numbers themselves.
- On an OAuth connection the search route is refused; the list read is
  allowed.

## The canary

Before a full list, recommend a one-row batch with the same `global`, to a
number the user controls. Watch it to a terminal status, read the call with
`get_call_log`, and check that the agent version, caller id, variables and
voicemail behaved. Only then re-run the rate-limit pre-flight and confirm
the full list. A canary is a real call, counts against the allowance, and
needs its own confirm.

## Status lifecycle

`batch_status` on the batch row moves through:

`initializing` → `validating` → `dispatching` → `in_progress` →
`in_progress_chunked` (only past 1,000 rows) → `waiting_for_scheduled_calls`
(only when rows were scheduled) → one of `completed`, `completed_partial`,
`failed`.

- A stopped batch ends `failed`; one that waited 24 hours for its calls to end
  ends `completed_partial`.
- `completed` means every queued call ended, not that every call connected.
  `calls_successful` includes no-answer and busy.
- Every terminal status is final. Read the logs for the reason. The diagram is
  in [how it works](how-it-works.md#a-batch).

## status_webhook

Optional URL. The batch posts JSON to it at each lifecycle step and at the
end:

```text
{ batch_id, status, message?, code?, reason?,
  calls_total?, calls_successful?, calls_failed?, timestamp }
```

`status` takes the values above from `validating` on; nothing is posted for
`initializing`. Delivery is best-effort with a 10-second timeout and no retry;
treat it as a signal and read the batch to confirm.

## Read and stop

| Route | Notes |
|---|---|
| `GET /v2/batches/list` | `agent_id` (UUID, optional), `take` (default 10, max 100), `skip`. Newest first. |
| `GET /v2/batches/<batch id>` | The batch row: `batch_status`, `description`, `agent_id`, `created_at`, the stored rows. An unknown id returns `data: null`. |
| `GET /v2/batches/<batch id>/logs` | `take` (default 10, max 100), `skip`, `direction` (`asc` or `desc`, default `desc`). Lifecycle events with reasons. |
| `GET /v1/calls?batch_id=<batch id>` | The batch's calls. For review in bulk, hand off to [call analysis](../../call-analysis/SKILL.md). |
| `POST /v2/batches/<batch id>/stop` | Confirm first. Calls not yet dialed, scheduled rows included, are not placed. Calls already connected run on; stop them one by one with `stop_call`. The batch ends `failed` and cannot be resumed. 400 `BATCH_V2_STOP_ERROR_NOT_FOUND` means already finished, stopped or unknown. |

Poll the batch every 15 to 30 seconds while it dispatches, then less often.

## What needs the dashboard

Say the dashboard path and stop; do not try to work around it.

- **CSV upload.** `file_id` comes from a multipart upload the passthrough
  cannot send. Inline `call_objects` covers the same voice batch.
- **SMS batches.** `POST /v1/sms/batch` requires a `file_id`. Use the
  Batches page.
- **Your own carrier account.** Batch create takes `encrypted_key` from a
  request header. The passthrough cannot set headers and the Batches page has
  no connection option, so send such a batch from the user's own API client,
  or place the calls one at a time (a single call accepts `encrypted_key` in
  the body).

## Errors

| Code | Meaning | Fix |
|---|---|---|
| `BATCH_V2_CREATE_VALIDATION_ERROR` | Body shape, missing `call_objects`/`file_id`, `phone_number` in `global`, no `task` fallback, or a bad `column_mapping`. The message names the field. | Fix that field only. |
| `AGENT_ID_INVALID` | `global.agent_id` is not a UUID. | Read the id again. |
| `AGENT_PARAM_CONFLICT` | `global` mixes `agent_id` with `pathway_id` or `persona_id`. | Keep `agent_id` and `task`. |
| `AGENT_ORG_REQUIRED` | Not an organization key or session. | Do not switch orgs. |
| `AGENT_NOT_FOUND` | No such agent in this org. | Check the org and the id. |
| `BATCH_V2_CREATE_ERROR` (500) or a timeout | The batch may exist. Create is not idempotent: a resend makes a second batch. | Read `/v2/batches/list` and look for the description before sending again. |

Version problems such as `AGENT_ENV_UNPINNED` are not caught at create. They
fail every row at dispatch, which is one more reason for the canary.
