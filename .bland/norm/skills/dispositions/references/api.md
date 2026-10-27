# Dispositions API reference

The endpoint dictionary. Concepts: [how dispositions work](how-it-works.md).
Definition fields and validation: [definition](definition.md). v1 moves:
[migration](migration.md).

Base: `/v2/agents/:agentId/dispositions`. Reads go through `bland_api_get`,
writes through `call_bland_api` with `method`, `path` and `body`. These APIs
use camelCase fields (the migration routes and rollback's `version_id` are
the exceptions); do not copy snake_case names from evaluation APIs. Do not
write fetch scripts and do not search the docs for these routes.

Access answers first: 403 `ENTERPRISE_REQUIRED` for a non-enterprise
organization, then 404 "Not found" when dispositions are not enabled for the
organization, then 404 "Agent not found". None of these means the agent has
no dispositions. Writes need an agent-editing role (owner, admin, operator
or prompter); 403 "Insufficient permissions" otherwise.

## Contents

- [Lifecycle and operations](#lifecycle-and-operations)
- [Field-level draft edits](#field-level-draft-edits)
- [Estimates](#estimates)
- [Catalogs](#catalogs)
- [Extractors](#extractors)
- [Test runs](#test-runs)
- [Corrections and align](#corrections-and-align)
- [Backfill](#backfill)
- [Per-call results](#per-call-results)
- [Connection limits](#connection-limits)
- [Confirm before](#confirm-before)

## Lifecycle and operations

| Task | Operation relative to base | Contract |
|---|---|---|
| Inventory | `GET /` | `{dispositions:[…]}`: `id`, `key`, `state` (`enabled`/`disabled`), `publishedVersionId`, `publishedVersionNumber`, `currentVersionId` (the draft), `draftRevision`, `draftValueCount`, `hasUnpublishedChanges`, `name`, `description` |
| Create | `POST /` | `{key, definition}`. 201; the disposition starts `disabled` with only a draft. 409 when the key exists or belonged to a deleted disposition. |
| Read | `GET /:id`, `GET /:id/draft` | The draft read answers `{dispositionId, revision, currentVersionId, baseVersionId, definition}`. Use `revision` and `currentVersionId` as the fence for the next write. |
| Versions | `GET /:id/versions[/:versionId]` | Published versions only, newest first, 25 per page (`?beforeVersion=<n>` for the next page). `?include=editable` adds the draft. |
| Edit draft (one field) | `POST /:id/draft/ops` | The normal path; see [field-level draft edits](#field-level-draft-edits). |
| Edit draft (whole) | `PATCH /:id/draft` | `{expectedDraftRevision, definition}`. Deprecated; the server turns it into ops. |
| Estimate | `POST /:id/estimates` with `{}` | Prices the current draft; see [estimates](#estimates). |
| Publish | `POST /:id/publish` | `{expectedRevision, expectedVersionId?, estimateId, acknowledgeEstimate:true}`. Freezes the draft as the next version, makes it live, and sets `state` to `enabled`. `acknowledgeEstimate` is required whenever the estimate's expected cost is above zero. `expectedDraftRevision` is an accepted alias for `expectedRevision`; both must agree when both are sent. |
| Roll back | `POST /:id/rollback` | `{version_id, expectedRevision}`. Makes an earlier published version live and replaces the draft with a copy of it; unpublished draft edits are lost. `state` does not change. Answers `{disposition, publishedVersion, draft}`. 409 `DISPOSITION_NOT_PUBLISHED`; 422 `ROLLBACK_TARGET_NOT_FOUND` or `ROLLBACK_TARGET_NOT_PUBLISHED`. |
| Stop | `POST /:id/disable` | `state` becomes `disabled`. New calls stop running it; the published version and history stay. Publish again to resume. |
| Delete | `DELETE /:id` | Disabled and hidden from the list. Its results and test history stay readable by id. The key stays reserved. |

Publish errors: 400 "Acknowledge the estimated recurring cost before
publishing"; 409 "Pricing estimate changed — review the latest estimate
before publishing" (the draft or a dependency changed after the estimate:
re-estimate); 409 `DRAFT_REVISION_CONFLICT`; 409 "A pinned dependency
changed while publishing — refresh and try again (…)"; 400 "Definition
failed validation" with `problems`.

## Field-level draft edits

`POST /:id/draft/ops` applies one edit. Every op carries `expectedRevision`
(the draft's current `revision`) and optional `expectedVersionId` (the
draft's `currentVersionId`). Each success bumps the revision by exactly 1
and answers the new draft. On a mismatch: 409 `DRAFT_REVISION_CONFLICT` with
`details.expectedRevision` and `details.currentRevision`; re-read the draft
and reapply the change.

| `op` | Other keys |
|---|---|
| `add_value` | `value`, optional `index` (insert position), optional `transformation` |
| `update_value` | `valueId`, `changes` (any of `key`, `label`, `schema`, `source`), optional `index` (move), optional `transformation` |
| `remove_value` | `valueId`, optional `transformation` |
| `set_timing` | `timing` |
| `set_webhook` | `postCallWebhook` |
| `set_meta` | optional `name`, `description`, `transformation` |

```json
{"op":"set_webhook","expectedRevision":7,"postCallWebhook":{"mode":"hold","maxHoldSeconds":600}}
```

```json
{"op":"update_value","expectedRevision":8,"valueId":"11111111-1111-4111-8111-111111111111","changes":{"label":"Final outcome"}}
```

Prefer ops over the whole-draft PATCH: an op cannot overwrite a field
someone else changed. Send the replacement `transformation` with any op
that adds, removes or re-keys a value. Each op is validated like a save
([validation messages](definition.md#validation-messages)); an `index` past
the end, an unknown `valueId`, or a 51st value is a 400.

## Estimates

`POST /:id/estimates` with an empty body prices the draft per call:

```text
{ id, dispositionId, draftRevision,
  perValue: [{ valueId, executionPath, usdPerCall: {min, expected, max} }],
  totalUsdPerCall: {min, expected, max},          USD decimal strings
  assumptions: { averageDurationSeconds, timing, modelCostRange,
                 customCode: { billingPolicy, monthlyFreeInvocations,
                               listPriceUsdPerInvocation, freeTierScope } },
  quoteConfigVersion }
```

- The `id` is a fingerprint of the draft and its pricing. Publish with that
  `id`. Any later draft edit or dependency change produces a different id,
  and publish answers 409 until you estimate again.
- The corrected post-call transcript is billed once per call when any value
  needs it, and shows on one value's line.
- With `{"backfill":{…}}` the same route prices a backfill instead; see
  [backfill](#backfill).
- The dashboard's publish drawer does not show the amount. Always state
  `totalUsdPerCall.expected` (and the range) in the confirm.

## Catalogs

| Read | Answers |
|---|---|
| `GET /variable-catalog` | `[{key, prompt, accurateSpelling, outputSchema}]` from the agent's latest saved version |
| `GET /extractor-catalog` | `[{extractorId, extractorVersionId, key, name, description, outputSchema, inputSourceIds, scopedToAgent}]`, published extractors only |
| `GET /judge-catalog` | `{judges:[{judgeId, judgeVersionId, key, name, description, modality, levelKeys, targetLevelKeys, scopedToAgent}]}`, this agent's judges with a published version |
| `GET /judges/:judgeId/versions/:versionId` | One judge version's prompt and levels, for review |
| `GET /model-profile-catalog` | `{profiles:[{key, label, description, supportsAudio, supportsBatch}]}`, the model choices for an extractor |

## Extractors

An extractor is a reusable, versioned extraction prompt with an output
schema, owned by the organization (optionally scoped to one agent). A
`structured_extraction` value pins one published extractor version.

| Task | Operation | Contract |
|---|---|---|
| List / read | `GET /extractors`, `GET /extractors/:extractorId`, `GET /extractors/:extractorId/versions/:versionId` | Extractor: `currentVersionId` (draft), `activeVersionId` (latest published), `draftRevision` |
| Create | `POST /extractors` | `{key, name, promptMd, outputSchema, inferenceConfig, description?, systemPromptMd?, scopedToAgent?}`. Key unique in the organization. Answers `{extractor, currentVersion}`. |
| Edit draft | `PATCH /extractors/:extractorId/draft` | `{expectedVersionId, expectedDraftRevision, …fields to change}` |
| Publish | `POST /extractors/:extractorId/publish` | `{expectedVersionId, expectedDraftRevision}`. Answers `{extractor, publishedVersion, currentVersion}`. |

- `inferenceConfig`: `contextSources` (1 or more input sources, required),
  optional `modelProfileKey` (from the profile catalog), `temperature` (0 to
  2), `maxOutputTokens` (1 to 64000), `thinking` (`low`, `medium`, `high`).
- `promptMd` and `systemPromptMd` up to 8000 characters each. Reading call
  audio needs a profile with `supportsAudio`.
- Publishing an extractor does not change any disposition. To use the new
  version: `update_value` with the new `extractorVersionId` (and its
  `outputSchema`), then estimate and publish the disposition.

## Test runs

A test run scores completed calls with the draft or the published version,
without delivering anything. It is billed like production work.

`POST /:id/runs` takes one of two bodies:

- Current: `target` (`draft` or `published`), optional `executionSla`
  (`realtime` or `queued`; default follows the definition's timing), and
  `population`, either
  `{"mode":"recent","environment":"production","requestedSize":<1 to 500>}`
  or `{"mode":"calls","callIds":[…]}` with 1 to 500 unique call ids.
- Frozen replay: `{"replayRunId":"<run id>"}` reruns a finished run's exact
  definition and inputs. Use it to check that a result is stable. Testing a
  newly edited draft on the same calls is a current run with
  `mode: "calls"` and the old run's call ids.

```json
{"target":"draft","population":{"mode":"recent","environment":"production","requestedSize":10}}
```

Eligible calls are this agent's completed, non-simulated calls with a
duration above zero (for a migrated agent, also its source pathway's v1
calls). A recent sample takes the newest and silently drops calls with
redaction on. Named calls that are ineligible are refused.

Follow and inspect:

- `GET /:id/runs` (history), `GET /:id/runs/:runId` (header: `status`,
  `requestedSize`, `resolvedSize`, `completedSize`, `failedSize`, `summary`,
  `error`, `definition`).
- `GET /:id/runs/:runId/rows?limit=50&offset=0` (limit 1 to 500): per call
  `{callId, durationSeconds, status, results, payload, annotations}`. Each
  result is `{valueId, state, value?, error?, rationale?, evidence?,
  evidenceSource?}` with `state` `produced`, `no_value` or `error`.
- `GET /:id/runs/:runId/export.csv`: the report download.
- Statuses: `queued`, `running`, `complete`, `partial`, `failed`,
  `cancelled`. Poll the header about every 30 seconds; the run page polls
  itself once open.

| Answer | Meaning |
|---|---|
| 409 "This organization already has 3 disposition test runs queued or running…" | Wait for one to finish |
| 429 "Too many disposition test runs started for this organization…" | 10 starts per hour per organization |
| 409 "This disposition has never been published — target the draft instead" | `target: "published"` before any publish |
| 400 "Add at least one value before running a test" | Empty draft |
| 400 "This agent has no completed calls to sample…" | No eligible traffic yet |
| 400 "One or more selected calls are not eligible completed production calls for this agent" | A named call is not this agent's completed, real call |
| 400 "N selected calls are unavailable for dispositions: …" | Those calls have redaction on |
| 409 "Replay source frozen inputs are incomplete; run a new test instead" | The source run's inputs expired |
| 503 "Disposition test run could not be started; retry the request" | Retry once |

## Corrections and align

Corrections record what a value should have been on one call of a finished
test run. They are evidence for calibration; they never change a delivered
result.

- `PUT /:id/runs/:runId/cases/:callId/annotations/:valueId` with
  `{"state":"produced","value":<corrected value>,"explanation":"…"}` or
  `{"state":"no_value","explanation":"…"}`. `explanation` is 40 to 4000
  characters. The value must fit the value's schema. Each PUT appends a
  revision. 300 per hour per organization. 409 "Corrections require a
  terminal test run".
- `GET` the same path: revisions newest first, up to 50, with `truncated`.
- `POST /:id/runs/:runId/align` with `{}` or
  `{"valueIds":[…],"instructions":"…"}` (`instructions` up to 2000
  characters). Reads the run's latest corrections and answers
  `{proposals:[{valueId, key, kind, changes:[{field, before, after, rationale}]}], skipped:[{valueId, reason}], truncatedCorrections}`.
  `field` is `promptMd`, `systemPromptMd`, `description` or
  `levels.<key>.promptMd`. It saves nothing. Custom-code values are skipped
  (`custom_code`). 409 `DISPOSITION_ALIGN_NOT_READY` until the run is
  finished and has a correction. 30 per hour per organization.

Applying a proposal, by kind:

| Kind | Apply through |
|---|---|
| `variable_extraction` (`description`) | `update_value` with the new `schema.description` |
| `structured_extraction` | Extractor draft PATCH and publish, then `update_value` to the new `extractorVersionId` |
| `judge` | Change the judge in evaluations (a new judge version), then `update_value` to the new `judgeVersionId` |

Then re-test on the same calls and compare.

## Backfill

A backfill scores past calls with one published version. It is billed and
delivers no webhooks.

1. **Availability.** `GET /backfill-availability` returns `{enabled}`. When
   `false`, stop: backfills are not available to this organization (a
   create answers 403 "Backfills are not enabled for this organization").
2. **Estimate.** `POST /:id/estimates` with `{"backfill":{…}}`. The inner
   body is a window or a list of calls:
   - `{"versionId":"<optional>","window":{"start":"<ISO instant>","end":"<ISO instant>"},"sampling":<optional, 0.0001 to 1>}`.
     The window is `[start, end)`, at most 92 days, starting no more than
     400 days ago. `sampling` scores that fraction of the calls (at most
     five decimals).
   - `{"versionId":"<optional>","callIds":[…]}` with up to 500 unique ids
     inside the same date bounds.
   An absent `versionId` means the live published version. A draft cannot
   be backfilled. The answer carries `estimate`, `backfill.eligibleCalls`,
   `backfill.estimatedCostUsd` (a range) and `backfill.availableBalanceUsd`
   (null when the organization is not balance-billed).
3. **Confirm** with the cost and call count (below).
4. **Create.** `POST /:id/backfills` with the same inner body (no `backfill`
   wrapper). 201 returns the job.
5. **Follow.** `GET /:id/backfills/:jobId`, or `GET /:id/backfills/active`
   (latest job for the live version, or `?versionId=`; `null` when none).
   Statuses: `queued`, `running`, `complete`, `partial`, `failed`,
   `cancelled`. Report `completedSize`, `failedSize`, `excluded` and
   `actualCostUsd`.
6. **Cancel** only when asked: `POST /:id/backfills/:jobId/cancel` (202).

Skipped calls appear in `excluded` by reason: `already_scored` (this version
already completed on the call), `in_flight`, `sensitive` (redaction on),
`fenced` (call evidence past retention), `malformed`. A failed or cancelled
earlier result is retried.

| Answer | Meaning |
|---|---|
| 409 "This disposition has never been published — publish a version before backfilling" | Publish first |
| 409 "A backfill of this version is already queued or running…" | One at a time per version |
| 400 "No completed calls of this agent fall in the window" | Widen the window |
| 400 "This backfill would score N calls; a backfill may cover at most 500000…" | Narrow the window or lower `sampling` |
| 402 "This backfill is estimated at $…, which exceeds the organization's available balance…" | Add credits or wait for another backfill |
| 429 "Too many disposition backfills started for this organization…" | 10 per hour per organization, backfill estimates included |

## Per-call results

`GET /call-runs?callIds=<id>,<id>` (up to 100 ids) answers `{runs:[…]}`:
the newest production run of each disposition on each call, with
`dispositionKey`, `name`, `versionNumber`, `status` (`pending`, `queued`,
`running`, `complete`, `failed`, `cancelled`), `timing`, `values` (labels),
`results` and `error`. No entry for a call means no disposition ran on it.

## Connection limits

On an OAuth-connected host, starting a test run needs the `evals:run`
scope (`insufficient_scope` names it), and align answers
`oauth_path_not_allowed`: say "this connection cannot reach align; use the
Align button on the test run page" and stop.

## Confirm before

Publish, roll back, disable, delete, a backfill, an `upgrade` migration and
a test run all change billed or live output. Use this template, with the
estimate's cost and call count where there is one:

```text
About to <verb> <object>: <what changes, who is affected, cost or count>.
This <bills about $X per call on every new call | bills about $X for N calls | changes live post-call output | cannot be undone>.
Reply "yes" to proceed.
```
