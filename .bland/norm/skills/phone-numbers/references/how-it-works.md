# How phone numbers work

The conceptual page for numbers, caller screening, caller ID and SIP. Routes,
bodies and error messages live in [endpoints](endpoints.md); the per-number
keys in [number config](number-config.md); trunk routes and diagnosis in
[SIP](sip.md).

## Contents

- [What it is](#what-it-is)
- [Objects and how they relate](#objects-and-how-they-relate)
- [Lifecycle and states](#lifecycle-and-states)
- [How it reaches a live call or conversation](#how-it-reaches-a-live-call-or-conversation)
- [On the dashboard](#on-the-dashboard)
- [Rules and limits](#rules-and-limits)
- [When it goes wrong](#when-it-goes-wrong)
- [Questions people ask](#questions-people-ask)

## What it is

A phone number is the address a caller dials. On its own it decides very
little: its **owner** decides who answers. The owner is one v2 agent, one
classic persona, one v1 pathway, or nobody. Around the number sit a few live
settings (fallback, transfers, webhook, language and similar), caller
screening, and, for numbers on the customer's own carrier, a SIP
configuration.

What it is not:

| People say | What it actually is |
| -- | -- |
| "The agent's number" | A binding on the number, not a field of the agent version. Publishing does not move it. |
| "Number settings are part of the agent" | They are live and unversioned. A save reaches the next call in every environment. |
| "Fallback number = failover" | It forwards every call before any agent runs, and only while the platform's inbound fallback is switched on. It never catches an agent error. |
| "Block list = do-not-call list" | Block rules refuse inbound callers. The do-not-call list stops outbound dials. Neither covers the other direction. |
| "A SIP trunk is a number" | A trunk is a connection to the customer's carrier or PBX. Numbers and DIDs are attached to it. |
| "Caller ID" | The `from` number on an outbound call. Branded Caller ID is a separate carrier application that adds a business name. |

## Objects and how they relate

```text
 org (live, unversioned)                          agent (versioned)
 ├─ number ─────────── owner: exactly one of ───► v2 agent ──► production pin
 │   │                  │                         │            staging pin (staging number)
 │   │                  ├─ classic persona        └─ identity: Branded Caller ID
 │   │                  ├─ v1 pathway ── optional gradual cutover ──► v2 agent
 │   │                  └─ nobody (the number's own legacy settings, if any)
 │   ├─ per-number settings (fallback, transfers, webhook, language, ...)
 │   ├─ block rules scoped to this number
 │   └─ SIP config: inbound and outbound direction ──► trunk (optional)
 ├─ global block rules (every number)
 ├─ outbound do-not-call list
 ├─ SIP trunks (endpoint, auth, default headers)
 └─ connected Twilio accounts (imported numbers stay there)
```

Where a number comes from decides who owns it at the carrier:

| Source | Carrier side | Notes |
| -- | -- | -- |
| Bought from Bland | Bland | US and CA, billed monthly per number. |
| Free number | Bland | One per org, when the dashboard offers it. |
| Agent Phone Plan | Bland | A dedicated number bundled with calling and texting. |
| Imported from the customer's Twilio account | the customer's account | The number stays in that account. Removing it here does not release it. |
| SIP number or DID | the customer's carrier or PBX | Attached to a trunk. A Bland-bought number cannot be attached to a trunk. |
| Ported in | moves to Bland | A carrier submission with a signed authorization; a hand-off. |

A SIP attach also adds the number to the org's inventory, unassigned, so it
takes an owner exactly like any other number.

## Lifecycle and states

Ownership:

```text
                 buy | claim | import | SIP attach
                               │
                               ▼
     detach ───────────►  unassigned  ◄──────────── (v1 pathway cleared elsewhere)
     (back to the         │        │
      number's own        │attach  │set a v1 pathway
      legacy settings)    ▼        ▼
                     v2 agent    v1 pathway ── gradual cutover: share of calls
                    (prod or     │              to an agent, number unchanged
                     staging)    │
                         ▲       │ attach without only_if_unassigned
                         └───────┘ (pathway binding cleared; detach does not restore it)

     v2 agent A ── attach to agent B without the flag ──► v2 agent B (A loses it)
     any ── release in Settings, Billing ──► gone (terminal; back to the carrier)
     imported ── remove ──► gone here (still in the customer's account; re-importable)
```

- Attach and detach are reversible, but a v1 pathway binding that an attach
  cleared is not restored by detach. Re-point the pathway separately.
- Detach does not leave a number silent. It goes back to whatever the number
  ran by itself before, which for a new purchase is usually nothing or a
  placeholder that tells callers the line is not set up.
- Attach also binds texting on the number to the agent where texting is
  available; detach removes that. The `agent-channels` skill owns texting.

Other states:

| Object | States | Moves |
| -- | -- | -- |
| Branded Caller ID | `not_submitted` → `submitted` → `pending_review` → `approved` or `rejected` | Submit; carrier review. Resubmitting an approved or in-review application needs `resubmit: true` and restarts review. Carriers brand the approved numbers; the identity switch only marks calls as branded in their metadata ([identity](../../agent-channels/references/how-it-works.md#identity)). |
| Block rule | active ⇄ paused → deleted | Edit `is_active`; delete is permanent. |
| SIP direction | none → configured → none | Attach; detach deletes that direction's config. Attaching a direction that exists is refused until it is detached. |
| Gradual cutover | share 0 to 100 percent | 0 percent is a rollback. Owned by [rollouts](../../v2-lifecycle/references/rollouts.md). |

## How it reaches a live call or conversation

From ring to pickup, in order. Each refusal happens before the call is
answered, so it leaves no call record.

```text
 caller dials
   │  Bland number | imported number (its voice webhook points at Bland)
   │  SIP: customer PBX → Bland over TLS 5061, media SRTP
   ▼
 1 find the number on Bland ............ not found: carrier error, no call record
 2 screen the caller
     withheld caller ID ................ allowed by default
     block rules (global + this number)  refused
 3 caller country ...................... refused if the carrier account does not
                                         permit it (imported: the customer's
                                         own account permissions)
 4 fallback_number set + inbound
   fallback on ......................... forwarded; no agent runs
 5 pick the behavior from the owner
     v2 agent ......... production pin, or the staging pin on a staging number,
                        or an experiment or rollout arm
     classic persona .. its production version
     v1 pathway ....... the pathway, or the agent under a gradual cutover
     nobody ........... the number's own legacy settings, if any
 6 merge settings (agent first, number fills gaps)
 7 answer; the agent speaks
```

What is read when:

- **The owner and the per-number settings are read on every call.** A
  settings save, attach, detach, block rule or release reaches the next call,
  within about half a minute at most. Nothing is frozen per number.
- **A v2 agent's version is resolved per call.** A promote or rollback reaches
  the next call. Publish to staging reaches staging numbers only.
- **If the agent's version cannot be served** (production never promoted, an
  invalid version, an unresolved production variable, or a slow load), the
  call still connects. It runs the last copy put on the number, compiled at
  the last attach or the last promote, and is not attributed to a version.
  After a fresh attach to an unpromoted agent that copy is the latest saved
  version. Details: [lifecycle](../../v2-lifecycle/references/lifecycle.md#inbound-binding-the-twin-and-fail-open).
- **A staging number** resolves the staging pin and never joins an
  experiment.

How the agent's settings and the number's settings combine:

| Setting | Wins |
| -- | -- |
| Most call behavior the agent sets | the agent |
| Max duration, noise cancellation, button presses, recording | the agent only when changed from its default (30 minutes, on, not ignored, off). Left at default, the number's own value applies. Recording can be turned on by the agent but not off. |
| Language | the number's language when set; otherwise the agent's |
| Background track | the agent, including Off |
| Fallback, transfers, webhook, request data, metadata, redaction | the number ([number config](number-config.md)) |

Outbound calls do not consult the number's owner. The `from` number is the
caller ID; the agent comes from the request.

## On the dashboard

| Page | Shows | Does there that the API tools cannot |
| -- | -- | -- |
| `/dashboard/phone-numbers` (org scope: Dispatch, Phone numbers) | Every number with its owner (agent name, `Pathway: <name>`, or Unassigned), label, channels, SIP flag | Buy (search, up to 20 per submission), claim the free number, connect a Twilio account and import, blocked numbers modal |
| Number detail sheet (row click) | Assignment (Agents, Classic agents, Unassigned), channel matrix, call screening, advanced settings | Links to billing (release) and SIP |
| SIP tab, `/dashboard/sip-trunks[/<trunk id>]` | Trunks; per trunk Overview (calls, SIP trace), Numbers, Configure | Setup wizard, port-in wizard (`?wizard=port`) |
| `/dashboard/sip?phone_number=` | One number's inbound and outbound SIP config | Header editing per direction |
| Agent, Channels, Calls | This agent's numbers, each marked production or staging; per-number settings pane; Branded Caller ID | Logo upload. A number live on a v1 pathway is shown with "Move its traffic instead of attaching" rather than an attach button. |

After an API write none of these pages refresh by themselves. Say "Saved
through the API. The page shows it after a refresh." The Branded Caller ID
switch saves on flip and is not part of the agent version.

## Rules and limits

| Area | Rule | What the user sees |
| -- | -- | -- |
| Buying | US and CA only | `Only US and CA country codes are supported` |
| Buying | A payment method on file | `MISSING_PAYMENT_METHOD` |
| Buying | One number per purchase call, $15 a month each; not idempotent | a second call buys a second number |
| Buying | Search returns 1 to 20, default 3; may substitute a nearby area code | `area_code` differs from `requested_area_code` |
| Free number | One per org | `Your account has already claimed a free inbound number` |
| Attach | Numbers must be on this org, in their stored form | `INVALID_INBOUND_NUMBERS` |
| Attach | `only_if_unassigned` is all or nothing. It skips numbers with an agent, persona or pathway, but not a number running its own legacy prompt | `409 NUMBER_ALREADY_ASSIGNED` |
| Attach | Needs at least one saved version | `NO_VERSIONS` |
| Staging attach | Enterprise org, routing that supports staging, a published staging version, staging variables set | `ENTERPRISE_REQUIRED`, `STAGING_NUMBER_UNSUPPORTED`, `AGENT_ENV_UNPINNED`, `AGENT_VARIABLE_UNRESOLVED` |
| Block rules | 1 to 10 numbers per add, valid phone numbers, exact match (no prefixes or wildcards) | `Invalid phone number: <n>` |
| Block rules | Per-number rule needs `inbound_number` | `inbound_number is required when is_global is false` |
| Do-not-call | Up to 5000 per add; outbound only | refusal at dispatch |
| Caller ID | `from` must be a number the org can use | `Invalid 'from' - you might not own this number. Did you specify a country code?` |
| SIP | TLS on 5061 only, no plaintext 5060; media SRTP over UDP 16384 to 32768 | `GET /v1/sip/firewall-ips` lists the addresses to allow |
| SIP | A Bland-bought number cannot join a trunk | `... is provisioned on Bland's carrier, so it cannot be attached to a SIP trunk.` |
| SIP | An E.164 number belongs to one org; a DID or extension is per org | `This number is already attached to another organization, or belongs to Bland.` |
| SIP | Attach up to 100 numbers; an existing direction must be detached first | `Direction "inbound" already exists on this number ...` |
| SIP | Test call: 10 per 15 minutes per org; discovery: one at a time | see [SIP](sip.md#actions-that-reach-outside) |
| Branded Caller ID | Display name up to 30 characters, call reason up to 60; only numbers bound to the agent; carriers `tmobile`, `verizon` | `Phone numbers not bound to this agent: ...`, `409 BCID_ALREADY_SUBMITTED` |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
| -- | -- | -- | -- |
| Caller hears "not set up yet", or nothing useful | No owner; the number runs its own placeholder | Owner check: no persona holds it, no `pathway_id` | Attach an agent |
| Callers hear an older agent after a promote should have changed it | The production version could not be served, so the call ran the last copy put on the number | The agent's production environment; the call is not attributed to a version | Promote a valid version; set production variables |
| A v1 pathway number now answers as an agent | Attached without `only_if_unassigned` | `/v1/inbound/<number>` has no `pathway_id`; a persona holds it | Use a gradual cutover next time; re-point the pathway to undo |
| Another agent's number moved | Attach without the flag takes the number | `GET /v2/agents/<id>/inbound` on both agents | Attach it back, after a confirm |
| One caller is refused at once, no call log | A global or per-number block rule | `GET /v1/blocked_numbers` and `?inbound_number=<number>` | Pause or delete the rule |
| Callers from one country are refused | The carrier account does not permit that country | No call record; caller country | For an imported number, the customer's own account permissions |
| Every call goes to a person, no agent | `fallback_number` is set | `/v1/inbound/<number>` | Clear it with `null` after a confirm |
| Imported number never reaches Bland | Its voice webhook in the customer's account does not point at Bland (`skip_url_update` true, or settings never saved) | The number's config in the customer's Twilio console | Save the number's settings without `skip_url_update`, or point it by hand |
| Staging number runs production | Not attached as staging, or routing fell back | `numbers[].agent_env_type` on the agent's binding | Reattach with `"environment": "staging"` |
| SIP number silent | No owner, no inbound direction, endpoint unreachable, or a `+` added to a DID | The [SIP diagnosis](sip.md#diagnose) reads | Fix the named step |
| Outbound call refused for caller ID | `from` not on the org | the 400 message | Use a number on the account |
| No business name on recipients' phones ([identity](../../agent-channels/references/how-it-works.md#identity)) | BCID not `approved`, number not in the application, or the recipient's carrier not covered | `GET /v2/agents/<id>/identity/bcid`; the call's metadata lacks `branded_caller_id` | Finish review; resubmit with the number. Display is the recipient carrier's decision. |

## Questions people ask

**Who answers my number right now?** Run the two-read owner check in the
skill. A persona whose `inbound_numbers` holds it wins over a pathway.

**Do I have to promote before attaching?** Attaching works without it, but a
production attach copies the latest saved version, not a release. Texts, the
widget and API chat run that copy at once, and calls fall back to it while
production is unpromoted. Promote first so every channel runs a version you
chose.

**Will publishing change what callers hear?** Publish reaches staging numbers
only. Production numbers change on promote or rollback.

**Is a per-number setting saved with the agent version?** No. It is live at
once, in every environment, with no history. Quote the old value before
changing it.

**Will the fallback number catch calls when the agent breaks?** No. It
forwards every call before the agent runs, and only while inbound fallback is
switched on for the platform.

**Does blocking a number stop me calling it?** No. Use the do-not-call list
for outbound. Blocks only refuse inbound callers.

**Can I use my own carrier?** Yes: import numbers from a Twilio account you
connect on the dashboard, or connect a SIP trunk and attach your DIDs. Signaling
is TLS on 5061 only; allow the addresses from `GET /v1/sip/firewall-ips`.

**Can I move a pathway's calls to an agent safely?** Use a gradual cutover:
the number stays on the pathway and a share of calls goes to the agent, with
0 percent as the rollback. See [rollouts](../../v2-lifecycle/references/rollouts.md).

**What happens when I release a number?** It returns to the carrier and cannot
be recovered. Release is done in Settings, Billing; never through the API
tools.
