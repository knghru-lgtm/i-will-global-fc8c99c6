# How chat and text channels work

The conceptual page for web chat, API chat and texting. The routes and bodies
live in [web-chat](web-chat.md), [api-chat](api-chat.md) and
[messaging](messaging.md); this page explains what runs, when a change is
felt, and why a channel misbehaves. The agent's [identity](#identity)
(contact card, branded caller ID, RCS sender) is at the end; its routes are
in [identity](identity.md).

## What it is

A v2 agent can hold text conversations outside a phone call:

- **Web chat**: a chat bubble on the customer's website, from a widget record.
- **API chat**: the customer's own app talks to the agent over HTTP
  (`/v1/chat`), with no phone number.
- **Messaging**: SMS, iMessage, RCS and WhatsApp threads on a phone number
  bound to the agent.

People read these threads on the Conversations page and can take a text or API
chat thread over from the agent, reply as a person, and hand it back.

It is not:

- **Test chat** in the builder. Test chat runs the dev head or a chosen
  version and reaches no real person ([v2-testing](../../v2-testing/SKILL.md)).
- **A campaign.** Texting many people is a batch; pick them with
  [analytics-cohorts](../../analytics-cohorts/SKILL.md).
- **The snapshot's `settings.webChat`.** Those fields configure no widget. The
  widget record owns title, greeting, domains and look.

## Objects and how they relate

```text
 ORG RECORDS, LIVE (not versioned)        AGENT, VERSIONED
 +---------------------------+            +----------------------------------+
 | widget                    |            | agent                            |
 |  allowed_domains (switch) |            |  saved versions (dev head)       |
 |  config: look, timers,    |            |  production pin --+              |
 |  webhook, domains copy    |            |  settings.apiChat |              |
 +-------------+-------------+            |  settings.messaging              |
               | bind                     +-------------------+--------------+
               v                                              | compile
 +---------------------------+   one per agent   +------------v-------------+
 | phone number              |  ---- attach ---> | messaging copy           |
 |  texting config per       |                   | (compiled graph + the    |
 |  channel: webhook,        |  API chat entry ->| text "Agent context")    |
 |  time_out, warning, data  |  (made on first   +------------+-------------+
 +---------------------------+   open)                        |
                                                              v
                       thread (conversation) -> messages, handoff state,
                       summary, linked contact and memory
```

The agent keeps **one compiled messaging copy**. A bound widget, the API chat
entry and every bound number's texts all run that copy. Voice calls do not:
a call resolves the pinned version when it starts. Other references call this
copy "the twin".

| Object | Scope | Versioned | Where it is changed |
|---|---|---|---|
| Widget | Org | No | `/v1/widget`, Channels > Web chat |
| Number texting config | Number, per channel | No | `/v1/sms/number/update`, Channels > Messages |
| `settings.apiChat.enabled` | Agent | Yes, read from production | Snapshot, Channels > API chat |
| `settings.messaging.*` | Agent | Yes | Snapshot, Messages > Behavior |
| Messaging copy | Agent | Follows production | Bind, attach, promote, rollback |
| Thread | Org | No | Created by the channel |

## Lifecycle and states

### A text or API chat thread

```text
   first text / /v1/sms/send / POST /v1/chat
                  |
                  v
   +-------->  active  ---- take over ---->  human_handoff
   |             |  ^                          |      |
   |             |  +------ hand back ---------+      |
   |             |                                    |
   |   idle past time_out    end step, /end           | /end
   |             v                 v                  v
   |          timeout            ended  <-------------+
   |             |                 |
   +--- take over (a person may reopen it) ---+
```

- `active`: the agent answers each message.
- `human_handoff`: the agent stays silent. Inbound messages are stored and
  sent to the webhook. The idle timer is paused.
- `timeout` and `ended`: the thread is closed. The summary, any legacy
  dispositions on the texting config, and the final status webhook run once.
  The agent's own dispositions score calls, not threads
  ([dispositions](../../dispositions/SKILL.md)). The person's next text starts a **new**
  thread. An API chat message to it gets 409 `CHAT_ENDED`; open a new one.
- Taking over a closed text thread reopens it for the person who took it.

### A web chat thread

