# Retrieve a reproducible call cohort

## Contents

- [API surfaces](#api-surfaces)
- ["Most recent 1,000" procedure](#most-recent-1000-procedure)
- [Evidence for one call](#evidence-for-one-call)
- [Evidence and output layout](#evidence-and-output-layout)

## API surfaces

Do not write fetch scripts and do not search the docs for these routes.

- `GET /v1/calls`: list/search calls org-wide. Filters: `start_date`,
  `end_date`, `timezone`, `completed`, `answered_by`, `inbound`, `batch_id`,
  `campaign_id`, `from_number`, `to_number`, `call_id`, `duration_gt`,
  `duration_lt`, `call_ended_by`, `error_message`, `is_simulation`, plus
  paging `from`, `to`, `limit`, `sort_by`, `ascending`. It has **no agent
  filter**: for one v2 agent's calls, texts or web chats use
  [conversations](conversations.md).
- `GET /v1/calls/{call_id}`: full detail, including available transcript,
  variables, request data, and pathway evidence. A list row is not a full trace.
  The path also accepts your own `external_id` (the newest call wins);
  `fields=status,summary,variables` returns a subset; `v=2` returns
  `pathway_logs` in the event-timeline format. `citations_status` says whether
  citations were read fully (`ok`, `incomplete`, `unavailable`).
- `GET /v1/pathway_calls/{call_id}?v=2`: the event timeline: transcript
  turns, node transitions with the routes considered, tool, webhook and
  knowledge events, variable changes. Sort by `sequence`. For agent-driven
  calls the flat transcript can be empty; the dialogue is here.
- `GET /v1/calls/{call_id}/recording`: the recording link, or the audio itself
  with an `Accept: audio/*` header. 404 when the call has no recording.
- `get_call_log`, when advertised, is a convenient curated first read; use the
  generic API for fields the curated schema omits.
- Use the authorized recording reference or documented recording endpoint when
  audio is needed; availability depends on recording and access settings.

For the generic read MCP, query values are strings. Example page:

```json
{
  "path":"/v1/calls",
  "query":{
    "start_date":"2026-01-01T00:00:00Z",
    "end_date":"2026-01-08T00:00:00Z",
    "from":"0",
    "limit":"100",
    "ascending":"false"
  }
}
```

The dates above are synthetic examples, not the user's requested window.
List responses expose `calls` and `total_count`; inspect the actual envelope.
The current offset contract uses `from` as a zero-based offset and `to` as an
exclusive bound; `limit` caps the page at 1000. Prefer a smaller page for rich
records, and do not combine offset paging with an invented cursor field.

## "Most recent 1,000" procedure

1. Capture an absolute UTC cutoff before fetching. Specify a lower bound where
   useful, and retain the exact filter set and sort request in a manifest.
2. Fetch modest pages through the API and save each complete response. Increase
   the offset by the **raw returned count**, not the number of new unique IDs.
3. Deduplicate by stable call ID; detect repeated pages/no progress. Stop at
   exhaustion, the bounded candidate limit, cancellation, or a recorded error.
4. Verify returned timestamps/order. Do not assume the displayed order or a
   `sort_by` label proves exact creation-time ranking. If needed, retrieve the
   bounded candidate window and sort locally by creation time with an ID tie
   breaker before selecting 1,000.
5. Offset lists are not transaction snapshots. New/deleted/updated records can
   move while paging. Use the cutoff, reconcile duplicates and gaps, and report
   the coverage limit if exact top-N cannot be established from the API.
6. Save the selected IDs as the cohort. Fetch full details only where required,
   with bounded concurrency and rate-limit backoff. Preserve a failure ledger.
7. On resume, reuse the cohort IDs and successful files; retry only known failed
   reads. Do not silently replace missing records with different calls.

A short page/empty result is useful evidence only when the response is valid
and complete. A 403, timeout, truncated payload, or unsupported filter does not
mean there are no calls. `total_count` alone does not establish complete coverage.

## Evidence for one call

After you pick a call, these reads explain what happened inside it. Each takes
the call id. Budget: one read per source you need, not all of them.

| Question | Read | What it tells you |
|---|---|---|
| Did a tool run, and how did it fail? | `GET /v2/tools/logs?call_id=<call id>` | One row per integration-tool run: `tool_id`, `integration`, `action`, `status` (`success` or `error`), `error_type`, `error_message`, `execution_time_ms` |
| Which tools fail most? | `GET /v2/tools/logs/stats?group_by=tool_id,error_type&status=error&period=week` | Counts per tool and error type. `period` is `today`, `week` or `month`, or pass `start_date` and `end_date` |
| What did the agent retrieve? | `GET /v1/knowledge/queries?call_id=<call id>` | The query text, state and source of each retrieval |
| Which chunks came back? | `GET /v1/knowledge/queries/<query id>?created_at=<row created_at>` | Retrieved chunks. `created_at` from the list row is required |
| What did memory change? | `GET /v1/memory/changes?call_id=<call id>` | Memory writes made by the call |
| What happened on the SIP leg? | `GET /v1/sip/calls/<call id>/ladder` | The SIP message flow. `configured: false` means tracing is absent on this platform, not that the call had no SIP |
| Which calls touched this number? | `GET /v1/sip/numbers/<number>/calls?limit=100` | Calls in both directions, at most 500 |
| How did the platform score it? | `GET /v1/calls/metrics?call_id=<call id>` | `final_call_score`, `average_response_time`, `response_time_score`, `transcription_score`, `silences_score`, `interruptions`, `audio_overlap_seconds`, `objective_met` |

Tool failures come in two kinds. Tell them apart before you blame the
integration:

- **Definition demoted.** The call's tool result shows "HTTP 0" or "Invalid
  URL format", and the tool log has no row for that tool on this call. The
  stored definition failed the runtime schema check, so the call fell back
  to the plain HTTP path, which has no URL. The fix is the tool definition.
- **Upstream or integration error.** The tool log has a row with
  `status: "error"` and an `error_type`. The definition ran; the service
  behind it failed or refused. Read `error_message` before changing anything.

Other notes:

- An outbound SIP call that never crossed the SIP edge gets a short
  synthesized ladder (dispatch and outcome) instead of captured messages.
- `/v1/calls/metrics` answers 400 `CALL_NOT_COMPLETED` for a live call and
  404 `METRICS_NOT_FOUND` when no scores were computed. Neither means the
  call is missing; 404 `CALL_NOT_FOUND` does.
- When each piece of evidence appears, and why a fresh call can lack some, is
  in [how it works](how-it-works.md).
- An OAuth-connected host cannot read `/v2/tools/**` or `/v1/sip/**`. On
  `oauth_path_not_allowed` name the route family and the dashboard page
  (tool logs: `/dashboard/tools/analytics`; SIP: `/dashboard/sip-trunks`) and stop.

## Evidence and output layout

Suggested task-local layout (not a special API or required platform directory):

- `manifest.json`: filters, cutoff, retrieval time, requested/fetched/unique/
  selected counts, API operation description, and known coverage limitations.
- `pages/`: raw authorized pages; retain locally, not in public reports.
- `calls/`: detail records only for selected IDs requiring them.
- `failures.jsonl`: call ID, safe error category, attempt count; no credentials.
- `cohort.json`: stable selected IDs, target agent/version when known.

Minimize personal information and retention. Never commit fetched customer
data or copy signed recording URLs into public/shared reports.
