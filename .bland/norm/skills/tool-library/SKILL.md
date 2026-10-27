---
name: tool-library
description: Use when someone wants to "create a tool", "call my API from the agent", "wire up a webhook", says "the tool returns HTTP 0" or "why did the tool fail on this call", asks "how do tools work" or "what does the caller hear while it runs", wants to "update the shared tool", "delete this tool" or asks "which agents use this tool", wants to "add a secret", "connect HubSpot / Salesforce" or "disconnect" an integration, or wants "custom code" in a tool, on the Tools, Secrets or Connections pages.
---

# Tools, secrets and connections

A library tool is an org row agents call mid-conversation. Answer "how does
it work" and "why did it happen" from [how tools work](references/how-it-works.md).
Read the [tool library reference](../v2-runtime/references/tool-library.md)
before the first write; steps are in [procedures](references/workflows.md).
Attaching edits a snapshot ([v2-snapshot](../v2-snapshot/SKILL.md)); test
chats follow [v2-testing](../v2-testing/SKILL.md). Do not write fetch scripts
or search the docs for these routes.

## Page context

Call `get_dashboard_page_context` (`mode: "synced"`) first.

- `/dashboard/tools`, `/dashboard/tools/create`: org scope.
- `/dashboard/tools/$toolId`: tool id.
- `/dashboard/tools/secrets`, `/connections`: lists; `/resources/$resourceId`.
- `/dashboard/agent/$agentId/tools/**`: agent id, plus tool id on `$toolId`.

Mutate through the API, never the page's forms. After every write say:
"Saved through the API. The page shows it after a refresh."

## Workflow: create and prove a tool

Budget: search, create, run, attach save, one test-chat turn.

1. `bland_api_get` `/v1/tools?search=<name>`; reuse a match.
2. Write the definition per the reference: no top-level `url` or `method` on
   an integration definition, and an object `input_schema`. Both save
   cleanly, then fail every call with HTTP 0.
3. `call_bland_api` POST `/v2/tools`. Keep the id.
4. POST `/v2/tools/<id>/run` with `{"inputs": {…}}`, synthetic values.
5. Attach with a dev save; say why this mode: embedded copy (frozen,
   this agent), `byReference` or a `tool` step (both follow library edits).
6. One test-chat turn that makes the agent call it.

Custom code: `save_code_snippet`, then the tool pinned to the returned
version ([custom code tools](references/workflows.md#custom-code-tools)).

## Workflow: change a shared tool safely

Budget: read, agent scan, write, read-back, run.

1. `bland_api_get` `/v1/tools/<id>`. Keep the original.
2. Run the [consumer scan](references/workflows.md#consumer-scan). If it
   is incomplete, stop.
3. Show the diff and the affected agents. Confirm.
4. POST `/v2/tools/<id>` with only the changed keys. Never send a partial
   body to POST `/v1/tools/<id>`: it replaces the row unvalidated.
5. Read back, then `/run`.

## Workflow: debug a tool run

Budget: log read, stats read, definition read.

1. `bland_api_get` `/v2/tools/logs?call_id=<call id>`, or by `tool_id` (raw
   UUID) with `status=error`.
2. `/v2/tools/logs/stats?tool_id=<uuid>&group_by=error_type&status=error&period=week`.
3. Name one cause from the [cause table](references/workflows.md#debug-a-tool-run)
   with the row (or its absence) as evidence. Change something before any
   re-run.

## Workflow: delete a tool safely

Budget: read, consumer scan, one stats read, one delete.

1. `bland_api_get` `/v1/tools/<id>`; run the
   [consumer scan](references/workflows.md#consumer-scan) (same stop).
2. Name every agent and node; offer to detach first.
3. Confirm, then DELETE `/v2/tools/<uuid>`. There is no reference check.

## Secrets and connections

- `/v1/secrets` first; prefer the user entering the value on Tools, Secrets.
  Reference by id: `{{secret.id.<secret id>}}`. Delete is UI-only.
- Connect: POST `/v1/integrations/<key>/connect` `{"name": "<label>"}`, hand
  over `connect_link`, poll `/v1/resources?integration=<key>`.
- Before a disconnect or DELETE `/v1/resources/<id>`, list the `/v1/tools`
  rows with that `resource_id`: they deactivate. Reconnect is UI-only.

## Confirm before

Any shared-tool write or delete, a snippet save that unpinned consumers run,
any disconnect:

```text
About to <verb> <object>: <what changes, which agents or tools are affected>.
This <changes live calls now | deactivates N tools | cannot be undone>.
Reply "yes" to proceed.
```

## Refusals and limits

- `oauth_path_not_allowed`: say "this connection cannot reach tools; do it
  on /dashboard/tools" and stop.
- `INVALID_TOOL_TYPE` from POST `/v2/tools/<id>`: a legacy tool. After the
  confirm, POST the full original with the change, including
  `staging_tool`, to `/v1/tools/<id>`.
- Redact tool headers. Never call the dashboard's connection sign-in routes or
  `/v2/tools/suggestions`. `/run`, `/v1/tools/run` and
  `/v1/resources/<id>/execute` are real executions, not reads.
