# Cohort API contract

Three routes under `/v2/analytics/cohorts`. Every response is the envelope
`{ data, errors }`. An error has `data: null` and
`errors: [{ error, message }]`.

Call them with the first-party API tools: `call_bland_api` with `method`,
`path` and `body` for the POST, and `bland_api_get` for the reads. Do not
script `fetch` and do not search the docs for these routes.

## Create

`POST /v2/analytics/cohorts`

```json
{
  "agent_key": "<agent id from the page>",
  "window": { "start": "2026-09-08T00:00:00Z", "end": "2026-10-08T00:00:00Z" },
  "predicate": {
    "outcomes": ["contained"],
    "where": { "col": "call_length", "op": ">=", "value": 5 }
  }
}
```

- `agent_key` narrows to one agent. Omit it for the whole organisation.
- `window` is required. `start` and `end` are ISO-8601 instants; `end` is
  exclusive.
- `predicate` is optional. An empty or absent predicate means every
  conversation in the window.
- Unknown keys anywhere in the body are refused, so a misspelled filter is a
  400 rather than a silently wider cohort.

Answer: 202 `{ "data": { "id": "<cohort id>", "status": "building" }, "errors": null }`.

### Predicate keys

Every key is optional. Each one narrows the set; set keys combine as AND.

| Key | Value | Selects |
| -- | -- | -- |
| `outcomes` | a non-empty array of the nine outcomes | calls whose outcome is one of them |
| `metric` | `conversations`, `containment`, `abandonment`, `escalation`, `timeToTransfer`, `earlyExit` or `talkTime` | exactly the population that system tile counts, so the list matches the tile |
| `day` | `YYYY-MM-DD`, a real calendar day | that whole UTC day |
| `hour_utc` | an ISO-8601 instant | the one UTC hour the instant falls in |
| `disposition` | `{ key, op, value?, version_id? }` | calls whose disposition value matches ([below](#disposition)) |
| `eligible_for_scoring` | `true` | completed calls with a length above zero that are not simulations |
| `sampling` | a fraction from `0.0001` to `1`, at most 5 decimals | a deterministic sample: the same calls on every build of the same window |
| `where` | a column predicate | see the [grammar](grammar.md) |
| `waypoint` | a string | refused: 400 `COHORT_PREDICATE_UNSUPPORTED` |

Put `day` and `hour_utc` inside the window.

### Disposition

`{ "key": "<value key>", "op": "=", "value": true }`

- `key` is a disposition value key: the field name inside a disposition's
  definition, such as `booking_confirmed`. It is not a disposition id.
- `op` is one of `=`, `!=`, `in`, `is_null`, `is_not_null`. `is_null` and
  `is_not_null` take no `value`; `in` takes a non-empty array.
- The runtime type of `value` picks what is compared: a boolean against
  boolean values, a number against numeric values, a string against enum
  values. Free-text values cannot be compared.
- `version_id` narrows to one published disposition version. Omitted, the
  latest value per call from any version counts.
- The match reads disposition results that have reached the lake. If the
  build fails or returns far fewer calls than the disposition has scored,
  report that plainly. Do not swap in a lookalike `where`.

## Read status

`GET /v2/analytics/cohorts/<id>`

```json
{
  "data": {
    "id": "<cohort id>",
    "status": "ready",
    "size": 1284,
    "predicate": { "outcomes": ["contained"], "where": { "col": "call_length", "op": ">=", "value": 5 } },
    "window": { "start": "2026-09-08T00:00:00Z", "end": "2026-10-08T00:00:00Z" },
    "expires_at": "2026-10-15T00:02:11Z",
    "visible_size": 1284,
    "truncated": false
  },
  "errors": null
}
```

The numbers above are synthetic.

- `status` is `building`, `ready` or `failed`. A row still `building` past the
  build timeout reads as `failed`, so a poll loop always ends.
- `size` is how many calls the lake build materialised.
- `visible_size` is how many of them the Conversations list can show. That
  list shows completed calls only, so a cohort of `not_connected` calls has
  `visible_size: 0`. `null` means not counted yet (still building, failed, or
  the count timed out). It never means zero.
- `truncated` is `true` when `size` reached the 50,000 cap. The cohort holds
  50,000 of the matches, not all of them.
- `expires_at` is 7 days after the cohort became ready. After it, every read
  answers 404.

### Polling

Read after about 2, 4 and 8 seconds, then about every 15 seconds. Stop at
`ready` or `failed`. A light predicate on a 30-day window is usually ready in
seconds. A heavy predicate ([semantics](semantics.md#cost-class)) can take
minutes. Tell the user it is building while you wait; do not start a second
cohort for the same ask.

On `failed`, say so with the predicate and window. Resend once only if the
failure looks transient (the build could not start). Otherwise narrow the
window or drop heavy leaves first.

## Read ids

`GET /v2/analytics/cohorts/<id>/ids?cursor=<cursor>&limit=<n>`

```json
{ "data": { "ids": ["<call id>", "<call id>"], "next_cursor": "1001" }, "errors": null }
```

- `limit` is an integer from 1 to 1000. The default is 1000.
- Pass `next_cursor` back as `cursor` for the next page. `null` means the
  last page. Treat the cursor as opaque.
- The ids are call ids. Read them only when the user asks: to export, to start
  a judge run, or to hand to a disposition test. The judge-run route takes
  `call_ids` ([evaluations API](../../evaluations/references/api.md)).
- 409 `COHORT_NOT_READY` until `status` is `ready`.

## The Conversations page

The page opens a cohort at `/dashboard/conversations?cohort=<id>`. In cohort
mode the page hides its own filters.

- **Connected dashboard session** (Norm running inside the Bland dashboard
  with the page attached): after Norm creates a cohort, the dashboard polls it
  to ready and opens that list by itself. Do not tell the user to reload, and
  do not ask them to paste an id or a link.
- **Standalone session** (Codex or Claude Code with no page attached): nothing
  opens. Give the relative link `/dashboard/conversations?cohort=<id>` and say
  the page was not opened.

### Other deep-link parameters

`/dashboard/conversations` reads these query parameters too. Give a link
built from them when the user wants a filtered list that is not a cohort:
"open the WhatsApp threads", "open this conversation", "show the active
calls". Unknown or invalid values are dropped.

| Parameter | Values | Opens |
| -- | -- | -- |
| `channel` | `phone`, `web_voice`, `web_chat`, `sms`, `rcs`, `imessage`, `whatsapp`, `api_chat` | the list narrowed to one channel |
| `focus` | a call id or a messaging conversation id | that one conversation, with its detail panel open |
| `batchId` | a batch id | the calls of that batch |
| `simulation` | `live` (default), `simulated`, `all` | live calls, simulated calls, or both |
| `tab` | `conversations` (default), `contacts`, `active` | the list, the Contacts tab, or the live calls in progress |
| `sequence` | an automation sequence id | the conversations of that sequence; dropped when `cohort` is set |
| `callFilter` | URL-encoded JSON `{ "filters": [{ "field": "<field>", "operator": "<op>", "value": <v> }], "mode": "AND" }` | the list with the page's call filters applied; ignored when `cohort` is set |

- `cohort` wins: in cohort mode the page ignores `callFilter` and `sequence`.
- `callFilter` uses the page's filter fields and operators (for example
  `status` with `equals`, `call_length` with `gte`). An unreadable value shows
  an error instead of the list, so prefer a cohort for anything a predicate
  can say.

## Window rules

- `end` after `start`.
- At most 92 days between them.
- `start` at most 400 days ago.

## Access and rate

- Creating a cohort needs the organisation role admin, owner or operator.
  With an organisation API key, the role checked is the role of the person
  who created the key.
- Creates are rate limited per organisation. A 429 means wait; do not loop.
- A cohort belongs to the organisation that created it. Another
  organisation's id reads as 404, the same as an expired one.

## Errors

| Status | Code | Meaning and fix |
| -- | -- | -- |
| 400 | `COHORT_PREDICATE_INVALID` | A `where` node was refused. The message is `<node>: <message>`. Fix that node ([grammar](grammar.md#refusals)). |
| 400 | `COHORT_INVALID_REQUEST` | Any other shape error: the window rules, an unknown key, a bad `outcomes`, `day`, `hour_utc`, `metric`, `disposition` or `sampling` value, or a bad `limit` on the ids route. The message names the path. |
| 400 | `COHORT_PREDICATE_UNSUPPORTED` | `waypoint` was sent. Remove it and hand the journey question to the Sankey. |
| 403 | `UNAUTHORIZED` | The session's role cannot create cohorts (admin, owner or operator can). Say so; do not retry. |
| 404 | `COHORT_EXPIRED` | Unknown id, another organisation's id, or past `expires_at`. Build a new cohort if the user still needs it. |
| 409 | `COHORT_NOT_READY` | Ids were read before `ready`. Keep polling status. |
| 429 | `TOO_MANY_REQUESTS` | More than 20 creates in 60 s for this caller. Wait a minute before one more attempt. |
| 503 | `COHORT_START_FAILED` | The build could not start. The cohort row is marked `failed`. One later resend is reasonable. |

## Attached target

A dashboard turn can begin with one preface line, written by the page, for
example:

```text
Attached target: cohort "Contained, Oct 3" id=<cohort id> context={"request":{"agent_key":"<agent id>","window":{"start":"…","end":"…"},"predicate":{"outcomes":["contained"],"day":"2026-10-03"}}}
```

- `cohort`: `context.request` is the request that built the selection the
  user is looking at. Build the new cohort from that request plus the user's
  extra condition as `predicate.where`; never widen the window or drop a key
  the request had.
- `metric`: a headline tile; see [metrics](metrics.md#attached-target).
- `pathway` and `stage` targets belong to the Sankey skill
  (analytics-authoring).
