# Knowledge source API

Base: `/v1/knowledge`. Reads go through `bland_api_get` (query values are
strings), writes through `call_bland_api` with `{method, path, body}`.
Responses use the `{data, errors}` envelope; an error row carries `error`
and `message`. Every route is scoped to the caller's organization. Confirm
every write marked **C** or **C!** with the user, per the skill's confirm
list. How sources, lookups and Questions behave end to end is in
[how it works](how-it-works.md).

Confirm column: **R** read. **T** writes telemetry; tell the user.
**C** confirm, naming the object. **C!** confirm after the pre-delete scan.

## Contents

- [Sources](#sources)
- [Upload a file by link](#upload-a-file-by-link)
- [Content, versions and sync](#content-versions-and-sync)
- [Update by type](#update-by-type)
- [Retrieval tests](#retrieval-tests)
- [Questions](#questions)
- [Query logs](#query-logs)
- [Knowledge map](#knowledge-map)
- [Pre-delete scan](#pre-delete-scan)
- [Errors and fixes](#errors-and-fixes)
- [Not this skill](#not-this-skill)

## Sources

| Method and path | Body or query | Returns, limits | Confirm |
|---|---|---|---|
| `GET /sources` | `search` (name fragment, at most 200 chars), `type` csv of `PDF,CSV,JSON,DOCX,XLSX,WEB,TEXT,INTEGRATION`, `status` csv of `ACTIVE,STALE,FAILED,PROCESSING`, `sort` (`name_asc`, `updated_desc`, `gaps_desc`, `coverage_asc`, and their opposites), `cursor`, `take` | `{sources[], total_filtered, total_unfiltered, total_queries_30d, pagination.nextCursor}`. Each row has `id, name, type, status, chunk_count, query_count, gap_count, coverage_pct, agent_count, node_count, persona_count, sync_enabled`. A cursor with a different explicit `sort` is a 400; drop the cursor. STALE means a `COMPLETED` source with auto-sync on whose last sync is more than 7 days old; ACTIVE is any other `COMPLETED` source. | R |
| `GET /sources/picker` | none | Light id and name list. | R |
| `GET /:id` | none | Detail: `status` (`PROCESSING`, `COMPLETED`, `FAILED`), `type` (`FILE`, `WEB_SCRAPE`, `TEXT`, `INTEGRATION`), `error_message`, `processing` progress while converting, `current_version`, `source_urls`, 30-day `query_count_30d`, `gap_count_30d`, `coverage_pct_30d`, and `kb_item_scopes` (see the scan). 404 `KB not found` for another org's or a deleted id. | R |
| `POST /crawl` | `{url, limit}`; `limit` 1 to 2000, default 100 | Sitemap discovery only. Persists nothing. | R |
| `POST /learn` text | `{"type": "text", name, text, description?}`; `text` at most 1 MB | `{knowledge_base_id, version_id}`. Async: poll `GET /:id`. | C |
| `POST /learn` web | `{"type": "web", name, urls[], description?}`; at most 100 URLs (2000 on enterprise), all on one domain | Same. Scrapes the listed pages. | C |
| `POST /learn` file | multipart `file` | Not reachable through `call_bland_api`. A file at an https link goes through [`upload_knowledge_file`](#upload-a-file-by-link); a file only on the user's machine goes through the dashboard's Add source. | n/a |
| `POST /learn` integration | `{"type": "integration_file", integrationType, resourceId, itemId, name}` | Needs a connected Notion or Google Docs resource and its item id. Use the dashboard's Add source, Integration tab. | n/a |
| `PUT /:id` | `{name?, description?}` | Rename or re-describe. On an agent-wide source the name and description are what the agent sees when it decides to look something up. | C |
| `DELETE /:id` | none | Soft delete; the source disappears from lists and there is no undo route. Agent versions keep listing the id: remove it from them first (see the scan). | C! |

Text source:

```json
{
  "method": "POST",
  "path": "/v1/knowledge/learn",
  "body": {
    "type": "text",
    "name": "<Returns policy FAQ>",
    "description": "<Answers questions about returns, refunds and exchanges>",
    "text": "<Q: How long do I have to return an item?\nA: 30 days from delivery.>"
  }
}
```

Web source, after `POST /crawl` with `{"url": "<https://example.com>", "limit": 50}`:

```json
{
  "method": "POST",
  "path": "/v1/knowledge/learn",
  "body": {
    "type": "web",
    "name": "<Help center>",
    "urls": ["<https://example.com/help/returns>", "<https://example.com/help/shipping>"]
  }
}
```

Polling: read `GET /:id` a few seconds apart at first, then about every 15
seconds. Stop at `COMPLETED` or `FAILED`. Large files and many URLs take
minutes.

## Upload a file by link

`upload_knowledge_file` is a dedicated tool, not a route for `call_bland_api`.
It fetches a file from a public https link on the server and ingests it as a
**new** source, with the same rules as the dashboard's Add source.

| Input | Rule |
|---|---|
| `url` | https only. The server fetches it; a link that needs a sign-in fails. |
| `name`, `description` | Optional. Name and describe the source by what it answers. |
| `csv_columns` | Optional, for a CSV: the columns to index. |

- File types: pdf, docx, xlsx, txt, md, csv, json, checked from the file's
  content as well as its name. At most 20 MB.
- Returns `{id, name, status}`. Poll `GET /v1/knowledge/<id>` until
  `COMPLETED` or `FAILED`, exactly as after `learn`.
- One upload per org every 10 seconds: `kb_upload_rate_limited`; wait and
  retry once. The plan's source cap: `kb_upload_limit_exceeded`; report it.
- `kb_url_blocked`: the link points somewhere the server will not fetch
  (private or internal address). `kb_fetch_failed`: unreachable or a non-2xx
  answer, often a link that needs a sign-in. Ask for a public link or use
  Add source; do not retry either.
- `kb_file_type_not_allowed`, `kb_file_too_large`, `kb_file_empty`: the file
  breaks the rules above. `kb_upload_failed`: ingestion refused it; show the
  message.
- The file name comes from the link's download name, else the last path
  segment. Pass `name` when that would read badly.
- On a timeout the source may still have been created. List sources
  (`GET /sources?search=<name>`) before retrying.
- If `upload_knowledge_file` is not in your tool list, this server does not
  have it yet. Use the dashboard's Add source.
- A file only on the user's machine never reaches you. Ask them to add it on
  Sources, Add source, then find it with `GET /sources?search=<name>` and
  continue from the poll.

## Content, versions and sync

Every write here starts a new version and a re-index. While a source is
indexing, the next one is refused with 409 `Source is still indexing. Wait
until it completes.` Sources have no dev and production split: once the new
version reads `COMPLETED`, every agent that lists the source retrieves from it.

| Method and path | Body or query | Returns, limits | Confirm |
|---|---|---|---|
| `GET /:id/content` | `version_id?` | `content_url` (and `source_url` for PDF, DOCX, JSON) are presigned links, not the text. A web source returns `source_urls` instead. Opening a link needs a host web fetch; the API tools cannot. While converting, both links are null and `processing` is set. | R |
| `POST /:id/content` | `{content}`, at most 10 MB | Replaces the **whole** document: the text of a TEXT source, the CSV or TXT text of a file, or the converted Markdown of a PDF, DOCX or JSON file. For web sources use `replace_urls`. | C |
| `POST /:id/replace_urls` | `{urls[]}`, same caps as learn | Re-scrapes a `WEB_SCRAPE` source with the new list. | C |
| `POST /:id/replace` | multipart `file`, same extension | Dashboard only (the source page's Replace). Keeps the id. | n/a |
| `POST /:id/reindex` | none | Re-indexes the current file, applying the current retrieval settings. `FILE` sources only. | C |
| `GET /:id/versions` | none | Version list. | R |
| `GET /:id/versions/:versionId` | none | One version. | R |
| `POST /:id/versions/:versionId/restore` | none | Makes an old version current and re-indexes it. | C |
| `POST /:id/sync` | `{"manual_sync": true}` or `{"action": "enable"}` or `{"action": "disable"}` | Re-sync now, or turn scheduled re-sync on or off (the dashboard describes the schedule as daily). `WEB_SCRAPE` and `INTEGRATION` only; other types answer 400. A manual re-sync while the source is processing is a 409. | C |
| `GET /:id/download` | none | Original bytes. One download per org per 5 seconds (429). | R |

## Update by type

Read `GET /:id` first: `type`, `status` (a write while indexing is a 409) and
`kb_item_scopes` for the confirm. Every write below is live for every agent
that lists the source as soon as it reads `COMPLETED`. Undo with
`POST /:id/versions/:versionId/restore` from `GET /:id/versions`.

| Type | Change | How |
|---|---|---|
| `TEXT` | New or corrected text | `GET /:id/content`, open `content_url` with a host web fetch if one exists, otherwise ask the user for the current text. Build the **whole** new document, show the diff, confirm, `POST /:id/content {content}`. |
| `WEB_SCRAPE` | Different pages | `POST /crawl` to agree the list, confirm, `POST /:id/replace_urls {urls}`. |
| `WEB_SCRAPE` | Same pages, new content | Confirm, `POST /:id/sync {"manual_sync": true}`. |
| `FILE` (csv, txt, or converted pdf, docx, json) | Corrected text | As for `TEXT`: the content route replaces the CSV or TXT text or the converted Markdown. |
| `FILE` | Re-index the same file | Confirm, `POST /:id/reindex`. |
| `FILE` | A new version of the file | Keep the id: the user uses Replace on the source page (multipart, same extension). Or, from an https link, `upload_knowledge_file` creates a **new** source: then swap the old id for the new one in every consumer's `kbIds` (version saves, then promote) and delete the old one only after the [pre-delete scan](#pre-delete-scan). Prefer Replace when many agents use the source. |
| `INTEGRATION` | Pull the latest from the connected document | Confirm, `POST /:id/sync {"manual_sync": true}`. |

After the write, poll to `COMPLETED`, then re-test one changed fact per
[verification](verification.md#verify-after-ingest).

## Retrieval tests

Both routes are refused over OAuth with `oauth_path_not_allowed`. Both write a
Query Logs row. See [verification](verification.md) for what to use instead
and how to judge the result.

| Method and path | Body | Returns | Confirm |
|---|---|---|---|
| `POST /answer` | `{query, knowledge_base_id \| knowledge_base_ids[], top_k?, alpha?, disable_cache?, skip_gap_evaluation?}` | `{results[{text, score, content_type}], formatted_context, generatedQuery}`. Raw retrieval, no synthesis. Logs a row with source `API`. A background gap check may add a Questions entry unless `skip_gap_evaluation` is true. A FAILED source answers nothing; null data means no query was run. | T |
| `POST /chat` | `{query \| messages[], knowledge_base_id(s), top_k?, alpha?, source?}` | `{result, chunks[], generated_query, gap_evaluation{is_knowledge_gap, gap_id}}`. Synthesizes an answer and always runs the gap check, so a miss opens a Questions entry. `source: "playground"` logs it as Playground instead of API. | T |

Low-side-effect check:

```json
{
  "method": "POST",
  "path": "/v1/knowledge/answer",
  "body": {
    "query": "<How long do I have to return an item?>",
    "knowledge_base_id": "<source id>",
    "top_k": 5,
    "disable_cache": true,
    "skip_gap_evaluation": true
  }
}
```

Do not pass `call_id` or `agent_id`: they attribute the test to a real call
or agent in Query Logs.

## Questions

A question (a knowledge gap) is something a caller asked that the attached
sources could not answer. Paths are under `/v1/knowledge/gaps`.

| Method and path | Body or query | Returns, rules | Confirm |
|---|---|---|---|
| `GET /gaps` | `status` csv of `OPEN,RESOLVED,DISMISSED`; `kb_id` or `kb_ids` csv; `page`; `limit` (at most 100); `sort_by` (`occurrences_desc`, `occurrences_asc`, `created_at_desc` default, `created_at_asc`) | `{gaps[], total, page, limit, has_more}`. Each gap has `id, question, search_query, kb_ids, kbs[{id, name}], occurrences[{call_id, conversation_id, timestamp}], status, answer?, linked_gaps_count?`. An unknown `kb_id` is a 404. | R |
| `GET /gaps/counts` | `kb_id?` | Per-status counts. | R |
| `GET /gaps/:id` | none | One gap. | R |
| `POST /gaps/:id/resolve` | `{answer, target_kb_id}` | Writes the question and answer into the target source and marks the gap RESOLVED. `answer` at least 10 characters. `target_kb_id` must be one of the gap's `kb_ids`. Live for every agent using that source. | C |
| `POST /gaps/:id` | `{question?, answer?}` | Edits a RESOLVED gap's answer. | C |
| `POST /gaps/:id/duplicate` | `{target_gap_id}` | Copies a RESOLVED gap's answer onto an OPEN gap. They must share a source. | C |
| `POST /gaps/:id/sync` | none | Pushes a RESOLVED gap's answer to its linked gaps. | C |
| `POST /gaps/:id/dismiss` | none | OPEN to DISMISSED. Reversible with `/reopen`. | R |
| `POST /gaps/:id/reopen` | none | DISMISSED to OPEN. | R |
| `DELETE /gaps/:id` | none | Soft delete. A resolved gap's answer stays in the source, and a similar question does not open a new gap afterwards. | C |

```json
{
  "method": "POST",
  "path": "/v1/knowledge/gaps/<gap id>/resolve",
  "body": {
    "answer": "<Returns are accepted for 30 days from delivery with a receipt.>",
    "target_kb_id": "<one of the gap's kb_ids>"
  }
}
```

## Query logs

Every retrieval: calls, tests, the Source testing tab and API use.

| Method and path | Query | Returns | Confirm |
|---|---|---|---|
| `GET /queries` | `start_date`, `end_date` (ISO; the window defaults to the **last 7 days**), `call_id`, `agent_id`, `state` (`ANSWERED`, `QUESTION_OPEN`, `QUESTION_ANSWERED`), `query_source` (`PATHWAY`, `PLAYGROUND`, `API`, `BLANDCODE`, `PERSONA`, `AGENT`), `q` (at most 500 chars), `take` (at most 100), `cursor`, `onlyCount=true` | `{queries[{id, created_at, query_text, state, is_gap, gap_id, query_source, call_id, agent_id, node_id, kb_ids}], pagination.nextCursor}` | R |
| `GET /queries/:id` | `created_at` **required**, copied from the list row | The row plus `results[]` (the chunks retrieved, with `score`) and `gap`. | R |

For a call older than 7 days, set `start_date` and `end_date` around the
call, or the list is empty.

## Knowledge map

The data behind the Knowledge map pages. What each number means and how
the agent page narrows it: [how it works](how-it-works.md#knowledge-map).

| Method and path | Query | Returns | Confirm |
|---|---|---|---|
| `GET /map` | none | `{nodes[], links[], total_queries_30d, gaps_truncated}` for the whole org. There is no source or agent filter: narrow by `kb_id` yourself. 500 `KB_MAP_ERROR` when it cannot be built; retry once. | R |

| Row | Fields |
|---|---|
| Source node | `id` (`source:<kb_id>`), `kind: "source"`, `kb_id`, `name`, `type`, `status` (`PROCESSING`, `COMPLETED`, `FAILED`), and over the last 30 days `query_count`, `gap_count` (misses), `covered_count` (hits), `coverage_pct` (0 to 100, null with no lookups) |
| Question node | `id` (`gap:<gap_id>`), `kind: "gap"`, `gap_id`, `status` (`OPEN`, `RESOLVED`), `question`, `occurrence_count`, `resolved_at` |
| Link | `{source: "source:<kb_id>", target: "gap:<gap_id>", kind: "gap_surfaced_against"}`, one per source the Question was raised against |
| `total_queries_30d` | Lookups in 30 days that searched any source, each counted once |
| `gaps_truncated` | True when more than 5,000 open and resolved Questions exist; open ones, newest first, are kept |

The page hides lines to sources with no lookups and Questions left with no
line; the API returns them all.

## Pre-delete scan

`kb_item_scopes` on `GET /:id` is incomplete for v2. It lists:

- `agents[]` `{agent_id, agent_name, environments, used, query_count_30d}`:
  agents whose current environment version lists the id in
  `knowledge.kbIds`, plus agents that retrieved from it in the last 30 days;
- `personas[]` and `pathway_nodes[]`: v1 consumers.

It does not index a `knowledge` step's `kbIds` or a prompt mention. Scan
those yourself:

1. `bland_api_get` `/v2/agents` with no `limit`. That returns every agent;
   a `limit` caps the list at 500 and the route has no next page. If the
   read fails or the result arrives cut off, stop: the scan is incomplete,
   so do not delete.
2. Per agent, read `/v2/agents/<id>/versions/latest`, then `/environments`
   and each pinned staging or production version by its semver
   ([lifecycle API](../../v2-lifecycle/references/api.md)). Production can
   be older than dev.
3. In each snapshot match the source id in `knowledge.kbIds`, in any
   `knowledge` step's `kbIds` (inside `flow.nodes`, at any depth), and in
   any `mentions[]` row with `kind: "knowledge"`. A `{{variable}}` in `kbIds`
   cannot be resolved here; list it as "may use".
4. Report every agent, environment and node by name, plus the v1 personas
   and pathway nodes, plus the 30-day query counts.
5. Delete only when every read above succeeded. If one failed, name the
   agent or version you could not read and stop.

## Errors and fixes

| Status and message | Fix |
|---|---|
| 423 `KB_UPLOAD_RATE_LIMITED`, or `kb_upload_rate_limited` from `upload_knowledge_file` | Another upload is running. Wait about 10 seconds, retry once. |
| 400 `KB_UPLOAD_LIMIT_EXCEEDED`, or `kb_upload_limit_exceeded` | The plan's source cap. Report it; extend an existing source or delete one with the user's consent. |
| 400 `All URLs must be from the same domain: …` | Split into one source per domain. |
| 400 `Maximum 100 URLs allowed per KB` | Trim the list or split it. |
| 400 `text content is too large (max 1MB)` | Split into several text sources. |
| 409 `Source is still indexing. Wait until it completes.` | Poll `GET /:id` until COMPLETED or FAILED, then write once. |
| 409 `Knowledge base is currently processing. Please wait before syncing.` | Same: poll, then re-sync once. |
| 400 `Answer must be at least 10 characters` | Write a full answer. |
| 400 `Target KB must be one of the KBs that were queried when this gap was created` | Pick `target_kb_id` from the gap's `kb_ids`. |
| 400 `Gap is already resolved` | Edit it with `POST /gaps/:id` instead. |
| 400 `Can only link OPEN gaps…`, `Target gap must be RESOLVED` | Resolve the representative first, then link the open ones. |
| 400 `created_at query param is required…` | Copy `created_at` from the list row. |
| `oauth_path_not_allowed` | The connection cannot run that route. See [verification](verification.md). Stop; do not route around it. |

## Not this skill

- `/v1/knowledgebases` is a legacy adapter, `/v1/notes` holds call notes,
  and `/v1/memory/*` is contact memory. See
  [agent memory](how-it-works.md#agent-memory) and the
  [memory routes](../../v2-lifecycle/references/api.md#memory-records).
- `POST /v1/knowledge/:id/improve`, `/anchor-suggestions`, `/feedback` and
  `/migrate/*` are not part of these workflows.
