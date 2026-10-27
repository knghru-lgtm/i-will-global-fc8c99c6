# Waypoint definition API contract

All routes live under `/v2/analytics/agents/<agentKey>/pathway` and require an
enterprise organisation. `<agentKey>` is the agent id; the literal `org` is
refused (400 `ORG_SANKEY_UNSUPPORTED`). An agent that is not the caller's is a
404, never a hint that it exists elsewhere. Every response is the envelope
`{ data, errors }`; an error has `data: null` and `errors: [{ error, message }]`.

Call them with the first-party API tools: `bland_api_get` for reads and
`call_bland_api` with `method` and `path` for writes. Do not script `fetch`.

## Read the definition

`GET …/pathway/definition`

```json
{
  "data": {
    "production_version_id": "<version uuid>",
    "fingerprint": "<64 hex>",
    "members": [
      { "id": "agent", "label": "Inbound hub", "kind": "synthetic" },
      { "id": "<node uuid>", "label": "Identify caller", "kind": "node" },
      { "id": "tool:lookup_account", "label": "lookup_account", "kind": "tool" }
    ],
    "published": { "definition_id": "…", "status": "published", "fingerprint": "…", "author": "…", "created_at": "…", "definition": { "groups": [] } },
    "pending": null
  },
  "errors": null
}
```

- `members` is exactly the set a definition may name; synthetics that are never
  stored are already excluded.
- 409 `NO_PRODUCTION_VERSION` when the agent has no production pin. Nothing can
  be written until it does.

## Read the chart

`GET …/pathway?view=simple&layout=stages&window=<7|14|30|90>[&definition=<id>]`

`view` is `simple` (the folded chart both page tabs draw) or `full` (compiled
waypoints with traffic, for node-level analysis); there is no other value.

- `definition=<uuid>` folds through that stored row (a pending draft or a
  published row). It requires `view=simple`. A superseded row or another
  agent's row is 404 `NOT_FOUND`.
- `data.waypoints` describes which definition served and whether it did
  ([concepts](concepts.md)). `data.displayed_version_id` names the version a
  pinned read used.
- `data.versions[0].nodes` and `.links` are the drawn graph; `stage_reach`
  gives the union reach per stage, including parallel siblings.
- Reads over a large window take several seconds; they are read-only.

## Save a pending draft

`PUT …/pathway/definition/pending`

```json
{
  "definition": {
    "groups": [
      { "id": "identify", "label": "Identify the caller", "members": ["agent", "<node>", "tool:lookup_account"], "stage": 1 },
      { "id": "gate", "label": "Gate access", "members": ["<node>", "tool:open_gate"], "stage": 2 },
      { "id": "billing", "label": "Payments and billing", "members": ["<node>", "tool:text_payment_link"], "stage": 2 },
      { "id": "close", "label": "Hand off or close", "members": ["<node>", "<node>"], "stage": 3 }
    ]
  },
  "expected_fingerprint": "<fingerprint from the definition read>"
}
```

- 200 `{ definition_id, status: "pending", fingerprint }`. Overwrites the
  agent's one pending row.
- 400 `BAD_REQUEST` for shape errors (unknown key, non-string id or label,
  id over 128 or label over 512 characters, more than 256 members in a group,
  more than 64 groups at the schema layer). The message names the path.
- 409 `PRODUCTION_VERSION_CHANGED` when `expected_fingerprint` is not the
  production pin's. Read the definition again and resend; nothing was written.
- 413 over 256 KiB; 429 after 30 writes per minute per organisation.
- 422 `INVALID_DEFINITION` with a top-level `violations` array. Nothing was
  written.

## Publish

`POST …/pathway/definition`, same body as the pending save.

- 201 `{ definition_id, status: "published", fingerprint, superseded_definition_id }`.
- Same 400, 409, 413, 422, 429 answers as the pending save. The 409 also covers
  a promotion that moves the pin between your read and the write.
- On success the pending row is deleted; a later `?definition=<pending id>` is
  a 404. Use the published id.

## Validation rules (422 `violations`)

Each violation is `{ rule, id, message }`; `id` is the offending member or
group id, or `#definition` for whole-definition rules.

| Rule | Fix |
| -- | -- |
| `unknown_key` (offline checker only) | A key other than `id`, `label`, `members`, `stage` on a group, or other than `groups` on the definition. The API answers 400, not 422; drop the key. |
| `unknown_member` | The id is not in `members`. Use an id from the read; never a label. |
| `duplicate_member` | The id appears twice. Keep it in one group. |
| `excluded_member` | `__entry__` or `global-prompt`. Remove it. |
| `synthetic_member` | `__start` or `__initialization`. Remove it; it is placed automatically. |
| `no_groups` | Add at least one group. |
| `no_real_members` | Every member is synthetic. Add a node, tool, or `agent`. |
| `too_many_groups` | More than 7. Merge the thinnest. |
| `empty_group` | A group has no members. Fill it or drop it. |
| `missing_group_id` / `duplicate_group_id` / `reserved_group_id` | A group id must be non-blank, unique, and not `__unclassified__`. |
| `missing_label` | A group label must be a non-blank string. |
| `stage_missing` | Some groups have `stage`, this one does not. Set every stage or none. |
| `stage_invalid` | `stage` must be an integer of 1 or more (dense from 1 keeps it at or below the group count). |
| `stage_not_dense` | Stages in use must be 1..N with no gap. Renumber. |

Loop: read the violations, fix exactly the named ids, resend the same route.
The offline checker `scripts/validate-definition.cjs` applies these rules to a
definition and a saved `members` list so most loops never reach the API.

## Preview

There is no preview route. Preview is: PUT the pending draft, then
`GET …/pathway?view=simple&layout=stages&definition=<pending id>`. Publish only
after the user has seen what they asked for when the change is large or the
request was ambiguous.

## Attached target

A dashboard turn can begin with one preface line, written by the page, for
example:

```text
Attached target: pathway "Conversation Flow, Simplified" id=<agent id> context={"window":30,"view":"simple"}
```

- `pathway`: the agent id, the page's window and the view the user is looking
  at. Use them; skip the page read.
- `stage`: one group of the published definition (`id` is the group id,
  `context` carries the agent id and window). Keep unrelated groups unchanged.
  For a requested move or merge, make only the related membership changes and
  renumbering needed to keep members unique and stages dense from 1.
