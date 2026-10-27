# How issues work

This page explains what an issue is, how it moves from filed to closed, what
each action does to people and agents around it, and what the Issues page
shows. Every route and field is in [the API reference](api.md).

## What it is

An issue is a tracked defect in an agent's behavior, with the evidence that
proves it: the calls or threads where it happened, the exact moment flagged,
and the discussion around the fix. It turns "this call went wrong" into a
record a team can assign, work and close.

It is not:

- **A support ticket.** Filing an issue does not contact Bland support; the
  Support page does that.
- **An alert.** An alert fires on a condition across calls. An issue can be
  bound to an alert so the two are tracked together.
- **An evaluation.** An issue can start an eval run, but the scores live with
  [evaluations](../../evaluations/SKILL.md).
- **A capability-gap tracker.** No such tracker exists; file an issue titled
  "Capability gap: <what is missing>".

## Objects and how they relate

```text
 organisation
  └─ issue  (id, display number T-n, title, status, severity, category,
      │      owner, assignee, agent + agent version, source)
      ├─ evidence links ─► call | SMS conversation | uploaded file
      │     └─ flags ─► one moment of an attached call (node, message index, type, note)
      ├─ comments ─► activity timeline (every change, comment and run)
      ├─ relations ─► other issues (related_to, blocks, duplicate_of)
      ├─ alert bindings ─► an alert config and one firing of it
      ├─ eval analysis ─► a judge + an eval run over calls
      └─ triage runs ─► an agent session that diagnoses and can draft edits
 categories (org-wide list + built-ins)      flag types (org-wide, reused by name)
```

- Issues, categories and flag types are org-scoped. Every issue has a
  display number `T-n` and an `id`; routes take the `id`.
- `agent_id` and `agent_version_id` are set at creation and never changed by
  an edit. If they were left out, the first attached call fills them in.
- The agent's Issues page lists only issues with that `agent_id`.

## Lifecycle and states

```text
                 ┌──────────────────── any status can move to any other ───────────────────┐
                 ▼                                                                          │
 create ──► todo (default) ◄──► backlog ◄──► in_progress ◄──► in_review ◄──► done ◄──► closed
                                                                                            │
 delete (from any status) ──► removed from every list and read; no route restores it ◄─────┘
```

- **Statuses**: `backlog`, `todo`, `in_progress`, `in_review`, `done`,
  `closed`. A new issue is `todo` unless the body says otherwise.
- **Only a person moves status.** No status changes by itself: not when an
  alert resolves, not when a triage run finishes, not when an eval run
  completes. `done` and `closed` are reversible by another edit.
- **Delete is final.** The issue leaves every list and its reads answer 404.
  Close it instead when the history matters.
- **Activity** records every change: created, status, severity, category,
  owner, assignee, evidence added or removed, flags, comments, relations,
  alert bindings, and triage-run progress. `last_activity_at` moves with each.

## How it reaches a live call or conversation

An issue never changes a call or an agent by itself. Three actions reach
further than the issue:

| Action | What else happens | Reversible? |
| -- | -- | -- |
| Assign (`assignee_id`) | The assignee gets an in-app notification and an email. Later edits and comments notify them in the app. | The notification is sent. |
| A comment containing `@norm` | Starts a triage run with the rest of the text as its prompt. A run whose prompt does not start with `status` or `verify` can save edits to the agent's working (unpublished) version and change tool settings. | The run cannot be unsent. Review what it changed before anything is published; tool setting changes may apply as made. |
| Eval analysis | Creates or reuses a judge for the agent and starts a billed eval run over the issue's calls (two or more attached), else the org's 25 most recent completed calls from any agent. Comments the run id on the issue. | Billed when it runs. |

Attaching a call does not change the call. It stamps the call's agent and
version onto an issue that had none.

## On the dashboard