```text
 visitor opens bubble -> active -> idle past widget timeout -> ended
                           |  ^
        live agent posts --+  +-- timer skipped while a live agent holds it
                           |
        END_CONVERSATION --+-> ended
```

A returning visitor usually sees their earlier threads, so one web chat
thread can be long.

### The messaging copy

```text
 bind a widget ........ compiled from production (latest save if never promoted)
 open first API chat .. same
 promote / rollback ... recompiled from the new production pin
 production attach .... recompiled from the LATEST SAVE (dev head)
                        then back to production at once if a widget is bound
 staging attach ....... left as it is (built from production if missing)
```

A refresh that cannot build production (for example an invalid production
version) leaves the copy as it was.

## How it reaches a live call or conversation

| Channel | Runs | Read when | Change felt |
|---|---|---|---|
| Web chat (bound widget) | Messaging copy, node by node | The current copy | After promote |
| API chat | Messaging copy, text runtime | Each turn; the on/off switch at each open | After promote |
| Texts on a bound number | Messaging copy, text runtime | Each turn | After promote |
| Number texting config | The number row | Each message and timer | Immediately, every environment |
| Widget record (domains, look, timers) | The widget row | Page load and new threads | Immediately |
| Voice calls (for contrast) | Pinned version | Call start | Next call after promote |

Rules that follow from the table:

- **No version pin on text channels.** Web chat, API chat and texts run
  production. Publishing to staging does not reach them, and a traffic split
  between versions applies to calls only.
- **Open threads move with production.** Each turn reads the current copy,
  so a promote reaches an open text or API chat thread on its next message.
  The thread keeps its history and variables.
- **A production number attach can put unpromoted edits on texts and API
  chat** until the next promote, because it compiles the latest save. A bound
  widget prevents this: the copy is rebuilt from production right after the
  attach.
- **A number attached in the staging environment** runs staging for calls but
  production for texts.
- **Production variable values** are compiled into the copy. Calls see a
  changed production variable at once; texts and API chat may keep the old
  value until the next promote, unless a widget is bound.
- **Branch saves never reach these channels.**

### The text runtime

`settings.messaging.mode` decides how texts and API chat turns run. Voice and
web chat never read it.

```text
 mode = "pathway" ---------------------------------> node by node, like voice
 mode = "reasoning" (default when absent)
     |
     +-- Agent context lists node-only steps? -- yes -> node by node
     |   (webhook, code or scheduling steps,
     |    tool chains, verification)
     no
     v
  the model reads the Agent context and drives the turn
     |
     +-- turn fails -> that one message is answered node by node
```

The Agent context is a compiled summary of the agent per channel. Read it with
`GET /v2/agents/<agent id>/brief?channel=<sms|imessage|rcs|whatsapp>&version=<semver>`
(omit `version` for the dev head). API chat reads the SMS one. Its
`pathwayOnly` list names what forces node-by-node turns. So a text can behave
differently from a call on the same version.

Behavior settings under `settings.messaging` apply to the reasoning runtime:
`reasoningEffort` (`low`, `medium` default, `high`), `website` (https, where
web lookups start), `computerUse` (`auto` default; only on the company
website, so off without one) and `progressUpdates` (`auto` default; plain SMS,
RCS and WhatsApp never get one on `auto`).

## On the dashboard

| Page | Shows | Can do |
|---|---|---|
| Channels > Web chat `/dashboard/agent/<agent id>/channels/chat` | The agent's widgets, Live or Draft, domains | Open the editor |
| Widget editor `.../channels/chat/<widget id>` or `/new` | Backing (prompt, pathway or agent), domains, rate, webhook and its mode (every message or end of conversation), timeouts (24 hours default; a warning defaults to 10 minutes), appearance with live preview, embed snippet, components | Create, bind to the agent, publish, unpublish, delete |
| Channels > API chat `.../channels/api-chat` | The switch, copyable open and message requests | Turn the switch on the dev head |
| Channels > Messages `.../channels/messages?phoneNumber=` | Number picker, per-number texting settings, WhatsApp, A2P card, channel priority, Behavior, Agent context | Edit the number (live), edit Behavior (versioned) |
| Conversations `/dashboard/conversations`, agent `.../conversations` | Calls, texts, web chat and API chat threads; filter `channel` = `phone`, `web_voice`, `web_chat`, `sms`, `rcs`, `imessage`, `whatsapp`, `api_chat`; `focus` opens one | Take over, reply as a person, Return to agent, End conversation, retry a failed text |

