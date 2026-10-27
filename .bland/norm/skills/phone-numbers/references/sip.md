# SIP trunks and SIP numbers

SIP connects a customer's phone system (a PBX or a carrier trunk) to Bland.
A **trunk** holds the customer endpoint, its authentication and default
headers. A **SIP number** is an E.164 number, a DID or an extension, with an
inbound and an outbound direction, usually bound to a trunk. Which agent
answers a SIP number is the same owner question as any number.

Every `/v1/sip` route is refused over OAuth. On `oauth_path_not_allowed`
say "this connection cannot reach SIP; do it on /dashboard/sip-trunks" and
stop.

## Contents

- [Facts to get right](#facts-to-get-right)
- [Diagnose](#diagnose)
- [Reads](#reads)
- [Writes](#writes)
- [Actions that reach outside](#actions-that-reach-outside)

## Facts to get right

- Signaling is TLS on port 5061 only. There is no plaintext listener on 5060.
  Media is SRTP over UDP 16384 to 32768. GET `/v1/sip/firewall-ips` returns
  the addresses the customer must allow, with these ports.
- Identity: only a value sent with a leading `+` is normalised to E.164.
  DIDs and extensions are stored exactly as sent. Never add a `+`, a country
  code or `sip:` to a DID; that creates a different identity and routing
  breaks. Reads accept either form.
- A trunk header save overwrites the header config on every number bound to
  that trunk, for the header's direction. Per-number header edits on those
  numbers are lost.
- A trunk's `register_password_for_pbx` is returned once, on create or when
  it changes. Hand it to the user for their PBX; never write it to a file
  or repeat it later.
- Deleting a trunk keeps its numbers' config and leaves them unbound.
- A trunk carries numbers on the customer's own carrier. A number bought
  from Bland is refused (`... is provisioned on Bland's carrier, so it
  cannot be attached to a SIP trunk.`). A SIP attach adds the number to the
  inventory unassigned; give it an owner like any number.
- Attaching a direction the number already has is refused (`Direction
  "<type>" already exists on this number ...`). Use `/v1/sip/update`, or
  detach that direction first.

## Diagnose

"Why is my SIP number not answering", in order, reads only:

1. Owner: run the owner check in the skill. An unassigned number answers
   nothing, whatever SIP says.
2. GET `/v1/sip?phone_number=<number>`: is the inbound direction configured,
   and on which trunk?
3. GET `/v1/sip/status?phone_number=<number>`: `health` is `healthy`,
   `unreachable`, `unchecked`, `mutual_tls` (the endpoint wants a client
   certificate) or `unconfigured`.
4. GET `/v1/sip/numbers/<number>/calls?limit=20`: recent Bland calls on the
   number, with call ids.
5. GET `/v1/sip/calls/<call id>/ladder`: the SIP message flow for one call.
   For outbound calls it is rebuilt from the call record.
6. GET `/v1/sip/live?minutes=120` (up to 1440) and GET
   `/v1/sip/metrics?days=30` (up to 90): org-wide feed and totals.

A ladder or live read that returns `configured: false` means signaling
capture is not available in this environment. Say so and rely on steps 3 and
4 and the call log ([call-analysis](../../call-analysis/SKILL.md)).

Report what the reads show. Offer `test-connection` (below) only when health
is unknown.

## Reads

| Route | Returns |
| -- | -- |
| GET `/v1/sip/trunks` | `{ trunks }` |
| GET `/v1/sip/trunks/<id>` | `{ trunk, numbers }`, secrets redacted |
| GET `/v1/sip/trunks/<id>/calls?limit=&before=` | calls on the trunk's numbers |
| GET `/v1/sip/trunks/<id>/call-metrics`, `/metrics` | trunk totals |
| GET `/v1/sip/trunks/<id>/ladder`, `/live` | captured flows (may be `configured: false`) |
| GET `/v1/sip/numbers` | the org's SIP numbers |
| GET `/v1/sip?phone_number=` | one number's inbound and outbound config |
| GET `/v1/sip/status?phone_number=` | `{ configured, health }` |
| GET `/v1/sip/calls?phone_number=&limit=&before=` | SIP call log for a number (limit up to 500) |
| GET `/v1/sip/firewall-ips` | `{ ip_addresses, ports }` |
| GET `/v1/sip/outbound-setup?phone_number=` | host and port for the customer's PBX; with a number, its SIP username and a redacted password |

## Writes

Each is a live routing change. Confirm before any of them.

- POST `/v1/sip/trunks`: `name` (required), `provider`, `direction`
  (`inbound`, `outbound`, `both`), `sip_endpoint`, `auth_mode` (`ip` or
  `register`), `register_auth`, `options`, `headers`, `is_default`.
- PATCH `/v1/sip/trunks/<id>`: the same keys, partial. When `headers` is in
  the body, read GET `/v1/sip/trunks/<id>` first and name how many numbers
  lose their own headers.
- DELETE `/v1/sip/trunks/<id>`.
- POST `/v1/sip/attach`:
  `{ "phone_numbers": ["<number>"], "directions": [{ "type": "inbound" }], "trunk_id": "<trunk id>", "service": "sip" }`.
  Up to 100 numbers. 200 `{ configured, failed }`, so check `failed`.
- POST `/v1/sip/update`: `{ "phone_number": "<number>", "updates": { "type": "outbound", … } }`.
- POST `/v1/sip/detach`:
  `{ "phone_number": "<number>", "directions": [{ "type": "inbound" }], "service": "sip" }`.
  Deletes that direction's config; inbound calls on it stop.

Validation failures come back as 400 `Invalid request payload: [<path>: <message>]`
or `Invalid trunk payload: …`. Fix the named path only.

## Actions that reach outside

Tell the user what each does and wait for "yes".

| Route | What it does | Limits |
| -- | -- | -- |
| POST `/v1/sip/trunks/<id>/test-connection` | Sends a SIP OPTIONS ping over TLS to the trunk endpoint. Reachability only, no call. | none |
| POST `/v1/sip/test-call` `{ "phone_number": "<number>" }` | Places a real call that rings the customer's SIP equipment. | 10 per 15 minutes per org: `Too many test call requests. Please try again in 15 minutes.` |
| POST `/v1/sip/discover` `{ "host": "<host>", "port": 5061, "transport": "tls" }` | Resolves DNS and probes the outside host on common SIP ports. | One per org at a time: `Another discovery is in progress for this organization. Please try again shortly.` |

Porting a number in is a carrier submission with a signed authorization and
a document upload. Hand it off to `/dashboard/sip-trunks?wizard=port`.