| Page | What it shows |
| -- | -- |
| `/dashboard/triage` | Every issue in the organisation: list with search, status, severity and category filters, and a detail pane |
| `/dashboard/agent/<agent id>/triage` | The same, pinned to one agent |
| Detail pane: Activity | The timeline, the comment box and live triage-run output |
| Detail pane: Evidence | Attached calls, threads and files, and their flags |
| Detail pane: Related | Relations to other issues, read-only |
| Testing panel | Test chat and a test call against the agent, beside the issue |

What the page can do that the API cannot through Norm:

- **Upload a file** as evidence (a multipart upload).
- **Generate fix**, which posts the comment `@norm fix` and so starts a
  triage run.

What the API can do that the page cannot: add or remove a relation.

Refresh: an open issue polls itself every two seconds only while a triage run
is active. After any other write through the API, the page shows it after a
refresh.

Calls are also flagged into issues from the Conversations page detail panel
([call evidence](../../call-analysis/references/how-it-works.md)).

## Rules and limits

| Rule | Value | What the user sees |
| -- | -- | -- |
| Title | 1 to 200 characters | 400 `Invalid params` |
| Description | up to 10,000 characters | 400 |
| Severity | `critical`, `high`, `medium`, `low`; required | 400 |
| Category | 1 to 64 characters; required | 400 |
| Comment and note | 1 to 4,000 characters | 400 |
| Unknown body key | refused | 400 `Invalid params: <path>` |
| List page | `limit` 1 to 100, cursor paging | 400 |
| Flag before attach | call must be attached first | 409 `call_not_attached` |
| New flag type | needs a `note` | 409 `New flags require a description` |
| Evidence id | must belong to the organisation | 404 `Call not found` / `SMS conversation not found` |
| Duplicate attach | returns the existing link | 201, no second link |
| Duplicate category | refused | 409 `Category already exists` |
| Eval analysis on an issue with no agent | refused | 400 `AGENT_REQUIRED` |
| Second eval analysis while one runs | refused | 409 `ANALYSIS_ALREADY_RUNNING` |
| OAuth-connected host | refused on every issue route | `oauth_path_not_allowed` |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
| -- | -- | -- | -- |
| Issue missing from the agent's Issues page | Filed without `agent_id` and no call attached | `agent_id: null` on the issue | Attach a call from that agent; the issue takes its agent. |
| 409 `call_not_attached` on a flag | Flag sent before the call was attached | The resources list lacks the call | PUT the call, then flag. |
| Duplicate issues for one defect | No dedupe search before filing | Two issues with the same symptom | Relate one as `duplicate_of`, close it after a confirm. |
| A comment started a run nobody asked for | The text contained `@norm` | A triage-run entry in the activity | Review and revert what it changed; never quote `@norm`. |
| Eval analysis scored unrelated calls | Fewer than two calls attached, so recent org calls were used | `call_count` and the run's calls | Attach the relevant calls first, then run it. |
| `Issue not found` for a known issue | Wrong id (a `T-n` used as an id), another org, or deleted | Search by `T-n` | Use the `id` from the search result. |
| 409 `Alert bindings are not configured` | Alerts are not available to this organisation | The error | Stop and say so. |
| Assignee surprised by an email | Assignment always emails | The assignee change in activity | Tell the user before assigning. |

## Questions people ask

**Does closing an issue fix anything?**
No. Status is bookkeeping. The fix is a change to the agent, published and
verified.

**Can I reopen a closed issue?**
Yes. Set any other status. Only delete is final.

**Does filing an issue contact Bland support?**
No. Use the Support page for that.

**Why did my issue get an agent I did not set?**
It had none, and the first call attached to it carried that agent and
version.

**What does "Generate fix" do?**
It posts `@norm fix`, which starts a triage run that diagnoses the issue and
can save edits to the agent's working version. Review them before publishing.

**Does eval analysis cost money?**
Yes. It starts a billed eval run, and no estimate is shown first.

**Can I link two issues on the page?**
The page shows relations but cannot add them. Norm adds them through the API.

**Is there a way to stop a triage run?**
No route stops one. Let it finish, then review and revert what it changed.
