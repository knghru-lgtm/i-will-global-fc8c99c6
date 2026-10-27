# Disposition workflows in detail

Step-by-step versions of the workflows in [the skill](../SKILL.md). Routes
are relative to `/v2/agents/<agent id>/dispositions`; bodies are in the
[API reference](api.md). Concepts: [how dispositions work](how-it-works.md).

## Contents

- [Set up a disposition from scratch](#set-up-a-disposition-from-scratch)
- [Change a live disposition safely](#change-a-live-disposition-safely)
- [Calibrate](#calibrate)
- [Backfill past calls](#backfill-past-calls)
- [Diagnose a blank, wrong or missing result](#diagnose-a-blank-wrong-or-missing-result)
- [Migrate v1 citations and outcomes](#migrate-v1-citations-and-outcomes)

## Set up a disposition from scratch

Budget: one inventory, three catalog reads, one create (plus any extractor
creates), one test run with polls and one rows read, ops for fixes, one
estimate, one publish, one call-runs read after the next live call.

1. **Interview.** Ask, one question at a time if needed:
   - What decision or system uses the result? (CRM field, routing report,
     QA review, a webhook consumer.)
   - The outcome categories, each with a one-line rule a person could apply.
     Add a catch-all like `other` so every call has an answer.
   - Each extra field: name, type (yes/no, number, text, date-time, list,
     choice), and where it comes from (said in the call, an existing agent
     variable, an existing judge, a calculation).
   - How fast it must arrive: webhook-time (`immediate`) or reporting
     (`within_24h`, lower cost). Whether their webhook consumer can wait
     for the values (`hold`) or takes a second event (`emit_followup`).
2. **Inventory.** `GET /` so you never collide with an existing key, and
   `GET /variable-catalog`, `GET /extractor-catalog`, `GET /judge-catalog`
   so you reuse what exists.
3. **Propose** the definition in plain words: a table of values (key, label,
   type, source, rule), the timing, delivery, and the payload shape. Map
   each answer to a source with
   [the source table](definition.md#sources). New categories or fields from
   the conversation need an extractor: draft its `promptMd` with the rules
   from step 1, its `outputSchema`, and `contextSources: ["transcript"]`.
   Wait for the user's yes.
4. **Create.** `POST /extractors` then `POST /extractors/:id/publish` for each
   new extractor (a value can only publish against a published extractor
   version). Then `POST /` with `{key, definition}`, every value's `schema`
   copied exactly from its catalog entry or extractor. The disposition is
   created disabled; nothing runs yet.
5. **Test.** Confirm the spend ("about N calls of test scoring"), then
   `POST /:id/runs` with `target: "draft"` and
   `{"mode":"recent","environment":"production","requestedSize":10}` (or the
   user's chosen call ids). Poll `GET /:id/runs/:runId` until terminal; read
   `GET /:id/runs/:runId/rows`.
6. **Show results.** One row per call: the call id, each value, and the
   rationale for anything surprising. Count produced vs `no_value` vs
   `error` per value. Ask which look wrong.
7. **Fix** with draft ops (`update_value` for a label, schema or source;
   extractor draft plus publish plus `update_value` for prompt changes).
   Re-test on the same call ids (`mode: "calls"`) and compare value by value.
8. **Estimate.** `POST /:id/estimates` with `{}`. State
   `totalUsdPerCall.expected` and its range, and the timing.
9. **Publish** after the confirm, which must say it bills on every new call
   of this agent: `POST /:id/publish` with `expectedRevision` (the draft's
   `revision`), `expectedVersionId` (its `currentVersionId`), `estimateId`
   and `acknowledgeEstimate: true`.
10. **Verify.** After the next completed live call, read
    `GET /call-runs?callIds=<that call id>`. Report the status and values.
    An `immediate` disposition lands within 30 minutes; a `within_24h`
    one can take up to a day.

## Change a live disposition safely

Budget: one draft read, the ops, one test run on both targets or a replay
compare, one estimate, one publish.

1. `GET /:id/draft`. Note `revision`, `currentVersionId`, and the live
   `publishedVersionNumber` from `GET /:id`.
2. Apply each change as one op. Never PATCH the whole draft when ops will
   do. On `DRAFT_REVISION_CONFLICT`, re-read and reapply.
3. Test the draft and the published version on the same calls: two runs,
   `target: "draft"` and `target: "published"`, both
   `{"mode":"calls","callIds":[…]}`. Show only the values that differ per
   call.
4. Estimate. If the per-call cost moved, say by how much.
5. Publish with the confirm. Live calls that already started scoring keep
   the old version; calls that complete afterward use the new one.
6. Rollback path: `GET /:id/versions`, then `POST /:id/rollback` with the
   earlier `version_id` and the draft's `revision`. Warn that it replaces
   the draft. Rollback does not re-enable a disabled disposition.

## Calibrate

Budget: one rows read, one PUT per disagreement, one align, the ops, one
re-test.

1. Pick a finished test run. Read its rows and ask the user which values
   are wrong on which calls.
2. For each, `PUT /:id/runs/:runId/cases/:callId/annotations/:valueId` with
   the right value (or `no_value`) and a 40+ character explanation of the
   rule, not just the answer.
3. `POST /:id/runs/:runId/align` (`{}` or a `valueIds` subset). Show each
   proposed change as before and after with its rationale. Nothing is saved.
4. Apply only the changes the user accepts
   ([by kind](api.md#corrections-and-align)).
5. Re-test the same call ids with `target: "draft"` and compare against the
   corrected values. Repeat until the disagreements are gone, then publish.

## Backfill past calls

Budget: one availability read, one estimate, one create, polls.

1. `GET /backfill-availability`. If `enabled` is false, stop and say so.
2. Confirm the window (or call ids) and the version (default: live).
3. `POST /:id/estimates` with `{"backfill":{…}}`. Report `eligibleCalls`,
   `estimatedCostUsd` and `availableBalanceUsd`.
4. Confirm with both numbers: "About to backfill <name> v<n> on N past
   calls. This bills about $X." Then `POST /:id/backfills`.
5. Poll `GET /:id/backfills/:jobId` every minute or so. Report counts and
   `excluded` by reason at the end. Backfill results do not send webhooks.

## Diagnose a blank, wrong or missing result

Budget: reads only until the cause is known.

1. Get the call id (from the user or the Conversations page).
2. `GET /call-runs?callIds=<call id>`.
   - No entry: walk [why nothing ran](how-it-works.md#when-it-goes-wrong):
     disposition state, published version, the call's agent, completion,
     simulation, redaction, timing.
   - `pending`, `queued`, `running`: not finished. `within_24h` can take a
     day.
   - `failed` or `cancelled`: report `error.code` and `error.message`.
   - `complete` with a blank value: read that value's `state`. `no_value`
     means the model found nothing that fits the rule; `error` carries a
     reason.
3. For a wrong value, test the live version on that call:
   `POST /:id/runs` with `target: "published"` and
   `{"mode":"calls","callIds":["<call id>"]}`, then read the rationale.
   Continue with [calibrate](#calibrate).
4. For a webhook complaint, check `postCallWebhook.mode` on the version the
   run used, then the call's webhook delivery evidence.

## Migrate v1 citations and outcomes

Follow [migration](migration.md): read sources, choose `direct` or
`upgrade`, confirm, start, follow, then test and publish each draft, and
tell the user v1 keeps running until they detach it.
