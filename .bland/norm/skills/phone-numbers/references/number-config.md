# Per-number settings

A number row carries settings of its own, apart from the agent that answers
it. POST `/v1/inbound/<number>` writes them. It is a wide legacy writer with
destructive branches, so send only the safe keys below, and only the ones the
user changed.

## Live, not versioned

```text
  agent version (snapshot)                number row (/v1/inbound/<number>)
  ├─ saved, published, promoted           ├─ written by one POST
  ├─ settings.voiceCall: max duration,    ├─ fallback, transfers, webhook,
  │  voicemail, recording floor, keywords │  language, timezone, request data,
  └─ protected by the release flow        │  metadata, dynamic data, redaction
                                          └─ live on every call, at once,
                                             in every environment
```

- A change to a number row reaches the next call to that number. No publish
  or promote protects it, and no version keeps the old value. Read the row
  first and quote the old value in your reply, so the user can restore it.
- Call behavior that lives in the agent version (voicemail, max duration,
  recording, transcription keywords) is changed with a version save, not
  here. See [v2-lifecycle](../../v2-lifecycle/SKILL.md). An agent value
  left at its default does not override the number's own value; see the
  [merge table](how-it-works.md#how-it-reaches-a-live-call-or-conversation).
- `settings.voiceCall.fallbackNumber` in the agent version is read by no call
  path. The number's `fallback_number` is the only fallback field calls use,
  and only while the platform's inbound fallback is switched on: then calls to
  the number go straight to it instead of the agent. It is not a failover for
  an agent error. Never promise that it rings when the agent fails.

## The safe keys

Send only these 13. `null` clears a key.

| Key | Value | Notes |
| -- | -- | -- |
| `fallback_number` | E.164 string or `null` | See above. Not validated. |
| `transfer_phone_number` | E.164 string or `null` | Must be E.164; checked against the do-not-call list. |
| `transfer_list` | object of label to E.164, or `null` | Each value checked as above. |
| `webhook` | URL or `null` | Post-call webhook for calls on this number. |
| `webhook_events` | array of event names, or `null` | Stored only when `webhook` is sent in the same body. Unknown events are dropped. |
| `language` | language code, or `null` | `null` restores "not chosen", so the agent's language applies. |
| `timezone` | IANA name, or `null` | |
| `request_data` | object, or `null` | A non-object is dropped with a 200. Always send an object. |
| `metadata` | object, or `null` | |
| `dynamic_data` | array of request definitions, or `null` | |
| `redaction` | array of category names, or `null` | `null` turns redaction off. |
| `stream_post_transfer_transcript` | boolean | |
| `skip_url_update` | boolean, or `null` | Leave it alone unless the user asks. See below. |

`label` is also accepted and is safe: it only renames the number.

Example, changing only the transfer destination:

```json
{ "transfer_phone_number": "+15550100000" }
```

## Destructive branches

Never send these keys to a number bound to a v2 agent or a persona:

- `prompt` (any value) or an explicit `pathway_id: null` clears the number's
  direct pathway binding, its graph and its start node. A v1 pathway number
  stops answering.
- A `pathway_id` value binds a v1 pathway and clears `prompt`,
  `first_sentence`, tools, `temperature`, `transfer_list`, `model` and
  `transfer_phone_number`.
- `voice`, `tools`, `model`, `first_sentence` and the other legacy agent
  fields belong to numbers that run without an agent. On an agent's number,
  change the agent instead.

Never send the whole row back. A read-modify-write of every field triggers
the branches above.

## Carrier side effect

On a number bought through Bland or imported from Twilio, each POST also
rewrites the number's voice webhook at the carrier, unless the row has
`skip_url_update: true`. On an imported number that is the customer's own
Twilio account. A customer who routes the number through their own Twilio
setup sets `skip_url_update: true` on purpose. Never flip it without being
asked.

## Read back

After the POST, `bland_api_get` `/v1/inbound/<number>` and quote the changed
keys. The response's `updates` lists what was written; a key you sent that is
missing there was ignored. Then say: "Saved through the API. The page shows
it after a refresh."
