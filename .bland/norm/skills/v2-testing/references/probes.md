# Direct probes: test chat, messaging and phone

Scripted probes against one agent version, outside the simulation API. Each
section names what the probe runs and what it touches outside the platform.
Classify integrations first ([safety before any test](../SKILL.md#safety-before-any-test)).
Do not write fetch scripts and do not search the docs for these routes.

## Contents

- [Test chat (the builder WebSocket)](#test-chat-the-builder-websocket)
- [Messaging preview: version-pinned, sends nothing](#messaging-preview-version-pinned-sends-nothing)
- [API chat: the production messaging path](#api-chat-the-production-messaging-path)
- [Live text: a number the user owns](#live-text-a-number-the-user-owns)
- [Real phone call](#real-phone-call)
- [Tool probes](#tool-probes)
- [Keyless installs](#keyless-installs)

## Test chat (the builder WebSocket)


The socket runs the dev head (or the `version_id` selector) node by node, as
voice does. It does not exercise the messaging brief; use the
[messaging preview](#messaging-preview-version-pinned-sends-nothing) for that.
**Prerequisite:** the host must supply an approved test-chat WebSocket
URL (base and path), a WebSocket-capable connection mechanism, and permission to
use the short-lived token on that target. The plugin's packaged HTTP MCP URL is
not that socket URL and cannot be transformed into one. No socket target is
bundled. If this host configuration is absent, skip direct probes, use platform
simulations, and explicitly report the missing direct-chat coverage.

1. Use the authenticated Bland connection for `GET /v1/pathway/session`, then read `data.token`. Keep the short-lived token out of chat and reports.
2. Use the host's configured test-chat WebSocket base/path, with URL-encoded query parameters `agent_chat=<agentId>&version_id=<selector>&token=<token>`. `version_id` is the public query field and defaults to `latest`; use the intended explicit selector when testing a specific environment or published version. Do not guess a regional hostname or switch connection targets. If the host does not expose a supported connection mechanism, use the simulation API or report that direct socket testing is unavailable.
3. Send `{"type":"setup","payload":{"requestData":[{"key":"from","value":"+15555550100"}]}}`, then `{"type":"text","payload":"<caller turn>"}` per turn.
4. Keepalive: a binary `[1]` frame every ~10s. A `pathway_end_call` close is a real hang-up. `callID` frames give you the call id for log retrieval.

Probes are for scripted mechanics (does the greeting fire, does lane X route, does the AI-disclosure rule hold). Drive fixed turns and inspect relevant, redacted frames plus the call log. A silent socket does not identify the cause: check the supported connection, authentication, target version, and events. Do not switch organizations or endpoints to make a test appear to work.

## Messaging preview: version-pinned, sends nothing

`call_bland_api` POST `/v1/pathway/test_agent/sms/preview`:

```json
{
  "agent_id": "<agent id>",
  "agent_version": "<selector: latest, a semver, or branch:<name>>",
  "message": "<customer text>",
  "channel": "sms",
  "chat_history": [],
  "request_data": { "from": "+15555550100" }
}
```

- Runs the real messaging reply pipeline on the named version (omitted
  `agent_version` means the dev head). It writes no conversation row and
  delivers nothing to a handset.
- It is not side-effect free: webhook and tool steps dispatch for real.
  Classify them before the first turn.
- Returns `data.{messages, conversation_id, agent_version_id, trace, control}`.
  `trace` is set on a brief (reasoning) turn and `null` on a node-by-node
  turn, which tells you which runtime answered. Pass the returned
  `conversation_id` and the growing `chat_history` (`[{role: "user" | "agent",
  message}]`) on the next turn.
- `channel` is `sms`, `imessage` or `whatsapp`.

## API chat: the production messaging path

`POST /v1/chat` `{agent_id, end_user_id, request_data?, new_conversation?}`
opens a conversation, `POST /v1/chat/<conversation id>/messages`
`{message}` sends one turn, `POST /v1/chat/<conversation id>/end` closes it.

- Runs the production twin, not the dev head. It answers 403
  `CHANNEL_DISABLED` unless the production version has
  `settings.apiChat.enabled`.
- Creates a real conversation record. Webhooks fire and tools with side
  effects run. On end, the messaging post-conversation analysis runs (the
  summary, plus any citations or legacy dispositions set on the messaging
  configuration) and the ended webhook fires. The agent's
  [dispositions](../../dispositions/SKILL.md) score completed calls, not
  this conversation. Confirm once before the first message, and use a
  synthetic `end_user_id`.

## Live text: a number the user owns

`POST /v1/sms/trigger` `{user_number, agent_number, user_message, channel}`
injects a customer turn on the agent's number; the agent's reply is **texted
to `user_number`**. Enterprise only. Use it only to prove carrier delivery,
and only to a number the user owns, after the REQUIRED confirm:

```text
About to text <user_number> from <agent_number> as the agent's reply to "<user_message>".
This sends a real text to that phone. Reply "yes" to proceed.
```

## Real phone call

To test inbound voice for real, `create_call` dials the agent's bound number
(`phoneNumber`) with `from` set to a number on the account, and `task`
describing the tester caller. The agent side runs the number's **production
pin**, or its **staging pin** when the number is staging-attached; never the
dev head. Both legs are real calls; the outbound leg is billed. In the dashboard, `create_call`
asks the user to approve. Evidence rules are in [voice testing](voice.md).

## Tool probes

`POST /v2/tools/<tool id>/run`, `POST /v1/tools/run` and
`POST /v1/resources/<resource id>/execute` execute for real. Treat them as
live side effects under the read/write classification. The contract is in the
[tool library reference](../../v2-runtime/references/tool-library.md).

## Keyless installs

A keyless (OAuth) connection refuses `/v1/pathway/session`, the
`/v1/pathway/test_agent/**` routes, `/v1/chat/**`, `/v1/sms/**` and the tool
routes with `oauth_path_not_allowed`. Say which probe is unavailable on this
connection, fall back to platform simulations, and report the gap.
