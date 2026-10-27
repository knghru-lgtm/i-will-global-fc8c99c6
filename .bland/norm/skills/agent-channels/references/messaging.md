# Messaging: texts on a bound number

SMS, iMessage, RCS and WhatsApp threads run on a number bound to the agent.
The number's own settings are live and not versioned. What the agent says is
owned by the agent's production version.

## Contents

- [Which number](#which-number)
- [Number settings](#number-settings)
- [WhatsApp](#whatsapp)
- [A2P registration](#a2p-registration)
- [Read threads](#read-threads)
- [Send, take over, hand back](#send-take-over-hand-back)
- [How a text turn runs](#how-a-text-turn-runs)
- [Why a channel is silent](#why-a-channel-is-silent)
- [Display-only and destructive](#display-only-and-destructive)

## Which number

1. On the Messages page, `phoneNumber` in the URL search is the number.
2. Otherwise `bland_api_get` `/v2/agents/<agent id>/inbound`: `numbers` are
   the bound numbers, `pathway_id` is the agent's compiled pathway (used to
   scope threads below).
3. `GET /v1/messaging/numbers` lists the org's messaging-capable numbers with
   the `agent_id` each serves.

Attaching or moving a number belongs to the phone-numbers skill.

## Number settings

`POST /v1/sms/number/update` with `{phone_number, channel, ...fields}`.
`channel` is `sms` (default), `whatsapp` or `imessage`. A number on the
iMessage provider is saved as `imessage` even when `sms` is sent.

Read first: `bland_api_get` `/v1/sms/numbers?channel=<channel>` returns the
numbers with a row for that channel, and the row.

The write takes effect at once, in every environment. It is not versioned
and promote does not touch it. Send only the fields that change; the others
keep their values.

| Field | Meaning |
|---|---|
| `webhook` | URL for message and status events on this number. |
| `time_out` | Idle seconds before a thread ends, counted from the agent's last reply. A positive value under 30 is raised to 30. `0` or `null` turns it off. A thread started by `/v1/sms/send` with its own `time_out` uses that instead. |
| `warning_time`, `warning_message` | Reminder before the end. `warning_time` must be less than `time_out`; otherwise the update fails with 500 `ERROR_UPDATING_SMS_CONFIG`. |
| `timeout_message` | Sent when the thread ends on idle. |
| `request_data` | Variables every thread on this number starts with. |
| `messaging_service_sid` | Bring-your-own-carrier numbers only. Saving it starts a registration with the carrier service. Confirm it with the user character by character. |

On a number bound to a v2 agent, the prompt, objective, pathway, tools and
temperature fields are ignored: the agent version wins. Change the agent,
never the number.

Errors: 400 `INVALID_CHANNEL`, 400 `PHONE_NUMBER_REQUIRED`, 404
`INBOUND_NUMBER_NOT_FOUND`, 403 `ENTERPRISE_REQUIRED`. The update is open to
enterprise orgs and to orgs on an active phone plan that includes texting;
the plan covers `channel: "sms"` only.

Re-saving a bound number's SMS config also repairs its texting setup when an
attach left the number unable to receive texts.

## WhatsApp

WhatsApp is for enterprise orgs with WhatsApp access. When the Messages page
shows no WhatsApp option, the org does not have it; say so and stop.

A number is set up for WhatsApp exactly when it appears in
`/v1/sms/numbers?channel=whatsapp`. Configure it with the same update and
`"channel": "whatsapp"`: `webhook`, `time_out`, `request_data`. WhatsApp has
no SMS fallback.

## A2P registration

US texting from a standard long code needs an A2P 10DLC brand and campaign.

- Status: `bland_api_get` `/v1/messaging/a2p`. It returns the stored
  registration and, when available, `brand_live_status` from the carrier
  registry. **This is the status to report.** The card on the Messages page
  is kept in the browser and can read approved before the carrier decides.
- Draft: POST `/v1/messaging/a2p/register` with `brand`, `campaign` and
  `linked_number_ids` and **no** `brandDetails` saves the form only.
- Submit: the same POST with `brandDetails` registers the brand with the
  carrier registry, and the campaign when `campaign` is present. It needs
  `brandDetails.businessName` and `brandDetails.ein` (else 400). Vetting takes
  days, carries fees and cannot be withdrawn here. Use the REQUIRED confirm.
- Never submit twice. After any error, read the status first. A stored
  `brand.registration_sid` means a brand exists; a second submit registers a
  duplicate.
- Use `/v1/messaging/a2p` only, not the older `/v1/sms/a2p/*` routes.

## Read threads

`bland_api_get` `/v1/sms/conversations` with:

- `filters`: a JSON array string of `{field, operator, value}`. Operators
  include `equals`, `not`, `in`, `notIn`, `contains`, `gt`, `lt`.
- `mode`: `AND` (default) or `OR`. It applies to every filter, so keep `AND`
  when one filter is a scope.
- `limit` (up to 1000), `from`, `sort_by` (`created_at`, `updated_at`,
  `last_message_at`, `message_count`), `ascending`.

Scopes:

| Want | Filter |
|---|---|
| This agent | `curr_pathway_id` `equals` the `pathway_id` from `/v2/agents/<agent id>/inbound` |
| iMessage, WhatsApp | `channel` `equals` `IMESSAGE` or `WHATSAPP` |
| SMS only | `channel` `equals` `SMS` and `effective_channel` `not` `api_chat` |
| RCS, API chat | `effective_channel` `equals` `rcs` or `api_chat` |

One thread: `GET /v1/sms/conversations/<id>` returns the messages with
`sender` and delivery `status`. Its webhook log:
`GET /v1/sms/conversations/<id>/webhook`.

## Send, take over, hand back

All of these text a real person. Use the REQUIRED confirm and quote the from
number, the recipient and the exact text. Takeover, reply, hand back, end and
`trigger` need an enterprise org (403 `ENTERPRISE_REQUIRED`); `/v1/sms/send`
also accepts an active phone plan with texting, for SMS to US and Canada
numbers. A reply, or a hand back that sends, can answer 402
`BILLING_RECORD_REQUIRED` or `INSUFFICIENT_CREDITS`. The takeover routes work
on API chat threads too: the reply reaches the customer's app with role
`human`.

| Step | Route | Body |
|---|---|---|
| Take over | `POST /v1/sms/conversations/<id>/handoff` | `{reason?, metadata?, webhook?, notify_number?, actor?}`. The agent stops replying. `notify_number` gets a text too. |
| Reply as a person | `POST /v1/sms/conversations/<id>/messages` | `{"message": "<text>", "sender": "HUMAN"}`, at most 1,600 characters, header `Idempotency-Key`. 202 `{status: "processing", message_id, human_handoff_active}`. |
| Hand back | `POST /v1/sms/conversations/<id>/resume` | `{node_id?, message?, generate_reply?, actor?}`. `message` is sent as the agent; `generate_reply: true` has the agent write one. Not both (400). With neither, nothing is sent. |
| Close | `POST /v1/sms/conversations/<id>/end` | `{reason?, actor?}` |

Take over before replying, so the agent does not answer over the person.
While taken over, the idle timer is paused and inbound texts still reach the
webhook. Taking over an ended or timed-out thread reopens it. After an end,
the person's next text starts a new thread.

Start a new thread: `POST /v1/sms/send` with `user_number`, `agent_number`
(the bound number) and optionally `agent_message`, `request_data`,
`metadata`, `webhook`, `new_conversation`. The agent then answers replies on
its own. Leave out the pathway and persona overrides so the bound agent
answers.

`POST /v1/sms/trigger` with `{user_number, agent_number, user_message}`
injects a customer message and **texts the agent's reply to `user_number`**.
Use it only with a number the user owns, as a live test.

A text to many people is a batch: build the list with
[analytics-cohorts](../../analytics-cohorts/SKILL.md), then create the batch
on `/dashboard/batches`. Never loop `/v1/sms/send`.

## How a text turn runs

Texts run the agent's compiled copy of production, refreshed on each promote
and rollback. A publish to staging does not reach texts. Two exceptions:

- A production number attach compiles the latest save into the copy, so
  texts can run unpromoted edits until the next promote (unless a widget is
  bound, which pulls the copy back to production at once).
- A number attached in the staging environment answers calls on staging but
  texts on production.

Each turn reads the current copy, so a promote reaches open threads on their
next message. [How it works](how-it-works.md) has the full picture.

`settings.messaging.mode` picks the runtime for texts and API chat (not voice,
not web chat):

- `reasoning` (the default when absent): the turn reads a **brief** compiled
  from the agent. `bland_api_get`
  `/v2/agents/<agent id>/brief?channel=<sms|imessage|rcs|whatsapp>&version=<semver>`
  returns `{version_id, brief}`; omit `version` for the dev head.
- If `brief.pathwayOnly` lists anything (webhook, code or scheduling steps,
  tool chains, verification), that channel runs the pathway node by node
  instead.
- `pathway`: always node by node, as voice does.
- A reasoning turn that fails is answered node by node for that message.

So a text can behave differently from a voice call on the same version. Read
the brief before blaming the graph.

## Why a channel is silent

Check in order; stop at the first failure.

1. **Bound?** The number is in `/v2/agents/<agent id>/inbound` `numbers`.
2. **Promoted?** The behaviour the user expects is in production, not only on
   dev or staging.
3. **Thread state.** `GET /v1/sms/conversations/<id>`: a thread in handoff
   gets no agent replies until resumed; an ended or timed-out thread is
   closed.
4. **Delivery.** Outbound messages with a failed `status`: for US SMS read
   the A2P status.
5. **Runtime.** Read the brief as above when replies are wrong rather than
   missing.

Web chat: the widget is published (`allowed_domains` not empty), the site's
host is listed, and it is bound. API chat: 403 `CHANNEL_DISABLED` means the
production snapshot has `settings.apiChat.enabled` off.

## Display-only and destructive

- `PATCH /v1/messaging/<phone>/settings` with `primary_channel` and
  `delivery_order` (the "channel priority" on the Messages page) is stored
  but nothing reads it. It does not change which channel a text uses. Say so
  rather than setting it.
- `PATCH /v1/sms/conversations/<id>` `{is_active}` closes or reopens a thread.
- `DELETE /v1/sms/conversations/<id>/messages` `{message_ids: [...]}` and
  `DELETE /v1/sms/conversations/<id>` delete history and cannot be undone.
  Use the REQUIRED confirm.
