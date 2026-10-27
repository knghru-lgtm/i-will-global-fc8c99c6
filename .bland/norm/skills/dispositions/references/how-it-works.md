# How dispositions work

The definitive explanation. Routes and bodies live in the
[API reference](api.md); value design in [definition](definition.md).

## What it is

After a call ends, teams need the same few facts from every call: did it
book, why not, what account was it, was the disclosure read. A disposition
is that list of facts for one agent, written down once as typed values,
tested on real calls, priced, and then produced automatically after every
completed call. The results arrive with the call's post-call webhook and in
the Conversations page.

It is not:

- **An evaluation judge.** A judge scores one dimension with a rubric. A
  disposition can *use* a judge as one of its values.
- **A variable the agent collects mid-call.** Those live in the agent
  version and steer the conversation. A disposition runs after the call and
  never changes what the agent said.
- **A cohort or chart.** Cohorts and the analytics Sankey count calls. A
  disposition labels each call.
- **The v1 citation schema or outcome.** Those are the older surfaces it
  replaces ([migration](migration.md)).

## Objects and how they relate

```text
  organization
  ├─ extractors (versioned prompt + output schema; org-wide or one agent)
  ├─ judges     (evaluations; versioned)
  ├─ snippets   (custom code; versioned)
  └─ agent
     └─ disposition  key, state enabled|disabled           (agent-scoped)
        ├─ draft        one editable definition, revision n
        ├─ versions     v1, v2, v3 … immutable, one is live
        │    └─ definition
        │         ├─ values[]  id, key, label, schema, source ──► pins an
        │         │                                  extractor version,
        │         │                                  judge version, agent
        │         │                                  variable or snippet version
        │         ├─ transformation  ──► shapes `payload`
        │         ├─ timing          immediate | within_24h
        │         └─ postCallWebhook hold | emit_followup
        ├─ test runs    a definition snapshot × chosen calls ─► rows ─► corrections
        ├─ backfills    one published version × past calls
        └─ call results one run per (call, version), newest shown
```

- A disposition belongs to one agent. It is not part of the agent's
  versions, so publishing, promoting or rolling back the agent never moves
  it, and its live version applies to the agent's calls in every
  environment at once.
- Publishing copies each pinned dependency (the judge's rubric, the
  extractor's prompt and schema, the variable's prompt, the snippet
  version) into the version. Later edits to those dependencies do not
  change a published version until you repin and publish again.

## Lifecycle and states

The disposition:

```text
            POST /                 publish (estimate acknowledged)
  (none) ─────────► disabled ───────────────────────────► enabled
                    draft only ◄────────── disable ──────  live version runs
                       ▲                                     │   ▲
                       │            publish again ───────────┘   │
                       │                                         │
                       └──── delete (from either; terminal) ─────┘
                             hidden, key reserved, history kept

  rollback: moves the live pointer to an earlier version and replaces the
  draft. It does not change enabled/disabled.
```

The draft and versions:

```text
  draft rev n ──op──► rev n+1 ──op──► … ──publish──► version k (frozen, live)
                                                     new draft = copy of k
```

Every draft write must name the revision it read (`expectedRevision`).
A stale revision gets 409 `DRAFT_REVISION_CONFLICT`, never a silent
overwrite.

A call's result: `pending` → `queued` → `running` → `complete`, `failed` or
`cancelled`. A run is `failed` only when every value errored. Each value
inside carries its own state:

| Value state | Meaning | In `payload` |
|---|---|---|
| `produced` | A value was produced (it may legitimately be `null`) | the value |
| `no_value` | The evidence did not support any answer | `null` |
| `error` | That value could not run; `error.code` says why | `null` |

Test runs and backfills: `queued`, `running`, then `complete`, `partial`,
`failed` or `cancelled`.

## How it reaches a live call

```text
  call completes ──► which dispositions?   enabled + published, this agent
       │             (skip: redaction on)  version = the one live NOW, frozen
       ▼
  corrected transcript (once per call, when a value needs it)
       │   if it never arrives: some values score on the live transcript
       ▼                       (marked evidence_source: live_transcript)
  values run in parallel ──► custom code runs last on its inputs
       ▼
  transformation ──► payload
       ▼
  delivery: hold ──► inside the call's post-call webhook
            emit_followup ──► a separate "dispositions" event, same URL
       ▼
  Conversations page (detail panel and per-key columns)
```