Notes:

- **Web chat pages are not environment-scoped.** Widgets are not versioned,
  so they stay editable in every environment.
- **Messages has two kinds of setting.** Number settings save to the number
  and change live traffic at once; the page banner says so. Behavior is agent
  config, saved with the version and felt after promote.
- **The API chat switch saves to the dev head.** It is locked when viewing
  Staging or Production. The open reads production, so a switch flipped after
  the first promote does nothing until the next one.
- **The A2P card status is kept in the browser.** Report
  `GET /v1/messaging/a2p` instead.
- **Channel priority is display-only.** Nothing reads it.
- **The Messages tab is hidden** unless the org can text: an enterprise org,
  or an active phone plan that includes texting. iMessage and RCS need
  enterprise; WhatsApp needs its own access.
- **The takeover panel** shows on text and API chat threads, not web chat.
  Replying without taking over lets the agent keep replying.
- **Dashboard-only:** the widget's live appearance preview and the voice
  button a dashboard-created widget gets.
- **After an API write**, none of these pages refresh themselves. Say "Saved
  through the API. The page shows it after a refresh."

## Rules and limits

| Rule | Value or behavior | Error when crossed |
|---|---|---|
| API chat switch | `settings.apiChat.enabled` on production, else latest save | 403 `CHANNEL_DISABLED` |
| API chat idle end | 1800 seconds default, `0` off, whole numbers | 400 `CHAT_BAD_REQUEST` |
| API chat message | 8,000 characters; empty asks for the greeting | 400 `CHAT_BAD_REQUEST` |
| API chat `end_user_id` | 1 to 255 characters; one open at a time per person | 409 `CHAT_OPEN_IN_PROGRESS` |
| API chat reply wait | About 90 seconds, then returns what it has | Empty `messages`, read `status` |
| Text idle end | Thread `time_out`, else the number's, else none; positive values under 30 seconds become 30 | None; raised silently |
| Idle clock | Counts from the agent's last reply; paused during takeover | |
| Reminder | `warning_time` below `time_out` | 400 `INVALID_TIMEOUT_CONFIG` on send; 500 `ERROR_UPDATING_SMS_CONFIG` on number update |
| Reply as a person | 1 to 1,600 characters; `Idempotency-Key` makes retries safe | 400 `INVALID_PARAMETER` |
| Hand back | `message` or `generate_reply`, not both | 400 `INVALID_PARAMETER` |
| Takeover, reply, hand back, end, trigger | Enterprise orgs | 403 `ENTERPRISE_REQUIRED` |
| Send, number update | Enterprise, or an active phone plan with texting (SMS only) | 403 `ENTERPRISE_REQUIRED` |
| Phone plan sends | US and Canada numbers; a daily allowance | 400 `CALL_PLAN_DESTINATION_BLOCKED`, 429 |
| Reply as a person, hand back with a message | A billing record and credit | 402 `BILLING_RECORD_REQUIRED`, `INSUFFICIENT_CREDITS` |
| Widget domains | Site host equals a listed domain; case and `www.` ignored; empty list = off | 403 `Origin not allowed` |
| Widget webhook | HTTPS | 400 `INVALID_WEBHOOK_URL` |
| Widget backing | Exactly one of `pathway_id`, `agent_prompt` | The write fails |
| Widget idle end | `config.timeoutSeconds`, 24 hours default | |
| Live agent message | Thread must be open; translated into the thread's language | 400 `THREAD_ENDED` |
| Bind | Production must compile | 422 `COMPILE_FAILED` |
| Agent delete | Refused while a widget runs the agent | "This agent runs a web chat widget. Switch the widget to a prompt or pathway, then delete the agent." |
| Thread list | `/v1/sms/conversations` up to 1,000 per page; `/v1/widget/threads` up to 100 | |
| Reasoning context | The Agent context page notes the last 30 messages go with each turn | |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| Texts or chat ignore a change | Saved but not promoted | Production `current_version` older than the dev head | Promote |
| Texts run an unpromoted edit | A production number attach compiled the latest save | Recent attach, no promote since, no widget bound | Promote, or bind a widget |
| Calls changed after promote, texts did not | Copy refresh failed: production cannot be prepared | The production version fails validation or has an unresolved production variable | Fix production, promote again |
| API chat 403 `CHANNEL_DISABLED` | Switch on dev only | `settings.apiChat.enabled` differs between dev head and production | Promote |
| API chat reply `messages` empty | Folded into a reply already being written, handed off, or ended | `status` in the response | Read `GET /v1/chat/<id>` |
| API chat body has `error: AGENT_TURN_FAILED` | The turn failed, possibly after a tool already ran | `GET /v1/chat/<id>`, and the system the tool writes to | Resend with a new `idempotency_key` only once the write is known not to have happened, or the user approves a repeat. The same key returns the failed turn |
| No bubble on the site | Unpublished, or host not listed | `allowed_domains` empty or missing the host | PATCH domains with the full `config` |
| Widget lost its colors | PATCH sent a partial `config` | `config` missing `styles` and colors | Restore from the earlier read |
| Agent silent on a text thread | Thread in takeover, or closed | `human_handoff_at`, `is_active` on the thread | Hand back, or let the next text open a new thread |
| Number never answers texts | Not bound, or its texting setup missed | Number absent from `/v2/agents/<id>/inbound`, or absent from `/v1/sms/numbers` | Attach it; re-save its texting config |
| Outbound texts fail in the US | No approved A2P registration | Failed `status` on messages; `/v1/messaging/a2p` | Finish A2P |
| Text replies differ from calls | Reasoning runtime, not node by node | Messages > Agent context; `pathwayOnly` | Expected; set `mode: "pathway"` to match voice |
| Staging number texts run production | Texts always run the copy | Number environment is staging | Expected; test texts with test chat or a production number you own |
| Number prompt edits do nothing | Number is bound to a v2 agent | Number in the agent's inbound list | Edit the agent and promote |
| Takeover button refused for a plan org | Takeover routes need enterprise | 403 `ENTERPRISE_REQUIRED` | Enterprise only |

