# API chat

API chat lets the customer's own app hold a text conversation with a v2 agent
over HTTP. It runs the agent's **production** version on the messaging
pipeline, the same turn a text runs. It has no version pin. A production
number attach recompiles the shared copy from the latest save, so API chat
can run unpromoted edits until the next promote, unless a widget is bound.
[How it works](how-it-works.md) explains the copy and the text runtime.

## Contents

- [The switch reads production](#the-switch-reads-production)
- [Routes](#routes)
- [Open or resume](#open-or-resume)
- [Send a message](#send-a-message)
- [End and read](#end-and-read)
- [Side effects](#side-effects)
- [Where the threads show](#where-the-threads-show)

## The switch reads production

`settings.apiChat.enabled` in the agent snapshot is the switch. The open
request reads it from the **production pin**. If production was never pinned,
it reads the latest saved version. The dashboard toggle saves to the dev head,
so after the first promote a toggle does nothing until the next promote.

1. Dev head: `bland_api_get` `/v2/agents/<agent id>/versions/latest`, read
   `snapshot.settings.apiChat.enabled`.
2. Production: `bland_api_get` `/v2/agents/<agent id>/environments`, take the
   production `current_version.semver`, then `/v2/agents/<agent id>/versions/<semver>`.
3. Report both values and which one differs.
4. If dev is off, set it to `true` in the full snapshot from step 1 and save
   with `call_bland_api` POST `/v2/agents/<agent id>/versions`.
5. Promote with POST `/v2/agents/<agent id>/promote`
   ([v2-lifecycle](../../v2-lifecycle/SKILL.md)). Promote ships the whole
   candidate to every channel, voice included. Name the other changes in it
   and confirm first.

A missing `apiChat` key means off.

## Routes

| Method and path | Body | Result |
|---|---|---|
| `POST /v1/chat` | open, below | 200 conversation |
| `POST /v1/chat/<conversation id>/messages` | `{message, idempotency_key?}` | 200 conversation with the turn's replies |
| `POST /v1/chat/<conversation id>/end` | `{reason?}` | 200 conversation with transcript, `already_ended` |
| `GET /v1/chat/<conversation id>` | none | 200 conversation with transcript |

Errors: 400 `CHAT_BAD_REQUEST` (the message names the field, or says the
agent was not found or its production version could not be prepared), 403
`CHANNEL_DISABLED` ("API chat is turned off for this agent."), 404
`CHAT_NOT_FOUND`, 409 `CHAT_ENDED`, 409 `CHAT_OPEN_IN_PROGRESS` (retry
shortly), 409 `CONTACT_CONFLICT`, 500 `CHAT_INTERNAL_ERROR`.

## Open or resume

```json
{
  "agent_id": "<agent id>",
  "end_user_id": "<your user id>",
  "request_data": { "plan": "<plan name>" },
  "metadata": { "source": "<your app>" },
  "time_out": 1800
}
```

- `agent_id` must be a UUID. `end_user_id` is the customer's own id for the
  person, 1 to 255 characters.
- **Resume:** the same `agent_id` and `end_user_id` return the conversation
  still active for that person. `"new_conversation": true` ends it and opens a
  new one.
- `time_out` is idle seconds before the conversation ends. Default 1800 (30
  minutes). `0` turns it off. Whole numbers only; a positive value under 30
  is raised to 30. The clock starts at the open, so a chat nobody writes to
  still ends. Resuming does not push it back.
- `webhook` (http or https URL) receives the message and status events.
  Resuming with a different `webhook` replaces the stored one.
- `contact` `{phone_number?, email?, name?}` links the person to a contact, so
  memory follows them. A 409 `CONTACT_CONFLICT` means those identifiers belong
  to different contacts; merge them first.

The response:

```json
{
  "conversation_id": "<conversation id>",
  "agent_id": "<agent id>",
  "end_user_id": "<your user id>",
  "status": "active",
  "ended": false,
  "created_at": "<iso time>",
  "summary": null,
  "disposition": null,
  "variables": null,
  "metadata": null,
  "messages": []
}
```

`status` is `active`, `human_handoff`, `timeout` or `ended`.

## Send a message

`{"message": "<text>"}`, at most 8,000 characters. An empty or absent
`message` asks the agent for its greeting. Pass `idempotency_key` so a retry
after a lost response returns the original turn instead of running another.

The request waits up to about 90 seconds for the agent's turn and returns the
replies it produced in `messages`, each `{id, role, text, created_at}` with
`role` `user`, `agent` or `human`. An empty `messages` is not an error: the
pipeline folded a quick second message into the reply already being written,
or the turn handed off, timed out or ended, which `status` shows. An `error`
key means the turn failed, possibly after a tool already booked or wrote
something. Read the transcript and check that system before sending again: a
new `idempotency_key` starts a new turn and can repeat the write. Resend only
once the write is known not to have happened, or the user approves a repeat.

A message to an ended or timed-out conversation is 409 `CHAT_ENDED`: open a
new one.

## End and read

End runs the post-conversation analysis and returns the transcript.
`already_ended: true` means it had already ended. `GET` returns the same shape
with every message.

## Side effects

API chat is live, not a test:

- Each turn runs the agent's tools for real, including webhooks and writes.
- Message and status webhooks fire.
- End or timeout runs the summary, plus any legacy dispositions listed in
  the chat's texting config (`disposition_ids`; none by default). The
  agent's own dispositions score completed calls, not chats
  ([dispositions](../../dispositions/SKILL.md)).
- A linked contact gets memory updates.

For a version-pinned probe that sends nothing, use test chat
([v2-testing](../../v2-testing/SKILL.md)).

## Where the threads show

API chat threads are stored with the text threads. List them with
`bland_api_get` `/v1/sms/conversations` and the filter
`{"field": "effective_channel", "operator": "equals", "value": "api_chat"}`
in `filters`. On the Conversations page they are the API chat channel.

A person can take an API chat over and reply as a human with the takeover
routes in [messaging](messaging.md#send-take-over-hand-back). While taken
over, `/messages` returns no agent reply and `status` is `human_handoff`; the
person's reply shows with role `human` on the next read.
