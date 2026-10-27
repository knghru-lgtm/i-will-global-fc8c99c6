# Human-friendly analytics design

The model supplies the judgment: interpret intent, select useful milestones,
recognize plumbing, propose readable labels, and explain what can be measured.
The validator checks mechanical validity; it cannot decide whether a chart
answers the question. Do not substitute a fixed keyword classifier or a template
that forces every agent into the same stages.

## Start with the decision

Turn the request into: “For this agent and cohort, the user wants to understand
___ so they can decide ___.” Infer reasonable intent from the prompt and attached
page. Ask one focused question only if different interpretations would materially
change the population or answer; otherwise state the assumption and draft it.

Examples:

| User intent | Useful first view |
|---|---|
| Where do callers drop out of booking? | Booking journey, with measured completed bookings and exits |
| Why do people reach a human? | Main reasons/branches leading to measured handoff outcomes |
| Is payment collection improving? | Trend in a defined successful-payment rate, with denominator |
| What does this agent handle? | Compact structural overview of business intents, unweighted without traffic |
| Compare facilities | Segmented counts/rates with equivalent windows and denominators |

One-off SQL is a measurement tool, not a substitute for a persisted analytics
view. The Sankey is saved through the waypoint-definition API
([contract](contract.md)); trends, comparisons and per-call outcome splits live
on other surfaces, so say which surface answers the question before drafting.

## Select milestones, not implementation steps

A stage should answer something a customer cares about: reason identified,
account identified, reservation attempted, payment completed, or human reached.
Separate an attempted action from its confirmed outcome. Prefer customer language
such as “Account identified” over internal labels such as “GET account lookup”.

Typically fold retries, variable extraction, code execution, fallback routers,
identity plumbing, and repeated versions of the same step into the relevant
business stage. Omit unrelated branches from a focused preview and document the
omission. A shared global hub is often routing infrastructure, not a meaningful
stage every user needs to see. Do not use a giant “Other” group merely to reach
100% coverage; disclose unmapped coverage. In a connected product preview, retain the actual
derived unclassified behavior and its traffic share. Group known routing and
closure nodes by their business context when appropriate; hiding them in an
alternate visualization does not fix the saved definition.

Keep stable stage IDs when changing labels or membership. Split a stage when
its outcomes imply different decisions; merge adjacent stages when their
separation adds no useful information. Seven is the current backend maximum,
not the target stage count. Explain a backend constraint if the user's design
needs more; never silently discard part of their request.

## Reduce visual noise without changing the facts

Choose one main question per chart. Put secondary breakdowns in supporting
tables or proposed drill-downs, not dozens of competing branches. Combine
semantically equivalent paths where the counting source supports that merge.
Do not sum edge aggregates and pretend callers were deduplicated.

Do not render every structural edge: global routing makes almost any stage
reachable from any other and produces an all-to-all hairball. For an unweighted
preview, show a stage table or a small set of source-supported illustrative paths,
explicitly marked as a simplified structural view. Do not imply hidden edges
cannot occur or that illustration order is measured chronology. Keep omitted
routes and full membership available in the evidence artifact.

With measured data, select dominant paths only after verifying their counts.
Preserve the denominator and disclose excluded volume; do not drop rare failures
that matter to the user's question. Support for hidden groups, drill-downs,
branch filters, or arbitrary terminal predicates must be verified in the actual
renderer/API. Describe unsupported behavior as a proposal, not working config.

## Sanity-check the design

Before presenting it, ask:
- Can the user understand the main answer from the labels without opening nodes?
- Does each split help answer their question?
- Are attempts, confirmed outcomes, unknowns, and drop-offs distinguished?
- Are internal routers and repeated tool calls cluttering the main view?
- Is the chart honest about what is observed, inferred, and unavailable?

Return a concise rationale for the chosen stages and an inspectable mapping.
If sources are insufficient, deliver a useful structural proposal and state
exactly which event/outcome evidence would turn it into measured analytics.
