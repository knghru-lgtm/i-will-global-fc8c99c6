---
name: phone-numbers
description: Use when someone asks "who answers this number", wants to "put my agent on a number" or "point +1… at" an agent, "buy a number", "block this caller", a "fallback number" or transfer on a number, a "SIP trunk", or asks "why is my number not answering", on the Phone numbers page, the SIP pages, or an agent's Calls channel. Also DNC, and hand-offs for release, port-in and Twilio import.
---

# Phone numbers

A number answers through one owner: a v2 agent, a classic persona, or a v1
pathway. With none, only its own legacy settings, if any, answer. Pins:
[v2-lifecycle](../v2-lifecycle/SKILL.md). "How does…" and "why did…"
questions: answer from [how it works](references/how-it-works.md) and reads.

Routes, bodies and messages: [endpoints](references/endpoints.md). Do not
write fetch scripts or search the docs for these routes.

## Page context

1. Call `get_dashboard_page_context` (`mode: "synced"`).
2. `/dashboard/phone-numbers`: inventory. `/dashboard/sip`: `route.search`
   `phone_number`, `trunk`, `direction`. `/dashboard/sip-trunks[/$trunkId]`:
   trunk id, `tab`. Agent pages (`channels/calls`, `phone-numbers`): agent id.
3. Mutate through the API, never the page's forms. After a write: "Saved
   through the API. The page shows it after a refresh."

## Workflow: who answers a number

Budget: two reads.

1. `bland_api_get` `/v1/personas`. The persona whose `inbound_numbers` holds
   the number owns it: a `v2-agent:<agent id>` tag means a v2 agent, else
   a classic persona.
2. Else `bland_api_get` `/v1/inbound/<number>`: a `pathway_id` means a v1
   pathway; none means unassigned. 404: not on the account or lapsed.

"Not answering": add block rules and, for SIP, the
[diagnosis](references/sip.md#diagnose).

## Workflow: get a number

Budget: one search, one purchase per number, then attach (below).

1. Ask country and area code. `call_bland_api` POST
   `/numbers/get_available_numbers` `{"country_code": "US", "area_code": "415", "limit": 3}`.
2. Confirm price × count. The org's one free number: POST `/numbers/claim_free`.
   Else POST `/numbers/purchase` per chosen number, in sequence. Re-list the
   inventory before retrying a timeout.

## Workflow: put an agent on a number

Budget: four reads, attach, read-back, test call.

1. Run the owner check for every number.
2. A v1 pathway owner: attaching cuts that live traffic over now; offer the
   migration rollout ([rollouts](../v2-lifecycle/references/rollouts.md))
   instead. Any other owner: confirm, naming it.
3. Read `/v2/agents/<agentId>/versions/latest` and `/environments`. A
   production attach puts the latest save on texts, widget and API chat at
   once; if it is not the production pin, promote first or confirm, naming
   them.
4. `call_bland_api` POST `/v2/agents/<agentId>/inbound/attach`
   `{"inbound_numbers": ["<number>"], "only_if_unassigned": true}`. Drop the
   flag only after a confirm. Add `"environment": "staging"` only when asked.
5. Read back `/v2/agents/<agentId>/inbound`.
6. Verify: `create_call` to it from another account number with a short
   caller `task`; it runs the production pin (staging if staging-attached).

## Workflow: per-number settings

Budget: read, POST, read-back. Live and unversioned.

1. `bland_api_get` `/v1/inbound/<number>`.
2. `call_bland_api` POST `/v1/inbound/<number>` with only the changed keys
   from the 13 in [number config](references/number-config.md#the-safe-keys).
3. Read it back.

## Block and DNC

Inbound: `/v1/blocked_numbers`, global or per number. Outbound:
`/v1/org_dnc`; never blocks inbound.

## SIP

Diagnose with reads per [SIP](references/sip.md). TLS on 5061 only, no
plaintext 5060. Store DIDs and extensions as given; never add `+`.

## Confirm before

- Buying, claiming or the Agent Phone Plan: price × count.
- Attaching an owned number; detaching.
- SIP `test-call` (rings real equipment) or `discover` (probes an outside host).
- Trunk header saves (overwrite per-number headers; name the count).
- Deleting a block rule or a DNC entry.

One confirm each: what changes, who is affected, cost or count, and
whether it can be undone.

## Hand off, never call

Number release, Twilio account connect or import, port-in, A2P and Branded
Caller ID submission.

## Refusals and limits

- `oauth_path_not_allowed`: name the route family and the dashboard path; stop.
- 409 `NUMBER_ALREADY_ASSIGNED`: run the owner check.
- 409 `AGENT_ENV_UNPINNED`: publish to staging first.

## Do not

- Send `prompt`, `pathway_id` or the whole row to `/v1/inbound/<number>`.
- Promise `fallback_number` is a failover.
- Claim the page updated or guess fields.
