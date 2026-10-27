---
name: triage-issues
description: Use when filing or working issues on the Issues page, org-wide or for one agent ("file an issue", "log this bug", "track this", "this call went wrong, record it", "attach this call to the issue", "close the issue", "link these issues", "what's open on this agent", "flag a capability gap"), including evidence, flags, assignment, alert bindings and billed eval analysis.
---

# Triage issues

An issue is a tracked agent defect. This skill is the hand-off from a [debugging session](../api-workspace/references/debugging.md#report)
or [call analysis](../call-analysis/SKILL.md): carry their ids, not their
prose. Read [the API reference](references/api.md) first; [how it
works](references/how-it-works.md) explains statuses and side effects. Do not
write fetch scripts or search the docs for these routes.

## Page context

1. Call `get_dashboard_page_context` (`mode: "synced"`).
2. `/dashboard/triage` is the org list. On `/dashboard/agent/<agentId>/triage`,
   default `agent_id` to `route.params.agentId`. `route.search.issue` is the
   open issue.
3. No target chip exists. Read the page; never drive its forms.
4. After every write say: "Saved through the API. The page shows it after a
   refresh."

## Workflow: file an issue from a bad call

Budget: two list reads, one create, one write per evidence item, one read.

1. Dedupe: `bland_api_get` `/v1/triage/issues` with `agent_id` and `search`
   set to the symptom; skip `done` and `closed`. If one covers it, extend it.
2. File: `call_bland_api` POST `/v1/triage/issues` with `title`, `severity`,
   `category`, `description` (expected, actual, repro, ruled out), `agent_id`,
   `agent_version_id`.
3. Evidence: a call with PUT `…/issues/<id>/calls/<callId>`, an SMS thread
   with POST `…/resources`. Name scenarios and nodes in the description and on
   a flag.
4. Flag the turn only after its call is attached (otherwise 409
   `call_not_attached`): POST `…/flags` with `call_id`, `type`, `node_id`,
   `message_index`, `note`.
5. Relate a duplicate: POST `…/relations`, `relation_type: "duplicate_of"`.
6. Comment: POST `…/comments` with `detail`.
7. Read back GET `/v1/triage/issues/<id>`; report `triage_id` and status.

## Workflow: work an issue

- Status: PATCH `/v1/triage/issues/<id>` with `status`.
- Assign: PATCH `assignee_id`. It notifies the person in the app and by email;
  say so.
- Comment and link related issues as in steps 5 and 6.
- Close: PATCH `status: "closed"` or `done`. One confirm per issue, even for
  "close all the duplicates".

## Workflow: alert and eval bindings

- Bind an alert: GET `/v1/alerts?agent_id=…` gives `id` and `active_alert.id`;
  POST `…/alert-bindings` with `alert_config_id` and `active_alert_id`.
- Eval analysis: POST `…/eval-analysis` with `agent_id`. It creates a judge
  and starts a billed eval run over the attached calls (two or more), else up
  to 25 recent calls from the whole org. No estimate exists. REQUIRED confirm
  with call count and billing. Results: [evaluations](../evaluations/SKILL.md).

## Capability gaps

No endpoint exists. If the platform, not the agent's setup, cannot do what the
user needs, file an issue titled "Capability gap: <what is missing>". Say a
formal product gap is out of scope here; raise it through the proper channel.

## Never write `@norm`

A comment containing `@norm`, in any case, starts an agent run that can draft
agent edits. Never write it, quoted text included; write "Norm". If the user
wants that run, name it as a separate action with its own confirm and use
[triage runs](references/api.md#triage-runs).

## Confirm before

Delete, close, detach, unflag, unrelate, unbind, assign, eval analysis, a
triage run. Confirm each one, every time; the API applies it at once.

```text
About to <verb> <T-n "title">: <what changes, who is notified, call count>.
This <cannot be undone | emails <person> | runs a billed eval>.
Reply "yes" to proceed.
```

## Refusals and limits

- `oauth_path_not_allowed`: say "this connection cannot reach issues; do it on
  the Issues page" and stop.
- File evidence is a multipart upload: attach files on the Issues page.
- Other statuses: [errors](references/api.md#errors).

## Do not

- Guess ids or fields. Routes take the issue `id`, not `T-n`.
- File without a dedupe search or evidence ids.
- Close, delete or detach several issues under one yes.
