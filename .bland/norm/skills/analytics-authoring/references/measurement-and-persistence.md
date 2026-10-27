# Measurement and persistence

## Traffic semantics

Keep org, agent, version/structure, window, timezone and cohort filters
attached to every measurement. Do not mix agent IDs with org IDs or v1 pathway
keys. A migrated agent may have historical traffic keyed differently; verify the
mapping from evidence rather than broadening the cohort to the entire org.

Distinguish a successful query with no rows from denied access, a missing
table, or data that has not been processed yet ([freshness](how-it-works.md#how-it-reaches-a-live-call-or-conversation)). Report the queried scope; none establishes
that the customer has never had calls. A structural graph is not traffic.

An aggregate edge traversal count is not a distinct-call count. Loops and revisits
can inflate it. Adding a→b and b→c double counts callers who traverse both.
Merging nodes needs call-level deduplication or suitable precomputed set metrics.
Never derive unique caller conversion or a conserved funnel by summing aggregate
edge counts. Check what a table means before interpreting its name: a waypoint-by-outcome
aggregate may mean “calls that visited this waypoint and eventually had outcome
X,” not “calls that ended at this waypoint.” Such rows overlap and must not be
summed across waypoints as mutually exclusive destinations. Use verified exit or
terminal-event semantics for destinations. Terminal states need observed call outcomes; a transfer node does
not prove a successful transfer, nor a booking node a completed reservation.

For a custom metric, write a local proposal specifying: name, per-agent scope,
unit, numerator, denominator, eligible cohort, event/outcome predicate, deduplication
key, null/unknown handling, time basis, and source availability. Rates require a
clear denominator. Distinguish proposed formulas from verified computations.
Do not advertise dynamic headline metrics when only a fixed metric registry is
available in the connected deployment.

## Saving a definition

The supported mutation is the customer waypoint-definition API described in
[the contract](contract.md): save a pending draft, preview it, publish it.
Every write names the structure it was written for through `expected_fingerprint`.
Record the returned `definition_id`, confirm with a chart read on the page's
`window` that `waypoints.customer.lifecycle` is `published`, and report
generated, validated, saved, and served as separate facts: `served` can be
false after a successful publish (under 5 conversations on the structure, or
the organisation's serve mode), and that is not a failed save. Never
retry an ambiguous write before re-reading; never touch the agent's versions,
deployments, or the inferred definition rows to change a chart.

A one-off query answers a measurement question; it does not create or change
an analytics view. Do not save a dashboard panel and call it a Sankey.

## Prompt examples

- Simplify the Sankey to 3 waypoints.
- Combine greeting and qualification; split reservations from transfers.
- Rename the payment stage and tell me what changed from the previous version.
- Gate access and payments are parallel branches, not steps; draw them that way.
- Show successful reservations as an outcome, and tell me which data can
  actually measure success (a dispositions question, not a grouping).

## User-defined outcomes

A request to distinguish completed, partial, abandoned, transferred, voicemail,
DNC, or human-versus-automated interactions is a semantic classification task.
A waypoint definition alone cannot implement it. Keep operational outcomes
(such as contained or escalated) distinct from user-defined business success.
Choose the chart after defining what can be measured: an outcome distribution
and supporting breakdowns may answer the question better than invented paths.

Translate the user's words into an inspectable local outcome specification:
- preserve the requested outcomes and their definitions; add an explicit
  insufficient-evidence state rather than forcing every call into a named bucket;
- identify required evidence for each predicate: ordered transcript turns,
  recorded node transitions, verified field extraction, tool results, transfer
  connection events, or audio; label absent evidence unavailable;
- distinguish primary outcome from secondary dimensions such as intent, human/AI
  counterpart, completion level, transfer destination, or DNC position;
- make overlaps explicit. Propose precedence for a mutually exclusive headline
  distribution and retain secondary flags so a late DNC request does not erase
  the fact that partial work occurred. Ask only when the unresolved precedence
  materially changes the answer; otherwise state the assumption;
- set the cohort, stable call-ID deduplication key, denominator, time basis,
  unknown handling and evidence references. Percentages over classified calls
  and over all selected calls are different and must be labelled;
- keep input data, per-call labels, aggregated results and a reproducible counting
  script separate. Existing platform schemas may not support the proposed
  outcome predicates; a local specification is not executable saved analytics.

Use model judgment for semantic interpretation, not a universal keyword table.
An invocation or positive assistant promise is not confirmation that a tool
worked. A transcript's "transfer you now" does not prove a human answered.
Absent voicemail evidence is not evidence that the call was stuck in an IVR.
Missing role/name fields do not imply partial completion unless the positive
criteria for partial completion were also observed. Human-versus-AI identity
requires supporting evidence, not a guess from polite or repetitive wording.
For DNC, distinguish a request to stop contact from a request to stop talking;
retain the supporting turn and node if available. Time position needs timestamps
or an explicitly labelled transcript-relative approximation.

Use `call-analysis` when per-call classification is required. A completeness
ledger must reconcile selected = classified + inconclusive + retrieval_failed +
not_processed, with mutually exclusive accounting states. Keep incomplete
transcripts distinguishable from complete calls with negative evidence.
Preserve each call's version and do not project a convenience sample's rates to
all traffic. Rare outcomes absent from a sample remain untested, not proven.

## Editing the displayed chart

Start from the actual displayed definition and its revision/hash, agent/version,
window, filters and unsaved draft if the host provides one. Page text or a
screenshot is not the complete configuration. Discover an allowed structured
read when necessary; do not reconstruct an existing chart from telemetry when
its definition is available. Preserve unrelated groups, stable IDs, predicates
and filters. Save a local before/after diff and validate the proposed change.

Preview through the product's actual grouping and rendering semantics when
available. Omitted members may form a visible Unclassified node; synthetics may
be placed at fold time. Report its measured reach and final-exit share, not just
how many IDs were omitted. Do not replace a poor product graph with a different
call partition and claim the requested edit is ready. If the product adapter is
unavailable, label a standalone illustration as illustrative, and leave product
rendering unverified. For a new-chart benchmark, keep the existing definition
in the evaluator only; do not feed the expected grouping as the model's answer.
