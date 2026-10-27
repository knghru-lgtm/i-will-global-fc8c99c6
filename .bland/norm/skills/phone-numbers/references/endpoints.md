# Phone number and SIP endpoints

Every route the phone-numbers skill uses, with its body, effect, gate and
exact refusal messages. Reads use `bland_api_get` (query values are
strings). Writes use `call_bland_api` with `method`, `path` and `body`. Do
not write fetch scripts and do not search the docs for these routes.

Gate: **none**, **confirm** (state the change, wait for "yes"), or
**hand-off** (never call; send the user to the dashboard). OAuth: ✓ allowed,
R read-only, ✗ refused with `oauth_path_not_allowed`.

## Contents

- [Ownership reads](#ownership-reads)
- [Agent binding](#agent-binding)
- [Per-number settings](#per-number-settings)
- [Buying numbers](#buying-numbers)
- [Blocked callers](#blocked-callers)
- [Outbound do-not-call list](#outbound-do-not-call-list)
- [SIP](#sip)
- [Imported Twilio numbers](#imported-twilio-numbers)
- [Hand-offs](#hand-offs)
- [Auth limits](#auth-limits)

## Ownership reads

| Route | Returns | OAuth |
| -- | -- | -- |
| GET `/v1/personas` | Every persona with `tags`, `name` and `inbound_numbers[]` (full number rows, including `agent_env_type`) | ✓ |
| GET `/v1/inbound` | `{ inbound_numbers: [...] }`: the org's numbers with `pathway_id`, `fallback_number`, transfer and webhook fields. No `persona_id`, no `label`. | ✓ |
| GET `/v1/inbound/<number>` | One number's row, unwrapped. 404 `"Number not found"` when it is not on the account or its subscription is not active. | ✓ |
| GET `/v2/agents/<agentId>/inbound` | `{ agent_id, persona_id, pathway_id, numbers: [{ phone_number, agent_env_type }], staging_attach_supported }`. `agent_env_type` is `"staging"` or `null` (production). Both ids are null before the first attach. | ✓ |

Owner rules, in order:

1. A persona whose `inbound_numbers` holds the number owns it. A tag
   `v2-agent:<agent id>` marks a v2 agent; the persona's `name` is the
   agent's name. Any other persona is a classic persona.
2. Otherwise a `pathway_id` on the number row means a v1 pathway answers it.
3. Otherwise the number is unassigned. Only its own legacy settings, if
   any, answer; usually nothing or a not-set-up placeholder.

A number missing from `/v1/inbound` is either not on this account or its
subscription is not active.

## Agent binding

POST `/v2/agents/<agentId>/inbound/attach` (✓, gate **confirm** when the
number has an owner):

```json
{ "inbound_numbers": ["<number>"], "only_if_unassigned": true }
```

- `environment`: `"production"` or `"staging"`. Omitted keeps the staging
  flag on a number already bound to this agent and starts every other number
  on production.
- `only_if_unassigned: true` binds only numbers with no persona and no
  pathway. A number running its own legacy prompt still counts as
  unassigned. If any number is taken, nothing is written and the call
  returns 409.
- Without it, the attach takes the number from whatever owns it, including a
  live v1 pathway, whose direct pathway binding is cleared.
- A production attach recompiles the agent's latest saved mainline version
  into its inbound bridge. Texts, the widget and API chat run that copy at
  once, until the next promote; when the latest save is not the production
  pin, compare the two and confirm before attaching. Calls still resolve the
  production pin at call time, or the staging pin for a staging number.
  When that version cannot be served (never promoted, invalid, a production
  variable unset), the call runs the copy compiled at the last attach or
  promote instead
  ([how it works](how-it-works.md#how-it-reaches-a-live-call-or-conversation)).
- 200: `{ agent_id, persona_id, pathway_id, compiled_from_version, attached }`.

| Status | Code | Message | Fix |
| -- | -- | -- | -- |
| 400 | `INVALID_BODY` | `inbound_numbers must be a non-empty array of phone numbers` | Send an array of strings. |
| 400 | `INVALID_BODY` | `only_if_unassigned must be a boolean` | Send `true` or `false`. |
| 400 | `INVALID_BODY` | `environment must be "production" or "staging"` | Fix the value. |
| 400 | `INVALID_INBOUND_NUMBERS` | `Some phone numbers were not found or do not belong to you` | Re-read `/v1/inbound`; use the stored form. |
| 400 | `NO_VERSIONS` | `Agent has no saved versions` (and a save hint) | Save a version first. |
| 404 | `NOT_FOUND` | `Agent not found` | Check the agent id. |
| 409 | `NUMBER_ALREADY_ASSIGNED` | `A selected number is no longer unassigned. Refresh and choose another number.` | Run the owner check; confirm before attaching without the flag. |
| 422 | `COMPILE_FAILED` | `Could not compile the agent's latest version: <reason>` | Fix the version ([v2-snapshot](../../v2-snapshot/SKILL.md)). |
| 403 | `ENTERPRISE_REQUIRED` | `This feature is only available for enterprise users` | Staging numbers need an enterprise org. |
| 409 | `STAGING_NUMBER_UNSUPPORTED` | `Numbers can't be attached to staging on dedicated infrastructure` | Attach to production. |
| 409 | `AGENT_ENV_UNPINNED` | `Staging has no published version. Publish to staging first.` | Publish to staging, then attach. |
| 409 | `AGENT_VARIABLE_UNRESOLVED` | names the variables missing a staging value | Set them for staging. |

POST `/v2/agents/<agentId>/inbound/detach` with `{ "inbound_numbers": [...] }`
(✓, gate **confirm**): unbinds numbers bound to this agent. The number goes
back to its own legacy settings, usually nothing; a v1 pathway that an
earlier attach cleared does not come back. A repeat returns
`detached_count: 0`.

POST `/v1/personas/<personaId>/inbound/attach|detach` is the classic persona
binding. Never use it for a v2 agent.

## Per-number settings

GET and POST `/v1/inbound/<number>` (✓, gate **confirm**). The POST is a wide
legacy writer; send only the keys in
[number config](number-config.md#the-safe-keys). Success:
`{ status: "success", message, updates }`. Failure:
`{ status: "error", message }`.

| Status | Message | Fix |
| -- | -- | -- |
| 404 | `No inbound number found for <number>.` | Use a number on the account. |
| 400 | `Transfer phone number is invalid or not formatted correctly.` | E.164, for example `+1` and ten digits. |
| 400 | `Transfer phone number is blocked or part of the DNC List.` | Choose another destination. |
| 400 | `Language code is invalid.` | Use a supported code, or `null` to clear. |
| 400 | `'language' must be a string.` | Send a string. |

## Buying numbers

All refused over OAuth: hand off to `/dashboard/phone-numbers`.

- POST `/numbers/get_available_numbers`
  `{ "country_code": "US", "area_code": "415", "limit": 3 }`. `limit` 1 to 20,
  default 3. Returns `{ phone_numbers: [{ phone_number, location, … }],
  requested_area_code, area_code }`. When `area_code` differs from
  `requested_area_code`, the inventory came from a nearby code; say so. 502
  `NUMBER_AVAILABILITY_ERROR` means the search failed, not that nothing is
  free.
- POST `/numbers/purchase` `{ "phone_number": "<from the search>", "country_code": "US" }`,
  or `{ "area_code": "415", "country_code": "US" }` for any number in the code.
  Gate **confirm** with price × count. Each call buys one number at $15 a
  month and is not idempotent. US and CA only. 200:
  `{ received: true, phone_number }`.

| Status | Code | Message |
| -- | -- | -- |
| 400 | `INVALID_REQUEST` | `Missing required parameters.` |
| 400 | `INVALID_COUNTRY_CODE` | `Only US and CA country codes are supported` |
| 400 | `MISSING_PAYMENT_METHOD` | `Payment method not attached` (add one under Settings, Billing) |
| 404 | `NUMBER_UNAVAILABLE_ERROR` | the number or code that had no inventory |

- POST `/numbers/claim_free` `{ "area_code": "415" }`: the org's one free
  number. 409 `Your account has already claimed a free inbound number`.
- The Agent Phone Plan (a dedicated number with texting and calling, billed
  monthly) is bought with the `buy_phone_plan` tool where the host offers
  it; it needs a payment token the owner approves. Otherwise hand off to
  `/dashboard/phone-numbers`.

## Blocked callers

`/v1/blocked_numbers` rejects inbound callers. Read-only over OAuth.

- POST `/v1/blocked_numbers` (gate none for a new block the user asked for):
  `{ "numbers": ["<caller>"], "is_global": true }`, or
  `{ "numbers": ["<caller>"], "is_global": false, "inbound_number": "<your number>" }`.
  1 to 10 numbers, optional `reason`. 201
  `{ created_count, blocks }`. 400 `inbound_number is required when is_global is false`.
- GET `/v1/blocked_numbers` returns only global rules. GET with
  `?inbound_number=<E.164>` returns only that number's rules. Read both to see
  everything that blocks a caller to one number. `active_only` defaults to
  `"true"`.
- POST `/v1/blocked_numbers/<id>/edit` needs both keys:
  `{ "reason": null, "is_active": false }`. Pausing a rule beats deleting it.
- DELETE `/v1/blocked_numbers/<id>` is permanent (gate **confirm**).

## Outbound do-not-call list

`/v1/org_dnc` stops this org's outbound calls to a number at dispatch. It
does not block inbound callers. Read-only over OAuth. Writes need the owner
or admin role in a dashboard session.

- GET `/v1/org_dnc?limit=100&offset=0` (limit up to 1000).
- POST `/v1/org_dnc/search` `{ "phone_number": "<number>" }`.
- POST `/v1/org_dnc` `{ "numbers": [...], "reason": "<why>" }`, up to 5000,
  stored as E.164. Idempotent.
- POST `/v1/org_dnc/delete` `{ "numbers": [...] }` or DELETE
  `/v1/org_dnc/<entry id>`: gate **confirm**. Removal lets calls reach a
  person who opted out.
- 503 `Your change was saved but is not active yet. Retry this request to apply it.`:
  resend the same request.

## SIP

All `/v1/sip` routes are refused over OAuth: hand off to `/dashboard/sip-trunks`.
Routes, bodies and traps are in [SIP](sip.md).

## Imported Twilio numbers

POST `/v1/byot/manage/remove` `{ "phone_number": "<number>" }` (✗ over OAuth,
gate **confirm**) deletes the number's row on this account only. The number
stays in the customer's Twilio account and stops reaching any agent here.

## Hand-offs

Never call these. Say what the user does and where.

| Task | Where | Why |
| -- | -- | -- |
| Release a number | Settings, Billing, phone subscriptions | Irreversible: the number goes back to the carrier. |
| Connect a Twilio account, import its numbers | `/dashboard/phone-numbers` | Needs a credential and a header the API tools cannot send. |
| Port a number in | `/dashboard/sip-trunks?wizard=port` | Carrier submission with a signed authorization and a document upload. |
| A2P registration | the agent's Channels, Messages page | Carrier review. |
| Branded Caller ID application | Configure, Identity (`/dashboard/agent/<id>/configure/identity`); its switch also shows on Channels, Calls | Carrier review; see [identity](../../agent-channels/references/identity.md). |

## Auth limits

On `oauth_path_not_allowed`, say "this connection cannot reach
`<route family>`; do it on `<dashboard path>`" and stop. Never route around
it.

| Route family | OAuth |
| -- | -- |
| `/v1/personas/**`, `/v1/inbound/**` GET and POST, `/v2/agents/**` inbound | ✓ |
| `/v1/blocked_numbers/**`, `/v1/org_dnc/**` | R |
| `/numbers/**` purchase and search, `/v1/sip/**`, `/byot/**`, `/inbound/**` | ✗ |
