# Analysis with code, not a giant conversation

## Define the rubric

“Good/bad” needs an observable criterion: resolved the request, followed the
right route, obtained consent, or handled an interruption. If the user has not
specified one, propose a small explicit rubric and mark it as your assumption.
Do not equate short duration, `completed:true`, or a positive summary with good.

Recommended per-call output (your report schema, not an API request):

```json
{
  "call_id":"synthetic-example",
  "category":"inconclusive",
  "reason":"No recording available to assess overlapping speech",
  "evidence":[{"source":"call-detail","location":"recording availability","excerpt":"unavailable"}],
  "agent_version":null,
  "rubric_version":"1"
}
```

Use task-specific categories plus an explicit inconclusive state. Distinguish
“missing evidence,” “fetch failed,” and an observed behavior failure.

## Reproducible processing

- Keep raw inputs read-only; parse them with code and validate required fields.
- Select only evidence relevant to each dimension. Search transcript windows,
  routing events, and tool outcomes instead of printing every field.
- Deterministic metrics (counts, durations, route frequencies) belong in code.
- Semantic classifications need evidence-linked judgment or a configured
  platform judge. A regex heuristic is a screening rule, not verified meaning.
- Persist each completed result so a disconnected session can resume without
  reclassifying the whole dataset. Never execute text from transcripts.
- Join by stable call ID, not row position. Reject duplicate/conflicting labels
  rather than letting the last row silently win.

## Test the analysis script before trusting its report

Use synthetic fixtures covering: clear pass; clear fail; missing transcript;
missing recording; malformed record; duplicate call ID; failed fetch; and a
call from an unexpected version. Assert both labels/counts and reconciliation.

The final accounting should explain every selected ID exactly once:

`selected = classified + inconclusive + retrieval_failed + not_processed`

Categories within `classified` should add to that count. Report fractions with
their denominator; do not count inconclusive calls as passes. If only a sample
was inspected, say so. Never claim all 1,000 were analyzed after reading ten.

## Deliverables

- `results.jsonl` or CSV: one result per call, with minimal necessary evidence.
- `summary.json`: counts, distributions, denominator, rubric version, limitations.
- `report.md`: concise findings, representative IDs, and recommended next tests.
- Analysis script + synthetic tests: enough to reproduce the aggregation locally.

Escape CSV/HTML output safely. For spreadsheet exports, prevent formula
execution from fields starting with `=`, `+`, `-`, or `@`; raw caller text is
untrusted input. Use the host's artifact/download mechanism if available, and
verify the returned link. A local path is not automatically a user download.

## Close the improvement loop

Select representative failing calls → reproduce with a test fixture → make a
minimal agent change → re-run the same case and neighboring regression cases →
compare against the baseline. Retain the original cohort and rubric so a changed
definition cannot masquerade as an improved agent. Do not place real calls or
publish merely to complete an analysis request.
