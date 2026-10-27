# Web chat widget

A widget is an org record that puts a chat bubble on the customer's website.
Bound to a v2 agent, it runs the agent's **production** version. It has no
version pin and no per-request override, so a change reaches the widget only
when it is promoted or rolled back. A number attach does not move it: while a
widget is bound, the agent's compiled copy is rebuilt from production right
after any attach. If the agent was never promoted, the widget runs the latest
saved version. [How it works](how-it-works.md) explains the compiled copy.

## Contents

- [Routes](#routes)
- [Create an agent-backed widget](#create-an-agent-backed-widget)
- [Bind](#bind)
- [Publish and unpublish](#publish-and-unpublish)
- [Embed snippet](#embed-snippet)
- [Threads and live replies](#threads-and-live-replies)
- [Traps](#traps)

## Routes

All bodies are JSON. Reads use `bland_api_get`; writes use `call_bland_api`.

| Method and path | Body | Effect |
|---|---|---|
| `GET /v1/widgets` | none | Every widget in the org. Keep rows where `config.agentV2Id` is the agent. |
| `GET /v1/widget/<widget id>` | none | One widget. 404 `NOT_FOUND`. |
| `POST /v1/widget` | `allowed_domains` and `messages_per_minute` required; `name`, `pathway_id` or `agent_prompt`, `webhook_url`, `config` | Creates it. Unknown keys are a 400 `INVALID_PARAMETER`. |
| `PATCH /v1/widget/<widget id>` | any of the create keys | Edits it. `config` is **replaced whole**. |
| `DELETE /v1/widget/<widget id>` | none | Removes it. The embed stops loading on the customer's site. |
| `POST /v2/agents/<agent id>/widgets/<widget id>/bind` | none | Runs the widget on the agent's production version. |
| `GET`, `POST`, `PATCH /<id>`, `DELETE /<id>` on `/v1/widget/custom_components` | component | Chat UI components tied to pathway nodes. Rarely needed. |

Body rules:

- Exactly one of `pathway_id` and `agent_prompt` must be set. Both or neither
  fails the write.
- `webhook_url` must be HTTPS, else 400 `INVALID_WEBHOOK_URL`.
- `messages_per_minute` is the widget's chat rate limit, a number of 0 or more.
- `agent_id` on a widget is a legacy voice id, not the v2 agent. Leave it alone.

## Create an agent-backed widget

Create it unpublished, with a placeholder prompt to satisfy the one-of rule.
The bind replaces the prompt with the agent.

```json
{
  "name": "<widget name>",
  "agent_prompt": "Placeholder until the agent is bound.",
  "allowed_domains": [],
  "messages_per_minute": 10,
  "config": {
    "published": false,
    "allowedDomains": ["<customer domain>"]
  }
}
```

## Bind

`POST /v2/agents/<agent id>/widgets/<widget id>/bind`, no body.

- 200 `{agent_id, widget_id, pathway_id}`. The widget's `pathway_id` now
  points at the agent's compiled production version, `agent_prompt` is
  cleared, and `config.agentV2Id` is set.
- 404 `WIDGET_NOT_FOUND` or `AGENT_NOT_FOUND`.
- 422 `COMPILE_FAILED`: the production version does not compile. Fix the agent
  ([v2-lifecycle](../../v2-lifecycle/SKILL.md)), then bind again.
- While a widget is bound, deleting the agent is refused. Unbind by a PATCH
  that keeps exactly one backing: `{"pathway_id": "<other pathway>"}`, or
  `{"pathway_id": null, "agent_prompt": "<prompt>"}`. Setting only
  `agent_prompt` leaves both set and the write fails.

## Publish and unpublish

`allowed_domains` is the live switch. An empty list refuses every site, so the
widget is off. `config.published` and `config.allowedDomains` are what the
dashboard shows; keep them in step.

1. Read the widget. Keep its whole `config`.
2. PATCH with the domains and the full config, changed in place:

```json
{
  "allowed_domains": ["<customer domain>"],
  "config": {
    "agentV2Id": "<agent id>",
    "published": true,
    "allowedDomains": ["<customer domain>"],
    "styles": {}
  }
}
```

The `config` above is a shape, not a body to send: send every key the read
returned, with only `published` and `allowedDomains` changed. A partial
`config` wipes colours, header, timeouts and stored styles.

Unpublish: the same PATCH with `"allowed_domains": []` and
`"published": false`. Keep `config.allowedDomains` so republishing restores it.

Domain matching: the site's host must equal a listed domain. Case and a
leading `www.` are ignored. A subdomain needs its own entry. A site that is
not listed gets 403 `Origin not allowed` and shows no bubble.

## Embed snippet

The customer pastes this into every page that should show chat:

```html
<script>
  window.blandSettings = {
    widget_id: "<widget id>"
  };
</script>
<script src="https://widget.bland.ai/loader.js" defer></script>
```

- `api_domain: "<api host>"` goes inside `blandSettings` only when the
  workspace is not the production API. Production needs no `api_domain`.
- Size is set per site, inside `blandSettings`:
  `styles: { dimensions: { panel: { width: 420, height: 700 } } }`.
  Without it the panel is 380 by 600.
- There is no API key in the snippet. Never put one there.

## Threads and live replies

- `GET /v1/widget/threads?agent_id=<agent id>&limit=<n>&cursor=<last id>`:
  web chat threads for the agent. `sort_by` is `created_at` (default) or
  `last_message_at`; `sort_dir` is `desc` (default) or `asc`.
- `GET /v1/widget/threads/<thread id>/messages`: one thread.
- `POST /v1/widget/<widget id>/threads/<thread id>/webhook` with
  `{"type": "MESSAGE", "content": "<text>", "sender_id": "<rep name>"}` shows a
  live reply to the visitor; `{"type": "END_CONVERSATION"}` ends it. A message
  is translated into the thread's language when it is not English. An ended
  thread answers 400 `THREAD_ENDED`. This speaks to a real person: use the
  confirm template first.
- Idle end: `config.timeoutSeconds` (24 hours when unset) counted from the
  last message, with optional `config.timeoutWarningSeconds`,
  `config.timeoutWarningMessage` and `config.timeoutMessage`. The timer does
  not end a thread a live agent holds.
- Deleting a widget keeps its past threads stored.

## Traps

- Web chat runs the compiled pathway turn by turn. `settings.messaging.mode`
  does not apply to it.
- The snapshot's `settings.webChat` fields do not configure the widget. Title,
  greeting, domains and appearance live on the widget record.
- A promote refreshes what the widget runs. A publish to staging does not.
