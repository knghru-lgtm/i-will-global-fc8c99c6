# Triage API

Every route the Issues page uses, under `/v1/triage`. Reads go through
`bland_api_get` (query values are strings); writes go through `call_bland_api`
with `method`, `path` and `body`. Do not write fetch scripts and do not search
the docs for these routes.

## Contents

- [Conventions](#conventions)
- [Issues](#issues)
- [Evidence](#evidence)
- [Flags](#flags)
- [Comments and activity](#comments-and-activity)
- [Relations](#relations)
- [Categories](#categories)
- [Alert bindings](#alert-bindings)
- [Eval analysis](#eval-analysis)
- [Triage runs](#triage-runs)
- [Errors](#errors)
- [Not available here](#not-available-here)

## Conventions

- Envelope: `{ "data": …, "errors": null }`. A DELETE answers 204 with no body.
- Path ids are the issue `id`. The display number (`triage_id`, shown as
  `T-n`) only works as a `search` value.
- Lists return `{ "items": [...], "next_cursor": "<cursor or null>" }`. Pass
  `cursor` and `limit` (1 to 100) to page.
- Bodies are strict. An unknown key answers 400 `Invalid params: …`.
- Every write takes effect at once. Confirm each one as the skill says
  before you send it.
- OAuth-connected hosts are refused on all of `/v1/triage` with
  `oauth_path_not_allowed`.

## Issues

| Method and path | Body or query | Status |
|---|---|---|
| GET `/v1/triage/issues` | query below | 200 |
| POST `/v1/triage/issues` | create body below | 201, the issue |
| GET `/v1/triage/issues/<id>` | | 200, 404 |
| PATCH `/v1/triage/issues/<id>` | any of `title`, `description`, `status`, `severity`, `category`, `owner_id`, `assignee_id` (`null` clears the last two) | 200, the issue |
| DELETE `/v1/triage/issues/<id>` | | 204. Soft delete: the issue leaves every list and no route restores it. |
| PUT `/v1/triage/issues/<id>/view` | | 200. Marks it read for you. |

List query keys:

- `search`: title, description, or the issue number (`T-1023`, `1023`).
- `agent_id`, `agent_version_id`: the agent-scoped page pins `agent_id`.
- `status`, `severity`, `category`: repeatable. Through `bland_api_get` send
  one value, or omit it and filter the items yourself.
- `owner_id`, `assignee_id`, `resource_type` (`call`, `sms_conversation`,
  `file`), `has_alert` (`"true"`, `"false"`).
- `date_field` (`last_activity_at`, `created_at`) with `date_range` (`24h`,
  `7d`, `30d`, `90d`).
- `sort` (`last_activity_at`, `created_at`, `severity`, `status`), `order`
  (`asc`, `desc`), `cursor`, `limit`.

Values:

- `status`: `backlog`, `todo` (the default), `in_progress`, `in_review`,
  `done`, `closed`.
- `severity`: `critical`, `high`, `medium`, `low`. Required on create.
- `category`: a name, 1 to 64 characters. Required on create. Read
  [categories](#categories) first.
- `source`: `manual` (the default), `automated`, `client`.

Create body (synthetic):

```json
{
  "title": "Agent repeats the greeting after a transfer is declined",
  "severity": "high",
  "category": "Dialogue",
  "description": "Expected: offer a callback. Actual: greeting replays. Repro: decline the transfer. Ruled out: tool failure.",
  "agent_id": "<agent id>",
  "agent_version_id": "<agent version id>",
  "resource_links": [{ "resource_type": "call", "resource_id": "<call id>" }]
}
```

- `title` is 1 to 200 characters; `description` up to 10000.
- `agent_id` and `agent_version_id` cannot be changed by PATCH. An issue
  created without them takes the agent and version of the first call
  attached to it. An issue with no `agent_id` does not show on the agent's
  Issues page.
- `assignee_id` on create or PATCH sends the assignee an in-app notification
  and an email. Later edits and comments notify the assignee in the app.

## Evidence

| Method and path | Body | Status |
|---|---|---|
| GET `/v1/triage/issues/<id>/resources` | `cursor`, `limit` | 200 |
| POST `/v1/triage/issues/<id>/resources` | `resource_type` (`call`, `sms_conversation`, `file`), `resource_id` | 201, the link. Attaching the same item twice returns the existing link. |
| DELETE `/v1/triage/issues/<id>/resources/<resourceLinkId>` | | 204 |
| PUT `/v1/triage/issues/<id>/calls/<callId>` | none | 200, the issue |
| DELETE `/v1/triage/issues/<id>/calls/<callId>` | | 204; 404 `Resource not found` if not attached |
| GET `/v1/triage/issues/<id>/affected` | | 200, the affected agent context |

- A call must be a call id from this org, or the API answers 404
  `Call not found`. An SMS thread is an SMS conversation id (404
  `SMS conversation not found`).
- A `file` resource needs a file id from an upload, which is multipart. Attach
  files on the Issues page.
- Scenarios, nodes and agent versions are not resources. Put the agent and
  version on the issue, the node on a flag, and the scenario in the
  description.

## Flags

A flag marks one moment of an attached call.

| Method and path | Body | Status |
|---|---|---|
| GET `/v1/triage/flag-types` | `cursor`, `limit` | 200, `type`, `description`, `usage_count` |
| GET `/v1/triage/issues/<id>/flags` | `cursor`, `limit` | 200 |
| POST `/v1/triage/issues/<id>/flags` | see below | 201; 409 `call_not_attached`; 409 `conflict` |
| DELETE `/v1/triage/issues/<id>/flags/<flagId>` | | 204 |

```json
{
  "call_id": "<call id>",
  "type": "wrong_transfer",
  "node_id": "<node id>",
  "node_name": "<node name>",
  "message_index": 7,
  "message_text": "<the agent line>",
  "note": "Transferred before confirming the account."
}
```

- `call_id` and `type` are required. The call must already be attached.
- `type` is stored lowercased, with spaces turned into `_`.
- A `type` that matches an existing flag type reuses its description. A new
  type needs `note` (1 to 4000 characters), or the API answers 409
  `New flags require a description`.

## Comments and activity

| Method and path | Body | Status |
|---|---|---|
| POST `/v1/triage/issues/<id>/comments` | `detail` (1 to 4000), optional `resource_link_ids` | 201 |
| GET `/v1/triage/issues/<id>/activity` | `cursor`, `limit` | 200, the timeline |

A `detail` that contains `@norm` (any case) also starts a triage run with the
rest of the text as its prompt. Never send it. See [triage runs](#triage-runs).

## Relations

| Method and path | Body | Status |
|---|---|---|
| GET `/v1/triage/issues/<id>/relations` | `cursor`, `limit` | 200 |
| POST `/v1/triage/issues/<id>/relations` | `related_issue_id`, `relation_type` (`related_to`, `blocks`, `duplicate_of`) | 201 |
| DELETE `/v1/triage/issues/<id>/relations/<relationId>` | | 204 |

The Issues page shows relations read-only. The API is the only way to add or
remove one.

## Categories

| Method and path | Body | Status |
|---|---|---|
| GET `/v1/triage/categories` | `cursor`, `limit` | 200: saved, in use, and built-in names (`Transcription`, `Speech`, `Dialogue`, `Routing`, `Tools`, `Latency`, `Telephony`, `Bug`) |
| POST `/v1/triage/categories` | `name` (1 to 64) | 201; 409 `Category already exists` |

Create a category only when none fits.

## Alert bindings

Links a firing (or resolved) alert to an issue.

| Method and path | Body | Status |
|---|---|---|
| GET `/v1/triage/issues/<id>/alert-bindings` | `cursor`, `limit` | 200 |
| POST `/v1/triage/issues/<id>/alert-bindings` | `active_alert_id`, `alert_config_id` | 201; 404 `Alert not found` |
| DELETE `/v1/triage/issues/<id>/alert-bindings/<bindingId>` | | 204 |

Find the ids first: GET `/v1/alerts?agent_id=<agent id>` lists alert configs
(`id`) with the current `active_alert.id`; GET `/v1/alerts/<config id>/history`
lists past alerts.

## Eval analysis

POST `/v1/triage/issues/<id>/eval-analysis` with `{ "agent_id": "<agent id>" }`
(optional when the issue has an `agent_id`; must be a uuid). It answers 202:

```json
{
  "run_id": "<eval run id>",
  "eval_agent_id": "<judge id>",
  "eval_agent_version_id": "<judge version id>",
  "call_count": 12,
  "reused_judge": false
}
```

What it does, all in one request:

1. Reuses the judge this issue created before, or drafts and saves a new judge
   owned by the agent.
2. Picks the calls: the issue's attached calls when there are two or more,
   otherwise the org's 25 most recent completed calls, from any agent.
3. Starts a billed text eval run over them and comments the run id on the
   issue.

There is no estimate for this route, and the dashboard shows no approval for
it. Confirm with the call count from step 2 and the fact that it is billed.
Read the run with the [evaluations](../../evaluations/SKILL.md) skill.

## Triage runs

A triage run is an agent that reads the issue and its evidence, then
diagnoses and can draft edits to the agent and change its tool settings. A
prompt that starts with `status` or `verify` is read-only; any other prompt,
including an empty one, can edit. Start one only as its own confirmed action,
never through a comment.

| Method and path | Body | Status |
|---|---|---|
| GET `/v1/triage/agents` | `cursor`, `limit` | 200, the run profiles |
| POST `/v1/triage/issues/<id>/agent-sessions` | none | 201, the session |
| POST `/v1/triage/issues/<id>/agent-sessions/<sessionId>/prompts` | `detail` (1 to 4000) | 202, `session_id`, `run_id`, `intent` |

## Errors

| Status and code | Meaning | Fix |
|---|---|---|
| 400 `bad_request` `Invalid params: <path>: <message>` | Unknown key, bad enum, length | Fix that key only and resend once. |
| 404 `not_found` `Issue not found` | Wrong id, other org, or deleted | Search by `T-n` to get the `id`. |
| 404 `Call not found`, `SMS conversation not found`, `File not found` | Evidence id is not in this org | Recheck the id from the source session. |
| 409 `call_not_attached` | Flag before attach | PUT the call, then flag. |
| 409 `conflict` `New flags require a description` | New flag type without `note` | Add `note`. |
| 409 `conflict` `Alert bindings are not configured` | Alerts are off here | Stop; say so. |
| 400 `AGENT_REQUIRED` | Eval analysis on an issue with no agent | Ask which agent; pass `agent_id`. |
| 400 `AGENT_NOT_FOUND` | That agent is not in this org | Recheck the agent id. |
| 409 `ANALYSIS_ALREADY_RUNNING` | A run from this issue is still live | Report its run id; do not retry. |
| 409 `INVALID_BODY` `No calls to analyze…` | No attached calls and no recent calls | Attach calls first. |
| `oauth_path_not_allowed` | OAuth host | Say the connection cannot reach issues; use the Issues page. |

## Not available here

- File upload: multipart. Use the Issues page.
- Accept, decline and merge an issue: the server has no route.
- Stopping a triage run: the server has no route.
- A capability-gap tracker: no endpoint. File an issue titled
  "Capability gap: <what is missing>".