## Questions people ask

**Which version answers my texts?** Production. A production number attach
can run the latest save until the next promote.

**Can I pin a widget or API chat to a version?** No. Promote to change them.
For a pinned probe that reaches nobody, use test chat.

**Does changing the number's settings need a promote?** No. Number settings
are live in every environment at once and are not versioned.

**Why does the agent text differently than it talks?** Texts and API chat use
the reasoning runtime by default; calls and web chat walk the graph node by
node. Read Messages > Agent context.

**Does a promote reach a thread that is already open?** Yes, on its next
message.

**How long does a conversation stay open?** API chat: 30 minutes idle by
default. Texts: the thread's or number's `time_out`, else open until ended.
Web chat: the widget timeout, 24 hours by default.

**Can a person take over an API chat?** Yes, with the same takeover routes as
texts. The reply reaches the customer's app with role `human` in the next
`/messages` response or `GET /v1/chat/<id>`.

**Do API chats share memory with calls?** Yes, when the open passes `contact`
with a phone number or email that matches the person.

**Does the widget do voice?** A widget created on the dashboard may show a
voice button. Its voice runs separately from the bound agent's chat. A widget
created through the API without `agent_id` is chat only.

**Is API chat a test?** No. Tools, webhooks, the summary and memory all run
for real.

## Identity

### What identity is

Configure > Identity (`/dashboard/agent/<agent id>/configure/identity`) is how
the agent's business looks to the people it texts and calls. It has four
parts:

- **Contact card**: display name, logo, tagline, support email, website,
  address and the agent's number. It becomes a contact file (vCard) a phone
  can save.
- **VCF delivery**: texts that card once to each person, with the first SMS
  or iMessage reply the agent sends them while the switch is on.
- **Branded caller ID**: an application to the carriers to show the business
  name, logo and call reason on outbound calls to T-Mobile and Verizon
  subscribers.
- **RCS contact card**: a verified RCS sender for one of the agent's numbers,
  so messaging apps show the business name, logo and color.

It is not:

