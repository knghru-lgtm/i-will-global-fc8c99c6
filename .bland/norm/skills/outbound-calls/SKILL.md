---
name: outbound-calls
description: Use when placing or scheduling outbound calls with a v2 agent ("call this number with my agent", "place a call", "schedule a call"), running a campaign ("run a campaign", "call this list", "batch"), stopping one ("stop the batch"), or checking recipients ("is this number on the DNC"), including from the Send call and Batches pages.
---

# Place outbound calls with a v2 agent

A call rings a real person and bills the org. Selectors:
[lifecycle](../v2-lifecycle/SKILL.md); live-integration safety:
[testing](../v2-testing/SKILL.md); bulk review:
[call analysis](../call-analysis/SKILL.md).

Read [calls](references/calls.md) before the first dial and
[batches](references/batches.md) before a batch. For "why did this call or
batch do X", read [how it works](references/how-it-works.md). Do not write
fetch scripts and do not search the docs for these routes.

## Page context

1. Call `get_dashboard_page_context` (`mode: "synced"`).
   - `/dashboard/send-call`: read `fields` (label and value, at most 20) and
     offer them as the draft body. Never submit the page's form.
   - `/dashboard/agent/<agentId>/batches`: the agent is `route.params.agentId`.
     `/dashboard/batches` is org-wide.
2. No attached-target chip exists here; do not wait for one.
3. After a write say: "Placed through the API. The Batches page shows it
   after a refresh." Never claim the page updated.

## Workflow: call one person with a v2 agent

Budget: four reads, one POST, waits.

1. `create_call` cannot carry `agent_id`. Use `call_bland_api` POST
   `/v1/calls` with the [v2 body](references/calls.md#the-body).
2. Agent from the page, or ask. `bland_api_get`
   `/v2/agents/<id>/environments`; name the version that will run (the
   production pin or the user's selector). An unknown selector is a 400.
3. Caller id: pick `from` from `bland_api_get` `/v1/inbound`, or say the
   system picks one.
4. `call_bland_api` POST `/v1/org_dnc/search` `{ "phone_number": … }`. A hit
   ends here.
5. Echo version and caller id in the confirm. On "yes" send
   `phone_number`, `agent_id`, `agent_version`, `from` and only fields the
   user asked for (`start_time` schedules).
6. State the `call_id` at once. `wait_for_call`, then `get_call_log`.
7. Errors (`AGENT_*`, `CALL_PLAN_*`, `CALL_UNPAID_INTL_BLOCK`, 429): the
   [error table](references/calls.md#errors).

## Workflow: run a batch

Budget: six reads, two POSTs (canary, full), polls.

1. Inline `call_objects[]` only; CSV and SMS batches need the Batches page.
2. `global` needs `agent_id` AND a non-empty `task`, or it is a 400
   ([the trap](references/batches.md#the-global-trap)).
3. `bland_api_get` `/user/rateLimits`. **Refuse** a batch (plus its canary)
   larger than the remaining hourly or daily allowance, and refuse when the
   read fails ([pre-flight](references/batches.md#rate-limit-pre-flight)).
4. DNC pre-flight ([how](references/batches.md#dnc-pre-flight)); drop hits.
5. Recommend a one-row canary to a number the user controls; confirm, send,
   read the call.
6. Re-read `/user/rateLimits`; the list must still fit. Confirm it, POST
   `/v2/batches/create`, state `batch_id` at once. Offer `status_webhook`.
7. Watch `/v2/batches/<id>` and `/logs`; calls via
   `GET /v1/calls?batch_id=<id>`, then call analysis.

## Workflow: watch and stop

- One call: `stop_call`, or POST `/v1/calls/<id>/stop`.
- A batch: POST `/v2/batches/<id>/stop` stops undialed calls; stop connected
  ones one by one.
- Never call POST `/v1/calls/active/stop`. It ends every live call in the org.

## Confirm before

REQUIRED before every call, canary, batch and stop: recipients (or count
and three examples), agent version, caller id, cost class.

```text
About to place <N> call(s) with <agent> <semver> (<selector>) from <caller id> to <recipients>, <now | at time + zone>, <domestic | international>, billed per minute.
This places <N> calls to real people.
Reply "yes" to proceed.
```

For a stop: verb "stop"; the second line names who is hung up on or how
many undialed calls end.

## Refusals and limits

- A timeout is "unknown", not "failed". Read `/v2/batches/list` or
  `/v1/calls?to_number=` before re-submitting; batch create is not
  idempotent.
- `oauth_path_not_allowed`: "this connection cannot reach <route family>;
  do it on the Batches page", then stop.
- `request_data` (`{{key}}`) and `metadata` (`{{metadata.key}}`, also in
  call log and webhook) replace version defaults whole. Voicemail,
  `webhook_events`, carrier keys: [calls](references/calls.md).

## Do not

- Guess a selector, field or `from`.
- Add voice, prompt or model fields; they override the agent version.
- Combine `agent_id` with `pathway_id` or `persona_id`.