- **Which calls.** Every completed call (phone or web) handled by the
  agent, whichever environment served it, while the disposition is enabled
  and has a published version. There is no minimum call length, so very
  short calls are scored (and billed) too.
  Calls with redaction on never enter dispositions. Text conversations,
  test chats and agent-testing simulations are not scored.
- **Which version.** The version live when the call completed. It is frozen
  for that call: publishing, rolling back or disabling afterward does not
  change a call already admitted.
- **Evidence.** Values read what their `inputSourceIds` select. Where a
  value reads the transcript, it reads a corrected post-call transcript,
  produced once per call and shared by every disposition on it. If it is
  unavailable, transcript values fall back to the live call transcript and
  say so; values that need the corrected transcript or the recording end in
  `error` with `evidence_unavailable`.
- **Timing.** `immediate` work has a 30-minute deadline. `within_24h` has a
  24-hour deadline and may cost less (the estimate shows it). Neither
  waits on purpose: `within_24h` results can arrive as fast, but may take
  up to a day.
- **Delivery.** The disposition has no URL. It uses the call's own post-call
  webhook URL.
  - `hold`: the post-call webhook waits for these values and carries them
    in an `agent_dispositions` array. The wait is at most 30 minutes;
    `maxHoldSeconds` asks for a shorter one, and with several held
    dispositions on one call the shortest applies. A disposition still
    unfinished at the deadline appears as `status: "failed"` with
    `error.code: "delivery_hold_timeout"`, and its late values are not sent
    by webhook. `hold` requires `immediate`.
  - `emit_followup`: the post-call webhook goes out as usual (with an empty
    `agent_dispositions` array), then each disposition sends its own event
    `{event_type: "dispositions", timestamp, call_id, agent_dispositions: [entry]}`
    to the same URL. If the post-call webhook itself failed, no follow-ups
    are sent. Without a webhook URL nothing is sent; the results are still
    stored.
  - If the organization delays its post-call webhook for v1 citations, a
    `hold` disposition is delivered as a follow-up instead.
  - Each entry: `disposition_id`, `disposition_version_id`,
    `disposition_key`, `name`, `status`, `payload`, `values[]` (`key`,
    `state`, `value`, `error?`, `evidence_source?`), `evidence` (short
    quotes), `error?`, `executed_at`. Webhook requests carry an
    `X-Webhook-Idempotency-Key` header; dedupe on it.
- **Elsewhere.** Boolean and enum values of published dispositions can be
  watched as experiment metrics. Test runs and backfills never send
  webhooks.
- **Retention.** Results follow the organization's transcript retention.
  Past it, evidence and rationale are removed and old test runs may no
  longer open; the values stay.
- **How long a change takes.** A publish applies to the next call that
  completes. Calls that completed earlier keep the version they ran; rescore
  them with a backfill.

## On the dashboard

| Page | Shows | Notes |
|---|---|---|
| `/dashboard/agent/<id>/dispositions` | Rail of dispositions (Active or Draft), migration job cards; opens the first one | "Migrate from citations" opens the migration modal |
| `…/<dispositionId>` | Header (name, `vN`, "Unpublished changes", "View changes"), values table, Shape (transformation JSON with an example), Delivery Timing, Webhook behavior, Advanced (disable, backfill, roll back, delete), History | The value drawer shows each value's per-call cost; the extractor manager lives here |
| `…/<dispositionId>/runs/<runId>` | Progress, "Values filled %", top results per value, per-call table, corrections, Compare to, Replay frozen, Rerun current, CSV | Click a cell to correct it; "Align" proposes changes, "Apply and retest" saves and replays |
| Conversations (agent or org) | Per call: each disposition's values, status, and a note when the live transcript was used; one column per value key | |

Differences from the API:

- The test drawer only runs the **draft** on **selected** calls. Testing the
  published version or "the N most recent calls" is API-only.
- The publish drawer requires "I understand this is billed on every
  conversation" but does not show the amount. The API estimate does.
- Backfill sampling is API-only.
- Refresh: the editor and list do not poll. After an API write they show
  the change after a refresh. An open test run page polls while the run is
  in progress; backfill status every 15 seconds; migration cards every few
  seconds; Conversations every 10 seconds while a result is unfinished.

## Rules and limits

