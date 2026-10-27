# Tool library: procedures

Step-by-step detail for the [tool-library skill](../SKILL.md). Routes, the
definition schema and attach modes are the
[tool library contract](../../v2-runtime/references/tool-library.md). Use
`bland_api_get` for reads and `call_bland_api` for writes; do not write fetch
scripts and do not search the docs for these routes.

## Contents

- [Consumer scan](#consumer-scan)
- [Custom code tools](#custom-code-tools)
- [Debug a tool run](#debug-a-tool-run)
- [Delete a tool](#delete-a-tool)

## Consumer scan

No route lists a tool's consumers. Before any shared-tool change or delete:

1. `GET /v2/agents` once, with **no** `limit`: that returns every agent in
   the org in one response. A `limit` cuts the list and the route has no
   pages, so never pass one here. If the read fails or looks cut off, stop
   the write and say which agents could not be read.
2. Per agent read `/v2/agents/<id>/versions/latest`, then
   `/v2/agents/<id>/environments`, then each pinned staging or production
   `current_version.semver` through `/versions/<semver>`. Production can be
   older than dev.
3. In each snapshot match the tool id, with or without `TL-`, on a step tool
   with `byReference: true` or on a `tool` step's `toolId`, at any depth
   inside `flow.nodes`.
4. Report each agent, environment and node by name. Say that embedded copies
   (a step tool with its own `definition`) are not affected by a library
   edit: they run what they saved. A snippet save is different; see
   [custom code tools](#custom-code-tools).

## Custom code tools

A custom-code tool runs a saved snippet: `integration: "custom-code"`,
`action: "run_snippet"`, `body.snippet_id`, and `body.snippet_version` to
pin one version. **An unpinned tool or step runs the snippet's latest
version**, so saving a new version changes every unpinned consumer at once.

The snippet is JavaScript in this shape (synthetic):

```text
export default {
  async fetch(request, env, ctx) {
    const input = await request.json();
    // input.<name> from body.variables, input.connections, input.secrets
    return Response.json({ formatted_date: "<value>" });
  }
}
```

Create and prove:

1. Draft the code. The keys in `body.variables` arrive at the root of
   `input`; map each `input_schema` property as `"<name>": "{{input.<name>}}"`.
2. `save_code_snippet` `{name, language: "js", code}`. Omit `snippet_id` for
   a new snippet. It returns `{snippetId, version, name}`. A name is letters
   and underscores only, at most 100 characters. Every save asks the host to
   confirm, a create included.
3. `call_bland_api` POST `/v2/tools` with the definition
   ([kinds](../../v2-runtime/references/tool-library.md#definition-kinds)):
   `body: {snippet_id, snippet_version: <version>, variables, timeout}` where
   `body.timeout` is seconds (1 to 60).
4. POST `/v2/tools/<id>/run` with synthetic `{"inputs": {…}}`. Read `data`
   and `console`.
5. Attach it in a dev version save, then one test-chat turn that makes the
   agent call it. Test chat runs the saved dev head, so a tool that is not
   attached yet cannot be called there.

Change the code of an existing tool:

1. `bland_api_get` `/v1/snippets/get/<snippet id>` for the current code and
   version. Show the code diff. Over an OAuth connection snippet reads are
   refused (`oauth_path_not_allowed`): ask the user to open the code in the
   builder and paste it, and do not save until you have it.
2. Find every consumer of the snippet. An incomplete scan stops the save.
   - Library tools: follow `GET /v1/tools` by `nextCursor` until `hasMore`
     is false; match `body.snippet_id` in `tool` and in `staging_tool`.
   - Agents: the [consumer scan](#consumer-scan) agent list and versions.
     In each snapshot, at any depth inside `flow.nodes`, match the
     `snippetId` of `customCode` steps and `initialization.step`, and the
     `body.snippet_id` of every embedded definition: a step tool's
     `definition` and `stagingDefinition`, each chain step's
     `config.tool.tool` (a step tool with `toolType: "track"`), and a
     `tool` step's `embeddedTool.tool` and `embeddedTool.stagingTool`.
   - A match without `snippet_version` (or `snippetVersion`) runs the newest
     version, so it changes on save. Name every one, with agent,
     environment and node, in the confirm.
3. Confirm, then `save_code_snippet` `{snippet_id, language: "js", code}`.
   It creates a new version; `name` is ignored on an update (no rename).
4. Re-pin each pinned consumer you were asked to move: a library tool through
   POST `/v2/tools/<id>` with the **whole** new `body` (the merge is shallow,
   so a partial `body` drops keys); a step through a version save of
   `snippetVersion`. Then `/run` and one test-chat turn.

Errors: `snippet_name_required` (a create without `name`),
`snippet_code_too_long` (over 200,000 characters), `snippet_not_found`
(unknown id, or another org's), `snippet_update_in_progress` (another save
holds the lock; wait and retry once), `snippet_save_failed`.

If `save_code_snippet` is not in your tool list, this server does not have
it yet. The user saves the code in the builder; then read
`/v1/snippets/get/<id>` (or, over OAuth, ask the user for the id and
version the builder shows) and re-pin as above. Never call `/v1/snippets/create`
or `/update` through `call_bland_api`; they take raw text it cannot send.

## Debug a tool run

Evidence first, then the definition. Tool logs need an API-key connection.

1. **One call.** `bland_api_get` `/v2/tools/logs?call_id=<call id>`. Returns
   `data.{logs[], totalLogs, totalPages, currentPage, pageSize}`. Each row:
   `tool_id`, `integration`, `action`, `status` (`success` or `error`),
   `error_message`, `error_type`, `execution_time_ms`, `inputs`,
   `output_size_kb`, `created_at`, plus the `resource` and `tool` it ran.
   The response body itself is not kept. Redact headers in the embedded
   `tool` definition.
2. **One tool over time.** `/v2/tools/logs?tool_id=<uuid>&status=error` and
   `/v2/tools/logs/stats?tool_id=<uuid>&group_by=error_type&status=error&period=week`.
   Pass the raw UUID, without `TL-`.
3. **Name one cause** with the row as evidence:

| Evidence | Cause | Next |
|---|---|---|
| The call's trace shows the tool firing, no log row, and "HTTP 0" or "Invalid URL format" | The definition failed the runtime check and fell to the legacy HTTP path | Fix per [the HTTP-0 trap](../../v2-runtime/references/tool-library.md#the-http-0-trap) through the shared-tool workflow. Do not re-run first. |
| No row and no tool call in the trace | The model never called it | Description, attach mode or step; see [tools and handoffs](../../v2-runtime/references/tools-and-handoffs.md). |
| `error_type: "ZodError"` | The inputs failed the action's input schema ("Validation error") | Compare `inputs` with `input_schema` and the `body` placeholders; an unfilled `{{input.<name>}}` is the usual culprit. |
| `error_message` starts "REST API request failed:" with the third party's message and JSON body | The third party answered with an error status | 401 or 403: the secret or connection; 404: the URL; 400 or 422: the body. |
| "REST API request failed:" with no response body | Network or timeout | REST and connected-service calls stop at 30 seconds whatever `timeout` says; an `execution_time_ms` near that is a slow endpoint. Check the host. |
| The agent said it was done but no variables were set | No `response_data`: the tool is fire-and-forget and its result is never read | Add `response_data` rows. |
| Rows stop at some time; the tool's `is_active` is false, or its connection shows `disconnected` in `/v1/resources/<id>` | The connection was disconnected (by a person, or by the third party's token expiring). A run against an inactive connection writes no row | Reconnect on /dashboard/tools/connections, then check `is_active` on each tool bound to it. |
| `status: success`, but the agent said something wrong | `response_data` does not point at the field | Rows do not keep the response. One `/run` with the same synthetic `inputs`, then compare `data` with each `response_data[].data` JSONPath. |

4. Report the cause, the row (time, status, trimmed message) and the fix.
   A fix to a shared tool goes through the consumer scan and confirm.

## Delete a tool

`DELETE /v2/tools/<uuid>` is a hard delete with **no reference check**.
Every `byReference` tool and `tool` step that names the id breaks; recreating
the tool mints a new id and repairs nothing.

1. `bland_api_get` `/v1/tools/<id>`. Keep the original for the record.
2. Run the [consumer scan](#consumer-scan). Add recent use from
   `/v2/tools/logs/stats?tool_id=<uuid>&group_by=tool_id&period=month`.
3. With consumers: name them and offer to detach first (a version save per
   agent, then promote). Do not delete while a production pin references it
   unless the user accepts that those calls break.
4. Confirm with the template: the agents and nodes, recent run count, "cannot
   be undone".
5. `call_bland_api` DELETE `/v2/tools/<uuid>` (raw UUID; `TL-` answers 400).
   It returns `{message: "Tool has been deleted."}`; 404 `TOOL_NOT_FOUND`
   means it is already gone or belongs to another org.
