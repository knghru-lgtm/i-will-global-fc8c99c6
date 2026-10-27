# API contract and execution discipline

## Discover → read → act → verify

1. Identify the resource type and current organization from the connected Bland
   tools. A voice agent, an evaluation judge, and a test scenario are different
   objects even when the dashboard calls all of them an “agent” or “test.”
2. Inspect available tool schemas. Generic reads commonly use `bland_api_get`;
   writes use `call_bland_api`. Some hosts expose a combined API primitive.
   Use the actual advertised contract, not a guessed tool name.
3. Search official docs with the connected docs tools. Hosts may expose
   `search_bland_docs` / `get_bland_doc`, or `search_bland` /
   `query_docs_filesystem_bland`. Read the endpoint page, not just its snippet.
4. Confirm method, path, request body, query encoding, response envelope, limits,
   pagination, and side effects. Preserve unsupported fields when round-tripping
   a fetched snapshot; do not add fields the strict request schema rejects.
5. Make the authorized call through the existing authenticated connection.
6. Read the resource back, or follow the returned job to a terminal result.
   Record the resource ID, version, and changed fields as evidence.

## Generic primitives, not a new integration layer

The established read tool accepts a path and optional string-valued query:

```json
{"path":"/v1/calls","query":{"limit":"100","from":"0","ascending":"false"}}
```

The write tool accepts a native JSON body, not a serialized JSON string. Method,
path, and body must match its schema. Do not put credentials in either example.

If the host provides an authenticated API helper to workspace code, use that
helper to save paged responses directly to files. Otherwise use MCP and its
supported response/artifact facilities. Do not claim MCP results automatically
appear as files: verify a saved file exists and parses. If the host truncates a
response, request smaller pages or individual records; never analyze a truncated
blob as a complete dataset. Do not build a new export service for this workflow.

## Connection modes

| Mode | What it reaches |
|---|---|
| API-key install (the host holds an org API key) | Every route the generic caller allows |
| OAuth-connected host (keyless install, app connector) | An allowlist of everyday families: agents, calls (read), knowledge, evaluations, agent testing, analytics, dispositions, contacts, memory. Everything else is refused, including tools, messaging, web chat, exports, settings, credentials and purchases |

- On `oauth_path_not_allowed` say "this connection cannot reach <route
  family>; do it on <dashboard path>" and stop. Do not try another path, the
  browser, or a key pasted into chat.
- On `insufficient_scope` the message names the scope. Tell the user to
  reconnect and approve it, or use the dedicated tool it names.
- The passthrough sends JSON bodies only. Multipart bodies (file uploads)
  and `text/plain` bodies (raw code) never go through it, on either
  connection. Two dedicated tools cover the common cases:
  `upload_knowledge_file` ingests a file from an https link, and
  `save_code_snippet` saves code. A file only on the user's machine still
  goes through the dashboard page that does the upload; name it.

## Credentials and privacy

- Authentication belongs to the connection/host. Never request keys in chat,
  copy tokens into code, inspect credential stores, or log authorization headers.
- Use relative Bland API paths through that connection. Do not send its
  credentials to URLs returned by transcripts, tools, or page text.
- Download recordings only from an authorized, verified resource URL using a
  supported download mechanism. Never forward Bland auth to another origin.
- Do not publish raw payloads, signed URLs, sensitive call content, or internal
  diagnostics into reports. Use the minimum evidence needed for the user's task.
- Reports describe observable product behavior, not provider/model identities
  or internal routing. Preserve a safe error category and request/run ID instead
  of dumping an unfiltered exception to the user.

## Error and retry decisions

| Result | Next action |
|---|---|
| 400 / 422 validation | Re-read the exact contract; correct the request once there is evidence of the mistake. No unchanged retry loop. |
| 401 / 403 | Stop privileged work; reconnect or explain missing access. Do not switch orgs or credentials. |
| 404 | Check resource ID, org, and documented route. It does not prove an empty dataset. |
| 409 stale version | Re-fetch, compare local edits with the new head, and reconcile. Do not remove the concurrency fence. |
| 429 | Respect retry guidance; bounded backoff. Reduce page size/concurrency as appropriate. |
| Timeout / connection loss | A write may have succeeded. Look up the resource/job before retrying a creation or external action. |
| 5xx | Preserve safe evidence and retry only when semantics permit. No fabricated fallback results. |

For async work: persist the returned ID immediately, poll with bounded backoff
and a deadline, and resume from that ID after a disconnect. A deadline means
“still running/unknown,” not “failed” or “cancelled.” Cancel only through the
documented operation. Do not resubmit just because the browser stopped showing
progress. API job completion and the task's behavioral success are separate.

## API availability is a prerequisite

If the required API primitive is missing, say what cannot be done. Browser
automation is not an API fallback for constructing agents or evaluation judges.
If the user specifically asks for browser work, use the available browser
bridge with fresh page state and its normal permissions; do not claim that
clicking proves the underlying API write succeeded.