| Rule | Limit or default | What the user sees |
|---|---|---|
| Availability | Enterprise organizations enabled for dispositions | 403 `ENTERPRISE_REQUIRED`, else 404 "Not found"; page "Dispositions isn't available here" |
| Write role | Owner, admin, operator, prompter | 403 |
| Disposition key | `^[a-z][a-z0-9_]*$`, up to 64, unique per agent forever | 409 "A disposition with key … already exists" or "…reserved by a deleted disposition…" |
| Values | 1 to 50 per definition; keys unique | 400 with `problems` |
| Schema | 24 enum options, 8 levels, 200 nodes, 1000 array items | 400 with `problems` |
| Definition size | 256 KiB at publish | 400 |
| Hold | `immediate` only; at most 1800 s | 400 |
| Publish | Current estimate id; acknowledgement when the cost is above zero | 400, or 409 "Pricing estimate changed…" |
| Test runs | 500 calls each; 3 queued or running and 10 starts per hour per organization | 409, 429 |
| Corrections | Explanation 40 to 4000 characters; 300 per hour | 400, 429 |
| Align | 30 per hour; finished run with a correction | 409 `DISPOSITION_ALIGN_NOT_READY` |
| Backfill | Window up to 92 days within the last 400; or 500 call ids; one running per version; 10 per hour including estimates; balance check | 400, 402, 409, 429 |
| Billing | Inference per value, corrected transcript once per call, custom code per invocation after a monthly free tier; judges at evaluation rates | Estimate `perValue` and `assumptions` |
| Insufficient balance | The disposition is skipped for that call | No result for the call |

## When it goes wrong

| Symptom | Likely cause | Confirm with | Fix |
|---|---|---|---|
| No result on a call | Disposition disabled, never published, or published after the call | `GET /:id` (`state`, `publishedVersionId`); call time vs publish time | Publish; backfill the gap |
| No result on a call | The call belongs to another agent, has redaction on, is a test chat or simulation, or is a text conversation | The call's agent and settings | Expected; nothing to fix |
| No result on any call lately | Balance too low; skipped calls leave no result | Organization balance | Add credits, then backfill |
| No result on one call, others fine | It did not start at completion (rare) | `call-runs` empty for that call only | Backfill that call id |
| Status `pending`, `queued` or `running` for hours | `within_24h` timing | Version `timing` | Wait up to 24 hours, or switch to `immediate` |
| Value blank, state `no_value` | The rule did not match anything said | Test the published version on the call; read the rationale | Calibrate the instructions or add a catch-all option |
| Value blank, state `error` | `evidence_unavailable` (no recording or corrected transcript), `custom_code_schema_mismatch`, `custom_code_timeout`, `judge_failed`, `billing_not_allowed` | `error.code` in `call-runs` | Fix the code or schema; re-test |
| Held webhook shows `delivery_hold_timeout` | Values took longer than the hold | Run `completedAt` vs hold | Use `emit_followup`, raise `maxHoldSeconds`, or simplify values |
| Webhook has no values | `emit_followup` (they come in a later event), no webhook URL, or the post-call webhook failed | Version `postCallWebhook`; call webhook logs | Read the follow-up event; fix the endpoint |
| Results changed meaning after an extractor or judge edit | The edit created a new dependency version; the disposition still pins the old one, or was repinned and republished | `GET /:id/versions` definitions | Repin deliberately; compare with test runs |
| Same call shows old values after a publish | It completed before the publish | Call time vs `publishedAt` | Backfill if rescoring is wanted |
| Two systems both label calls | v1 citations or outcomes still attached after migration | v1 schema attachments | Detach the v1 source |
| Publish 409 "Pricing estimate changed" | The draft or a pin changed after the estimate | Re-read the draft | Estimate again, re-confirm, publish |

## Questions people ask

**Does it run on every call?** On every completed call of the agent while
it is enabled and published, in every environment, except calls with
redaction on. Text conversations and simulations are not scored.

**Is it billed?** Yes, per call, plus test runs and backfills. Read the
estimate before publishing; the dashboard does not show the amount.

**How fast do results arrive?** `immediate`: within 30 minutes. `within_24h`:
within a day.

**Where do results go?** In the call's post-call webhook (`hold`) or a
follow-up event to the same URL (`emit_followup`), and on the Conversations
page. There is no separate destination to configure.

**Why is a value `null` in `payload`?** The value's state was `no_value` or
`error`; `values[]` beside it has the state and any error code.

**Does editing the draft change live results?** No. Only publish does.

**Can I undo a publish?** Roll back to an earlier version. The draft is
replaced; the disposition stays enabled or disabled as it was.

**Can I rescore old calls after a fix?** Backfill with the new version.
Calls already scored by that same version are skipped; older versions'
results are not overwritten but the newest result is what pages show.

**Do corrections change delivered results?** No. They are evidence for
align and for your own review.

**Do v1 citations stop when I migrate?** No. Detach them yourself once the
new dispositions are live.