- **A2P registration.** That is org-wide, on Channels > Messages
  ([A2P](messaging.md#a2p-registration)).
- **The caller ID number.** Which number a call comes from belongs to
  [phone-numbers](../../phone-numbers/SKILL.md).
- **Part of a version.** Promote, rollback and environments never touch it.

The tab shows only when the org can text: an enterprise org, or an active
phone plan with texting. The old path `/dashboard/agent/<agent id>/identity`
redirects to it.

### Identity objects

```text
 AGENT IDENTITY (one per agent, live)           PHONE NUMBER (each one)
 +---------------------------------------+      +--------------------------+
 | card fields + logo                    |      | RCS sender               |
 |   -> contact file, rebuilt on change  |      |  name, logo, color,      |
 | vcf_delivery_enabled --> texts card   |      |  description (locked     |
 | rcs_enabled -----------> RCS or SMS --+----> |  after submit)           |
 | bcid_enabled + application -> calls   |      |  registrations, test     |
 | phone_numbers (newest attached first) |      |  devices, status         |
 +---------------------------------------+      +--------------------------+
```

Card, switches and branded caller ID belong to the agent. An RCS sender
belongs to the number: set up each number on its own. The logo is shared: the
card embeds it, an RCS sender copies it when its profile is saved, and a
branded caller ID application records it when submitted.

### Identity states

Branded caller ID, `bcid_status`:

```text
 not_submitted --submit--> submitted --enters carrier review--> pending_review
                                                                  |        |
                                                                  v        v
                                                              approved  rejected
```

| Status | Means | What to do |
|---|---|---|
| `not_submitted` | No application | Apply |
| `submitted` | Bland has it; carrier review has not started. Bland may complete it with the carriers first | Wait; contact support if it stays. A second submit makes a second application |
| `pending_review` | With the carriers | Wait. A new submit needs `resubmit: true` and restarts review |
| `approved` | The carriers approved | Keep the switch on. A new submit needs `resubmit: true` and restarts review |
| `rejected` | The carriers declined | Fix the name or reason, then submit a new application |

RCS sender, by the page's labels:

```text
 Not set up -> Creating -> Draft --submit--> In review -> Pending verification -> Online
               (profile editable)        (branding locked from here on)          |
                                                         attached to messaging <-+
 Offline or Stubbed: not live; contact support
```

The page's Google registration (every sender) and US registration (when the
destination is the United States) are filed from Draft and lock when filed.
Their badge shows what was filed, not a later decision: report the sender
status. An Online sender is attached to the number's messaging on the next
status check, or with the wizard's Attach.

### How identity reaches texts and calls

| Part | Read when | Change felt |
|---|---|---|
| Card fields, logo | The contact file is rebuilt on save | Next card sent. People who already got one keep the old card |
| VCF delivery | After each SMS or iMessage reply or opener the agent writes, while the switch is on | Once per agent and recipient number, ever, so someone texted before the switch went on gets it with the agent's next reply. Never on RCS, WhatsApp, API chat or web chat, and not for a text you send with fixed wording |
| RCS contact card switch | Each outbound text on the agent's numbers | Within about a minute. Off: plain SMS, sender kept. On: RCS when the sender is Online and attached and the handset supports RCS |
| RCS sender profile | Saved while Draft | Locked at submit; the handset shows it once Online |
| Branded caller ID | Each outbound call | The carriers brand calls from the approved numbers. Bland marks a call `branded_caller_id: true` in its metadata while the switch is on and the application is approved (within about a minute) |

The card's phone number is the agent's newest attached number. A card sent by
VCF delivery shows in the thread as "Contact card: <name>" and is billed as a
message.

### Identity timelines

| Wait | How long | How to check |
|---|---|---|
| Branded caller ID review | Page estimate: T-Mobile about 5 to 7 business days, Verizon about 7 to 10; each number and carrier separately | `GET /v2/agents/<id>/identity/bcid`; the page re-checks every 30 seconds while pending |
| RCS approval | About a week (page estimate) | `GET /v1/messaging/rcs/<number>` re-checks at most once a minute; `?refresh=true` now |
| RCS test device | Until the person accepts on the phone | Refresh in the wizard's Test devices step |
| A switch | About a minute | |
| `logo_url`, `vcf_url` | Expire after about an hour | Read the identity again |

### Identity limits

| Rule | Value | Error |
|---|---|---|
| Display name | Required, up to 80 characters | 400 `display_name is required` |
| Tagline, email, website, address | 140; 254 and a valid email; 2,048 and `http(s)`; 300 | 400 naming the field |
| Logo | PNG or JPEG, up to 2 MB; the page asks for a square at least 224 px | 400 |
| Identity writes | A role that can edit agents | 403 |
| Branded caller ID | Name up to 30, reason up to 60, a listed category, numbers bound to this agent, `tmobile` and/or `verizon`, `attest: true` | 400 naming the field; AT&T is not covered |
| Replace an application | Only `pending_review` or `approved`, with `resubmit: true` | 409 `BCID_ALREADY_SUBMITTED` |
| Test card | E.164 recipient; `sms`, `imessage` or `rcs`; billed; 5 per minute per agent | 400, 402, 409 with a code, 429 |
| RCS profile | Editable only while Draft | 409 "branding locks once submitted for review" |
| RCS registrations | Google before US | 400 |
| RCS test devices | Up to 20 on the page; before Online only an accepted device receives | 409 `RCS_SENDER_NOT_READY` |
| RCS go-live | Online, and the number has its own messaging service on its texting config | 409 until Online; 400 naming the shared messaging service |
| OAuth connection | Identity and RCS routes refused | `oauth_path_not_allowed` |

### When identity goes wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| No Identity tab | The org cannot text | The Messages tab is hidden too | Enterprise, or a phone plan with texting |
| Apply and Set up buttons disabled | No number bound | `phone_numbers` empty | Attach a number |
| Some people never got the card | They got one before, the thread is RCS or WhatsApp, or the agent has not replied to them since the switch went on | "Contact card:" rows in their threads; `vcf_delivery_enabled` | Expected; send a test to see the card |
| People have the old card | Edits reach new recipients only | | Expected |
| Texts arrive as plain SMS, no logo | Sender not Online or not attached, switch off, or no RCS on the handset | Sender `status`, `attached`; `rcs_enabled` | Finish review; attach; turn the switch on |
| RCS branding cannot be edited | Submitted for review | Status past Draft | Locked on this sender; contact support |
| Attach refused, naming the shared messaging service | The number has no messaging service of its own | The error | Contact support |
| Test card 409 `RCS_SENDER_NOT_READY` | Sender not Online and the recipient is not an accepted test device | `test_devices` | Add the device, accept it on the phone, refresh |
| Test card 409 `IMESSAGE_NOT_CONFIGURED` | None of the agent's numbers has iMessage on | Channels > Messages | Turn iMessage on for a number |
| Branded caller ID stays `submitted` | Not yet in carrier review | `bcid_submission.evaluation.failures` may list unmet requirements | Contact support; do not submit again |
| Branded caller ID `rejected` | Often a display name far from the legal business name | `bcid_submission` | New application with a name close to the legal name |
| No business name on calls | Not approved, switch off, number not in the application, or the recipient is on another carrier or a phone that does not show branding | `bcid_status`, `bcid_submission.phone_numbers`, the call's `branded_caller_id` | Finish review; apply with the number. Display is the carrier's decision |
| Submit 409 `BCID_ALREADY_SUBMITTED` | An application is in review or approved | `bcid_status` | Replace only with a confirm and `resubmit: true` |

### Identity questions

**Does identity need a promote?** No. It is live as soon as it saves, in
every environment.

**Is it per agent or per number?** The card, switches and branded caller ID
are per agent. An RCS sender is per number.

**Can I undo a branded caller ID or RCS submission?** Not from here. A new
branded caller ID application replaces the old one and restarts review. A
submitted RCS sender's branding is locked.

**Does turning off branded caller ID stop branding?** It stops Bland marking
calls as branded. It does not withdraw the approved application; ask support.

**Why do some people get a contact card and others not?** Each person gets it
once, with the first SMS or iMessage reply the agent sends them while the
switch is on. RCS shows the verified sender instead.

**Does the test card count as that person's card?** No. A person who got a
test still gets the card from VCF delivery later.
