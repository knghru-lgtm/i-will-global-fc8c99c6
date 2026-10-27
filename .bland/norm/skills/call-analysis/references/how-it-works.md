# What evidence a conversation leaves, and where

This page explains which records exist for one call or thread, when each one
appears, and which read answers which question. Route details and paging are
in [retrieval](retrieval.md) and [conversations](conversations.md); the
analysis method is in [analysis](analysis.md). Calls in progress and the
people behind conversations have their own sections:
[Active calls](#active-calls) and [Contacts](#contacts), with routes in
[live calls and contacts](live-calls-and-contacts.md).

## What it is

Every conversation leaves an evidence trail: the call record, what was said,
what the agent did in between, what was produced after it ended, and what the
platform measured. Reading the right part of that trail is how you answer
"what happened on this call" without guessing from a summary.

It is not:

- **A platform evaluation.** A judge run or disposition scores calls on the
  platform ([evaluations](../../evaluations/SKILL.md)). Your own
  categorisation in a workspace is not that, and must not be presented as it.
- **Analytics.** Counts and rates across calls come from the Analytics page
  ([cohorts and tiles](../../analytics-cohorts/references/how-it-works.md)).
- **One id space.** A voice call, a messaging thread and a web chat thread
  each have their own id and their own routes.

## Objects and how they relate

```text
 voice call (call id)                              messaging thread (conversation id)
 │                                                 │  SMS, iMessage, WhatsApp, RCS, API chat
 ├─ call record      status, length, from/to,      ├─ messages (with summary, disposition_tag)
 │                   ended by, transfer, error,    └─ per-turn trace for agent replies
 │                   price, version, external id
 ├─ transcript       flat transcript lines          web chat thread (thread id)
 ├─ event timeline   node transitions, tool and     └─ messages, newest page first
 │                   webhook calls, knowledge
 │                   lookups, variable changes,
 │                   interruptions, keypad presses
 ├─ recording        audio, when recording was on
 ├─ after the call   summary, analysis, variables,
 │                   citations, disposition results
 ├─ measurements     call scores
 └─ side records     tool logs, knowledge retrievals, memory changes,
                     SIP ladder, notes, triage flags
```

- Everything is org-scoped. A call id from another organisation reads as not
  found.
- A call is tied to the agent and agent version that ran it
  (`agent_id`, `agent_version_id`). Analyse each call against that version,
  not the current one.
- A warm transfer creates a second call (`is_proxy_agent_call: true`) for the
  leg to the human. Its evidence is separate.

## Lifecycle and states

```text
 created ──► queued ──► started (live) ──► ended ──► after-call outputs written ──► (retention) audio/text removed
   │            │            │                │
   └─ error ────┴────────────┘                └─ never connected: no transcript, no recording
```

| State | What exists | Where to look |
| -- | -- | -- |
| Queued or live | The call record | Active calls tab; the top of the Conversations list; the call record shows `completed: false` |
| Ended | Record, transcript, event timeline, recording (if on) | Conversations list; the call detail read |
| After the call | Summary, analysis, extracted variables, citations, disposition results, call scores | The call detail read; the detail panel rail |
| After retention | The record stays; recordings and transcripts older than the organisation's retention policy (14 days at the shortest) are removed | Organisation settings show the policy |
| Errored or not connected | The record with `queue_status` and `error_message` | The call detail read |

`queue_status` names where an error happened (`pre_queue_error`,
`queue_error`, `call_error`, `complete_error`). `completed: false` means the
call never connected.

## How it reaches a live call or conversation

Evidence is written by the call itself, so the question is when each piece
becomes readable.

| Evidence | Readable when |
| -- | -- |
| Call record | At creation; updated as the call progresses. In-progress calls are on the Active calls tab. |
| Conversations list row | Once the call completes. With no filter applied, the first page also shows calls in progress, marked "In progress". |
| Event timeline | During and after the call; complete once it ends |
| Recording | After the call ends, only when recording was on |
| Summary, analysis, variables | Shortly after the call ends; a minute or more is normal |
| Citations | After the call; the read reports `citations_status` (`ok`, `incomplete`, `unavailable`) |
| Disposition results | After the disposition has run on the call |
| Call scores | After the call is completed and scoring has run |
| Analytics tiles and cohorts | Usually within the hour; the Sankey the next UTC day |

A missing after-call field on a call that ended seconds ago is not missing
data. Wait and read again before you call it a failure.

## On the dashboard

The Conversations page, `/dashboard/conversations` (and the agent-scoped list
under the agent), is where people read calls and threads.

| Part of the page | What it shows | Backing read |
| -- | -- | -- |
| List | Completed calls, texts and chats, filterable; a cohort or a deep link narrows it. Unfiltered, calls in progress sit on top | `/user/logs`, `/v1/sms/conversations`, `/v1/widget/threads` |
| Active calls tab (org page only) | Calls queued or in progress, with live controls | see [Active calls](#active-calls) |
| Contacts tab | The people behind the conversations | see [Contacts](#contacts) |
| Detail: timeline | Transcript turns with routing, tool and webhook events between them, and an audio player with markers | call detail, event timeline, recording |
| Detail rail: Metadata | Call fields and the generated summary | call record |
| Detail rail: Notes | Team notes on the call | call notes |
| Detail rail: Memory | Context the call started with and the memory it changed | memory |
| Detail rail: Variables | Final variables | call detail |
| Detail rail: Dispositions | Each disposition's latest result for the call | disposition results |
| Detail rail: Pathway tags, QC tags | Tags emitted by nodes; quality tags | call record |
| Detail rail: Guardrails & issues | Guardrail triggers on the call | call record |
| Flag | Files the call, a node or a message into an issue | [triage](../../triage-issues/SKILL.md) |

Notes:

- The rail's **Metrics** section can read "No metrics for this conversation"
  even for a scored call. For platform scores, read `/v1/calls/metrics`.
- For agent-driven calls the flat transcript can be empty; the dialogue is in
  the event timeline. The page falls back to it, and so should you.
- The detail panel of a finished call reads; it does not change the call. A
  call in progress opens the live panel instead, which can end or transfer
  it ([Active calls](#active-calls)). Writes from Norm elsewhere do not
  refresh this page; reload it to see new after-call outputs.

## Rules and limits

| Rule | Value |
| -- | -- |
| `/v1/calls` page | `limit` up to 1000, offset paging with `from` and `to`; no agent filter |
| `/user/logs` page | `take` up to 100, cursor paging; `cohort` cannot combine with filters |
| Messaging list page | `limit` up to 1000, offset paging |
| Web chat list page | `limit` up to 100, cursor paging |
| Call detail | accepts the call id or your own `external_id` (newest wins); `fields=` returns a subset; `v=2` returns the event-timeline format in `pathway_logs` |
| Event timeline | `GET /v1/pathway_calls/<call id>?v=2`; sort by `sequence`, not `created_at`; gaps are normal |
| Knowledge chunks | need the list row's `created_at` |
| SIP number history | at most 500 calls |
| Call scores | 400 `CALL_NOT_COMPLETED` for a live call; 404 `METRICS_NOT_FOUND` when none were computed |
| Recording | only when recording was on; a 404 "no recordings found" otherwise |
| Exports | 20 per hour; the file is emailed, not returned |
| OAuth-connected hosts | cannot reach `/user/logs`, `/v1/sms/**`, `/v1/widget/**`, `/exports/**`, `/v2/tools/**`, `/v1/sip/**`, `POST /v1/calls/active/**`, live listen, or the live streams |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
| -- | -- | -- | -- |
| Transcript empty on an agent call | Dialogue lives in the event timeline | `transcript.user` / `transcript.assistant` events exist | Read the event timeline. |
| 404 on a call route | A thread id in a call route, or another org's id | The id came from a messaging or chat list | Use the route for that id's kind ([conversations](conversations.md#keep-the-id-spaces-apart)). |
| No recording | Recording off, call never connected, or past retention | `record: false`, `completed: false`, or call older than the policy | Say which; do not report a platform fault. |
| Summary or variables null | After-call processing not finished, or the call never connected | Call ended moments ago; `completed` | Wait and reread. |
| `citations_status: "incomplete"` | Citations were read only partly | The status field | Reread later; do not treat missing citations as "none found". |
| Tool shows "HTTP 0" or "Invalid URL format" | The tool definition failed its check and fell back | No tool log row for that call | Fix the tool definition ([retrieval](retrieval.md#evidence-for-one-call)). |
| Tool log row with `status: "error"` | The service behind the tool failed | `error_type`, `error_message` | Read the message before changing the agent. |
| `METRICS_NOT_FOUND` | No scores computed for this call | 404 | Say so; it does not mean the call is missing. |
| Agent's calls missing from `/v1/calls` | That route has no agent filter | n/a | Use `/user/logs` with the agent filter. |
| Counts disagree with the Analytics page | Freshness, or the list hides non-completed calls | Compare windows and `completed` | Explain which source each number came from. |

## Questions people ask

**Where is the full transcript of an agent call?**
In the event timeline (`/v1/pathway_calls/<call id>?v=2`), as
`transcript.user` and `transcript.assistant` events. The flat transcript can
be empty for these calls.

**Why does the call have no recording?**
Recording was off, the call never connected, or the organisation's retention
policy removed it. The call record says which of the first two.

**How do I know which version of the agent handled a call?**
`agent_version_id` on the call record. Analyse against that version.

**Can I see why the agent routed where it did?**
Yes. Each `node.transition` event lists the routes it could take, the one it
chose and how it decided.

**The summary says the booking succeeded. Can I trust that?**
No. A summary is generated text. Confirm with the tool result in the event
timeline or a disposition that checks it.

**How do I look up a call by my own id?**
Pass your `external_id` in place of the call id on the call detail read.

**Why is a call I just finished not in the Conversations list?**
The list holds completed calls; with no filter applied it also shows calls in
progress on top. A filtered list, a cohort or a sequence hides calls in
progress. A call that ended seconds ago can sit between the two for a moment;
read the call record to see `completed`.

**Is a texted conversation a call?**
No. It is a thread with its own id and routes. Never pass its id to a call
route.

## Active calls

The **Active calls** tab of the org Conversations page,
`/dashboard/conversations?tab=active`, lists the organisation's calls that
are queued or in progress, every agent at once. The agent-scoped
Conversations page has no Active calls tab; there, calls in progress sit at
the top of the list instead. Routes and bodies are in
[live calls and contacts](live-calls-and-contacts.md#active-call-routes).

### What counts as active

```text
 outbound call created ──► Queued ─────► In progress ──► Transferred
   (scheduled: "Scheduled (<date>)")     ▲      │              │
 inbound or web call connects ───────────┘      └──── ends ────┴──► leaves the tab
 queued call stopped ─────────────────────────────────────────────► leaves the tab
```

- An outbound call joins when it is created, as Queued. A scheduled call
  shows its start time while it waits.
- An inbound or web call joins when it connects, as In progress. An inbound
  call refused at the door (for example over a limit) never joins.
- A call leaves the tab when it ends, however it ends.
- The Objective column shows only the first 20 characters of the call's
  task.
- Duration counts from the call's last status change, so it restarts at a
  transfer.

### How fresh it is

| Surface | Freshness |
| -- | -- |
| Active calls tab | Pushed as calls change; a full re-read every 30 seconds catches anything missed. A dropped connection shows "Lost connection to call updates. Reconnecting…" and retries with growing waits. |
| Conversations list (org and agent) | With no filter, sequence or cohort, the first page carries calls in progress, marked "In progress", and refreshes every 5 seconds while the tab is visible. |
| Live transcript panel | Lines appear as they are spoken. A reconnect replays the last 100 lines. A call that hides transcript lines (privacy or redaction on a step) can show "No transcript yet" throughout. |
| After the call | The live transcript is gone. Read the finished call ([evidence](#objects-and-how-they-relate)). |

An entry on the Active calls tab lapses about 30 minutes after its last
status change. A call that runs longer than that without a transfer can drop
off the tab while still connected, and a call whose end signal went missing
can linger for up to 30 minutes. The call record (`completed`) and the
Conversations list's in-progress rows do not have this gap. Trust them when
the tab disagrees.

### What a person can do live

Click a row to open the live panel. The same panel opens from an in-progress
row of the Conversations list.

| Control | What it does | Limits |
| -- | -- | -- |
| Live transcript | Streams caller and agent lines, and agent actions | Text only |
| Listen | Plays the call's audio in the browser | Needs **Live call monitoring** on (Settings, Organization, Recording preferences). Off shows a lock that links there. Appears once the call connects |
| End call | Hangs up, or cancels a queued call | Acts at once. The button has no second prompt |
| Transfer call | Dials the number entered and connects the caller to it. The agent leaves the call | Shown after the first transcript line, until the call is transferred or ends. Phone calls only |
| View call details | Opens the Conversations tab | No deep link to the call yet |
| Get a test call | On the empty tab only: places a real demo call to your account's phone number | Needs a phone number on your account |

### What Norm can do through the API

- **Read** which calls are live: `GET /v1/calls/active`. It answers the
  question "who is on a call right now", not "what are they saying".
- **End one call**, after confirming: `stop_call` with the call id.
- **Transfer one call**, after confirming: `POST /v1/calls/active/transfer`.
  An OAuth connection cannot; send the user to the live panel.
- **Never** end every call at once (`POST /v1/calls/active/stop`). It hangs
  up on every live call in the organisation.

Dashboard only:

- **Listening.** Norm cannot hear a call, live or recorded. The listen route
  hands back a short-lived audio stream for a browser to play; Norm has no
  way to play it. Send the user to the Listen button.
- **Following the live transcript.** The live streams feed the dashboard and
  are not readable through Norm's tools. Norm reads what was said after the
  call ends.

### Active calls: when it goes wrong

| Symptom | Likely cause | Evidence | Fix |
| -- | -- | -- | -- |
| Caller is on the line but the call is not on the Active calls tab | Over about 30 minutes since its last status change; or an inbound call that was refused | Call record shows `completed: false`; the row is on the Conversations list as In progress | Use the Conversations list or the call record |
| Row stays after the caller hung up | The end signal was missed | Call record shows `completed: true` | It clears within about 30 minutes |
| Listen shows a lock, or the API answers 400 `INVALID_ORG_PREFERENCES` | Live call monitoring is off | Organization settings | Turn it on in Recording preferences |
| "We couldn't connect to the call" on Listen | The call has not started or just ended (404 `CALL_NOT_FOUND`), or listening is not offered in this deployment (404 `NOT_SUPPORTED_IN_ENVIRONMENT`) | The call's status | Retry once it is In progress |
| Transfer refused with 403 | International destination for this account type, a phone-plan destination limit, or an onboarding demo call | The error message | Use an allowed destination |
| Transfer 400 "not found or has already been completed" | The call ended or never started | Call record | Nothing to transfer |
| Stop answers 404 "SID not found for the given c_id." | The call failed before it dialled | `queue_status` on the call record | Nothing to hang up |

## Contacts

A contact is one person your organisation has talked to, known by a phone
number, an email, or your own external id. It is org-wide: the same person
reached by two agents is one contact. It is not a memory and not a
do-not-call entry, though it links to the first and never to the second.
Routes are in [live calls and contacts](live-calls-and-contacts.md#contact-routes).

### What a contact holds

```text
 organisation
 └─ contact (one person, org-wide)
    ├─ identifiers        phone_number · email · external_id   (matched exactly)
    ├─ name, profile      profile fields come from the org's profile schema
    ├─ memory, one per agent (or per number the agent used)
    │                     summary · facts · entities · open items · recent messages
    ├─ CRM sync status    one row per connected CRM
    └─◄ calls and message threads point back to it (contact_id)
```

- Each call row from `/user/logs` carries `contact_id` and `contact_name`.
- What memory holds, and when an agent reads and writes it, is in
  [agent memory](../../knowledge-sources/references/how-it-works.md#agent-memory).
- The do-not-call list is a list of numbers that blocks outbound calls
  ([do-not-call list](../../phone-numbers/references/endpoints.md#outbound-do-not-call-list)).
  A contact has no do-not-call flag, and adding its number to the list does
  not change the contact.

### How a contact is created and matched

| Path | Creates a contact when |
| -- | -- |
| Inbound or outbound call | Memory is on in the version that ran (production for inbound) and there is a phone number |
| Text thread (SMS, RCS, WhatsApp) | Memory is on in the version that answers |
| iMessage thread | The message arrives; this channel may create one even with memory off |
| API chat opened with `end_user_id` and a `contact` block | Always; it links the end user id to the phone or email given |
| `POST /v1/contacts/resolve` | No identifier matches |

- A match on any one identifier reuses the existing contact. The match is
  exact, so use the form the calls show (E.164 such as `+15551234567`).
- Reusing a contact fills the name only when it is empty, merges profile
  keys, and adds any new identifier.
- With memory off, calls and texts create no contact and carry no
  `contact_id`. A web call or web chat with no phone number usually has none.
- Two contacts can end up with the same identifier. A lookup then returns
  one of them. An API chat that names two different contacts is refused with
  409 `CONTACT_CONFLICT` until they are merged.

### Edit, merge and delete

| Change | Effect | Undo |
| -- | -- | -- |
| `PATCH` name | Replaces the name | Patch it back |
| `PATCH` email or external id | Adds it as another identifier; the old one stays | No route removes an identifier |
| `PATCH` metadata | Merges key by key. A key set to `null` is blanked, never removed. Keys that name a profile field with a pattern must match it | Patch it back |
| Merge | Moves the duplicate's identifiers, memories, calls and threads onto the primary, then deletes the duplicate | None. A merged contact cannot be split |
| Delete | No route deletes a contact | n/a |
| Forget what an agent remembers | Deletes that agent's memory of the contact; the contact stays ([memory records](../../v2-lifecycle/references/api.md#memory-records)) | None |

How a merge combines data: the primary's name and profile values win where
both have one. Two memories from the same agent become one: messages are
interleaved by time, the primary's facts win, open items are combined and
the two summaries are joined. The next conversation with that person reads
the combined memory.

### Contacts on the dashboard

| Where | What it shows |
| -- | -- |
| `/dashboard/conversations?tab=contacts` | Every contact, newest first, 50 at a time with "Load more contacts". The agent chip does not narrow this list |
| `/dashboard/agent/<agent id>/conversations?tab=contacts` | Contacts that have a memory from this agent: its own, or one written through a number bound to it now. A number moved between agents brings its contacts along |
| Contact drawer | Profile fields; tabs Conversations (the 25 most recent calls and threads, oldest first), Memory, Agents, CRM (with Sync now), Raw |
| A conversation's detail panel | "Full thread with this contact" widens the transcript to every call and thread with that person |

- The search box filters only the rows already loaded: name, phone, email
  and memory summary.
- **Messages** counts the recent messages kept in memory, not every message
  ever exchanged. **Last seen** is when the contact record last changed.
- **Edit profile fields** changes the org-wide profile schema (owner, admin
  or operator). `?profile=1` opens it directly.
- The tab does not edit, merge or delete contacts. Those are API actions.
  After one, say "Saved through the API. The page shows it after a refresh."

### Contacts: when it goes wrong

| Symptom | Likely cause | Evidence | Fix |
| -- | -- | -- | -- |
| A caller has no contact | Memory was off in the version that ran, or no phone number | `contact_id` is null on the call | Turn memory on ([agent memory](../../knowledge-sources/references/how-it-works.md#agent-memory)) |
| Same person twice | Reached by different identifiers, or created twice | `POST /v1/contacts/find` per identifier returns different ids | Merge, after confirming |
| Agent's Contacts tab shows people it never spoke to | They came through a number now bound to this agent | The contact's Agents tab names the number | Expected |
| `PATCH` answers 400 `INVALID_PROFILE_FIELD` | A value does not match the field's pattern, or is over 256 characters | The `fields` map in the error | Fix the value |
| `find` answers `data: null` | No exact identifier match | The number's format | Retry in E.164 |
| Thread shows fewer conversations than expected | The thread keeps the 25 most recent | `omitted` in the response | Page the calls list by number instead |

### Questions about live calls and contacts

**Can Norm listen to a call?**
No. Norm cannot hear audio, live or recorded. A person listens with the
Listen button on the live panel.

**Can Norm tell me what is being said right now?**
No. It can tell you which calls are live and read each call once it ends.
The live transcript is on the dashboard panel.

**Will ending a call warn the caller?**
No. Ending hangs up at once. A queued call is cancelled instead.

**Can I delete a contact?**
Not through the API or the dashboard. You can merge a duplicate into another
contact, or delete one agent's memory of the person.

**Does adding a contact's number to do-not-call change the contact?**
No. The list is separate and only blocks outbound calls.
