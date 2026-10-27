# Read conversations: calls, texts and chats

A conversation is one of three objects. Each has its own list route and its own
id space. This page is the read side only. Sending a text, taking over a thread
or publishing a widget belongs to the agent-channels skill, not here.

Do not write fetch scripts and do not search the docs for these routes.

## Contents

- [Pick the route](#pick-the-route)
- [Keep the id spaces apart](#keep-the-id-spaces-apart)
- [Calls for one v2 agent](#calls-for-one-v2-agent)
- [Messaging threads](#messaging-threads)
- [Web chat threads](#web-chat-threads)
- [Server export instead of paging](#server-export-instead-of-paging)
- [Connection limits](#connection-limits)

## Pick the route

| Question | Route | How it scopes to one agent |
|---|---|---|
| Calls of one v2 agent | `GET /user/logs` | `agent_id` filter |
| Calls org-wide by number, batch, date, outcome | `GET /v1/calls` ([retrieval](retrieval.md)) | It cannot. It has no agent filter |
| SMS, iMessage, WhatsApp, RCS and API chat threads | `GET /v1/sms/conversations` | `curr_pathway_id` = the agent's twin pathway |
| One messaging thread with its messages | `GET /v1/sms/conversations/<id>` | n/a |
| One API chat with its transcript | `GET /v1/chat/<id>` | n/a |
| Web chat threads of one agent | `GET /v1/widget/threads?agent_id=<agent id>` | `agent_id` |
| One web chat transcript | `GET /v1/widget/threads/<thread id>/messages` | n/a |
| A large file of calls or texts | `POST /exports/calls`, `POST /exports/sms` | the same filters |

Read all of them with `bland_api_get`. Query values are strings.

## Keep the id spaces apart

| Object | Id | Routes that accept it |
|---|---|---|
| Voice call | call id | `/v1/calls/<id>`, `/user/logs/<id>`, tool logs, knowledge queries, `/v1/calls/metrics` |
| Messaging thread (incl. API chat) | conversation id | `/v1/sms/conversations/<id>`, `/v1/chat/<id>` for API chat |
| Web chat thread | thread id | `/v1/widget/threads/<id>/messages` |

- Never pass a thread id to a call route. A 404 there means the wrong id
  space, not missing data.
- Record the object kind next to every id in your cohort file
  (`{"kind":"call","id":"<id>"}`). Join by kind and id, never by id alone.
- Counts per channel are separate. Do not add calls and threads into one
  "conversations" total unless the user asked for that sum and you say so.

## Calls for one v2 agent

`/v1/calls` cannot select a v2 agent's calls. `/user/logs` can: the dashboard's
Conversations page reads it. The agent filter is a JSON filter, not a plain
query key.

```json
{
  "path": "/user/logs",
  "query": {
    "take": "100",
    "scopeFilters": "{\"field\":\"agent_id\",\"operator\":\"equals\",\"value\":\"<agent id>\"}",
    "filters": "{\"field\":\"created_at\",\"operator\":\"gte\",\"value\":\"2026-01-01T00:00:00Z\"}"
  }
}
```

- Each `filters` or `scopeFilters` value is one filter object. The `query`
  object holds one value per key, so put the agent in `scopeFilters` (always
  ANDed) and one more condition in `filters`. Narrow further in code over the
  saved pages.
- `take` is at most 100. The answer is `data.calls` and
  `data.pagination.nextCursor`. Pass `cursor=<nextCursor>` for the next page.
  A short page ends the walk even when a cursor came back.
- Default order is insertion order. `sortBy` accepts `call_length` or
  `updated_at`; `sortDir` is `asc` or `desc`.
- `totalCount` comes on the first page only and may be absent on large orgs.
- `cohort=<cohort id>` reads a saved cohort's calls. It cannot be combined
  with `filters` or `scopeFilters`.
- Read one call with `GET /user/logs/<call id>` or `GET /v1/calls/<call id>`.

## Messaging threads

`GET /v1/sms/conversations` lists SMS, iMessage, WhatsApp, RCS and API chat
threads in one table.

Step 1: find the agent's twin pathway. `GET /v2/agents/<agent id>/inbound`
returns `pathway_id`. The messaging runtime stamps that id on each thread as
`curr_pathway_id`. A null `pathway_id` means the agent has no twin yet, so no
thread can belong to it. Report "no threads" and say why.

Step 2: list. `filters` is a JSON array in one string. `mode` is `AND`
(default) or `OR` and applies to the whole array.

```json
{
  "path": "/v1/sms/conversations",
  "query": {
    "filters": "[{\"field\":\"curr_pathway_id\",\"operator\":\"equals\",\"value\":\"<twin pathway id>\"},{\"field\":\"channel\",\"operator\":\"equals\",\"value\":\"WHATSAPP\"},{\"field\":\"created_at\",\"operator\":\"gte\",\"value\":\"2026-01-01T00:00:00Z\"}]",
    "limit": "200",
    "from": "0",
    "sort_by": "last_message_at",
    "ascending": "false"
  }
}
```

Channel mapping. Two fields name a channel:

| The user means | Filter |
|---|---|
| iMessage | `channel` equals `IMESSAGE` |
| WhatsApp | `channel` equals `WHATSAPP` |
| SMS | `channel` equals `SMS` and `effective_channel` not `api_chat` |
| RCS | `effective_channel` equals `rcs` |
| API chat | `effective_channel` equals `api_chat` |

- `channel` is the requested channel. An RCS thread opens as `SMS`, and an API
  chat is stored as `SMS`, so `channel=SMS` alone over-counts.
- Several agents: `curr_pathway_id` with operator `in` and a JSON array of
  twin pathway ids.
- Dates: filter `created_at` or `last_message_at` with `gte`, `gt`, `lt`,
  `lte`. Top-level `start_date` and `end_date` do not narrow this list.
- Paging is by offset: `limit` (at most 1000) and `from`. Advance `from` by
  the raw rows returned. Page totals sit beside `data` under `pagination`.
- `sort_by`: `created_at`, `updated_at`, `last_message_at`, `message_count`.
- Do not send `mode: "OR"` together with the agent or channel filter. OR
  widens past the scope. Run separate AND queries and union in code.
- A row carries `channel`, `effective_channel`, `message_count`,
  `last_message`, `summary`, `disposition_tag`, `human_handoff_at` and
  `contact_id`. Read the full thread with `GET /v1/sms/conversations/<id>`.

## Web chat threads

```json
{"path":"/v1/widget/threads","query":{"agent_id":"<agent id>","limit":"100","sort_by":"created_at","sort_dir":"desc"}}
```

- Covers every widget bound to the agent. `limit` is at most 100 (default 25).
- The answer is `data.threads` and `data.next_cursor`. Pass
  `cursor=<next_cursor>` until it is null.
- `sort_by` is `created_at` or `last_message_at`.
- Transcript: `GET /v1/widget/threads/<thread id>/messages`, newest page
  first. Pass `before=<next_before>` for older messages until it is null.

## Server export instead of paging

For thousands of rows with the same filters, the server can build the file.

- `POST /exports/calls` or `POST /exports/sms` with `filters` (an array of
  filter objects), `mode`, `file_type` (`csv` or `json`), `excludedColumns`,
  `email`.
- It returns `export_id` and emails a download link to `email`, or to the
  account's email when `email` is omitted. It does not return the file to
  you. Poll `GET /exports/calls/<export_id>/status` for call exports.
- 20 exports per hour, shared between calls and texts. An org API key may
  export only when its creator is an owner, admin or operator.
- It sends an email, so confirm once: "About to export the <calls|texts>
  matching <filters> as <csv|json>. A link goes to <email>. Reply yes to
  proceed."
- Choose self-paging when you must analyze rows in this workspace. Choose the
  export when the user wants a file.

## Connection limits

An OAuth-connected host cannot reach `/user/logs`, `/v1/sms/**`,
`/v1/widget/**` or `/exports/**`. On `oauth_path_not_allowed` say "this
connection cannot reach <route family>; open it on /dashboard/conversations"
and stop. `GET /v1/calls/**` stays reachable, but it cannot scope to a v2
agent, so say that too.
