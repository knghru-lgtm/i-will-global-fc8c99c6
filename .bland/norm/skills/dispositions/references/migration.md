# Migrating v1 citations and outcomes into dispositions

v1 citation schemas and outcomes keep running on v1 calls. Migration copies
them into new **draft** dispositions on a v2 agent. It never edits, disables
or deletes a v1 resource, and nothing new runs until each draft is
published. Concepts: [how dispositions work](how-it-works.md). Routes below
are relative to `/v2/agents/:agentId/dispositions`.

## Contents

- [Pick the sources](#pick-the-sources)
- [Direct or upgrade](#direct-or-upgrade)
- [Start and follow a migration](#start-and-follow-a-migration)
- [How v1 objects map](#how-v1-objects-map)
- [What does not migrate](#what-does-not-migrate)
- [After the migration](#after-the-migration)
- [Errors](#errors)

## Pick the sources

`GET /migrations/sources` (read, any member) returns:

```text
{
  sourcePathwayId,                      v1 pathway this agent was migrated from, or null
  citationSchemas: [{ id, name, description, variableCount, suggested }],
  outcomes:        [{ id, name, suggested }],
  judgeDispositions: [{ dispositionId, name, state, definitionSource,
                        judges: [{ judgeId, judgeVersionId, name, modality,
                                   valueKeys, movable, reason }],
                        productionCalls, suggested }]
}
```

- The citation and outcome lists hold every schema and outcome in the
  organization. `suggested: true` marks the ones the agent's source pathway
  actually used (recent calls, attached numbers, its persona settings).
  Start from the suggested ones and confirm the rest with the user.
- `judgeDispositions` are existing v2 dispositions on this agent with judge
  values. Moving them copies each movable text judge (see below).

## Direct or upgrade

| | `direct` ("Migrate as is") | `upgrade` |
|---|---|---|
| Answers | 201 at once | 202, then a run you follow |
| Produces | Disabled drafts | The same drafts, then refined against v1 results |
| Checks parity | No | Yes: backtests on the source pathway's v1 calls |
| Size | Up to 20 of each source type | At most 3 resulting dispositions per run |
| Spend | None at start | Its backtests are disposition test runs (billed like any test run) |
| Rate limit | 20 starts per hour per organization | 4 starts per hour per organization |

Use `direct` when the user wants the definitions moved and will test them
the normal way. Use `upgrade` when they want the migration checked against
what v1 produced, and the agent has a recorded source pathway with recent
completed calls.

## Start and follow a migration

Confirm first (template in [the API reference](api.md#confirm-before)), then:

```json
{"method":"direct","sources":{"citation_schema_ids":["<schema id>"],"outcome_ids":[]}}
```

```json
{"method":"upgrade","sources":{"citation_schema_ids":["<schema id>"],"outcome_ids":["<outcome id>"]},"backtest":{"requested_size":25}}
```

- `POST /migrations`. `citation_schema_ids` and `outcome_ids` are required
  arrays (may be empty); `judge_disposition_ids` is optional. At least one
  id overall. `backtest.requested_size` is 1 to 500, default 25.
- `direct` answers `{migration:{method, disposition_ids, warnings, judge_copies}}`.
  Read each warning to the user: it names a source that was skipped.
- `upgrade` answers `{run}`. Poll `GET /migrations/:runId` about every 30
  seconds. Report `stage` (`queued`, `authoring`, `backtesting`,
  `converging`, `finalizing`) and `iteration`.
- Terminal `status`: `COMPLETE`, `FAILED` or `CANCELLED`. A `COMPLETE` run
  carries `result.verification`: `verified` (every value matched v1) or
  `unverified` (parity was not reached on every value, or a source was not
  covered). Report `result.scores` and `result.warnings`, and open
  `result.latest_test_run_ids` as test runs for the disagreements.
- Cancel only when asked: `POST /migrations/:runId/cancellations` (202).
  Drafts already created stay on the agent.
- One migration runs per agent at a time (409). The person who started an
  upgrade gets an email when it ends (not on cancel).

## How v1 objects map

| v1 object | Becomes |
|---|---|
| Citation schema | One disposition. Each variable becomes a structured-extraction value with its own new extractor. Payload field names keep the v1 variable names where they can. |
| Variable type | boolean, number and string keep their type; categorical becomes an enum (a string when there are no options, more than 24, duplicates, or an option over 64 characters); arrays stay arrays. |
| Grouped variables | One object value. |
| Conditional variable | A value that only extracts when its condition holds. |
| Outcome | A custom-code value that runs the outcome's script on the v1-shaped input. It joins the schema it most often ran with, or gets its own disposition. |
| Judge disposition | Each movable text judge is copied to a new judge on this agent named "(migrated)"; the draft points at the copy. The original judge is not edited. |

Timing is `immediate`. Delivery is `hold` when the organization delays its
post-call webhook for citations, otherwise `emit_followup`
([delivery](how-it-works.md#how-it-reaches-a-live-call)).

## What does not migrate

Each comes back as a warning ("… was skipped: …"):

- A schema that maps to more than 50 values, or a variable prompt over 8000
  bytes.
- Grouped or array members whose names collapse to the same key.
- An outcome script that is not a single default `fetch` export, reads call
  fields v2 does not carry (recording URL, metadata, answered-by), reads
  more than 20 variables, or needs inputs from several selected schemas.
- Audio judges, deleted judges, and judges already moved.
- An outcome with no usable v1 results is migrated, but delivers its value
  as JSON text; the warning says so.

## After the migration

1. The drafts are disabled. Test each one on recent calls
   ([test runs](api.md#test-runs)) and show the user the results.
2. Publish each with its own estimate and acknowledgement
   ([publish](api.md#lifecycle-and-operations)).
3. v1 keeps running wherever the schema or outcome is still attached (calls,
   numbers, personas). Once v2 dispositions are live, both produce results
   for the same traffic until the user detaches the v1 source. Say this
   before publishing.

## Errors

| Status | Meaning |
|---|---|
| 400 "Select at least one citation schema, outcome, or judge disposition to migrate" | Empty selection |
| 400 "This agent has no recorded source pathway…" | `upgrade` has no v1 calls to compare; use `direct` |
| 400 "The source pathway has no completed calls with results…" / "A backtest of N calls cannot cover…" | Raise `requested_size` or drop that source |
| 409 "A disposition migration is already running for this agent" | Wait for or cancel the active run |
| 422 "An upgrade run verifies at most 3 dispositions…" | Split the selection |
| 422 "None of the selected sources could be migrated." | Every source was skipped; read the warnings |
| 503 with a FAILED `run` | The drafts were created; retry the upgrade later |
