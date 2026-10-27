# V2 product surface and source-of-truth map

Use this as a coverage/navigation map, not a prompt to load every reference.
The plugin teaches product behavior; the host provides workspace execution,
authenticated API tools, and optional browser/voice support. The current API
schema wins when a deployment differs. Missing capabilities must be reported,
not replaced with guessed routes, model names, or private platform code.

| Surface / task | Local source | State to identify before acting |
|---|---|---|
| Create a new agent | [Authoring](../../v2-authoring/SKILL.md) | Org, desired scenarios and caller contract. |
| Modify/repair an existing agent | [Maintenance](../../v2-maintenance/SKILL.md) | Saved base, draft, branch, version/revision and intended delta. |
| Snapshot shape and all node families | [Snapshot](../../v2-snapshot/SKILL.md), [node catalog](../../v2-snapshot/references/node-catalog.md), [field dictionary](../../v2-snapshot/references/knobs.md) | Authoring dialect, not compiled runtime fields. |
| Entry, nested routes, hidden canvas edges | [Builder/runtime map](../../v2-runtime/references/builder-runtime-map.md) | Start target, root/nested scope, generated routes and auth membership. |
| Execution order, loops, globals, variables | [Execution phases](../../v2-runtime/references/execution-order.md), [runtime](../../v2-runtime/SKILL.md) | Actual candidate and turn evidence. |
| Tools, snippets, webhooks, scheduling, transfers | [Tool library skill](../../tool-library/SKILL.md), [procedures](../../tool-library/references/workflows.md), [tool contract](../../v2-runtime/references/tool-library.md), [Tools and handoffs](../../v2-runtime/references/tools-and-handoffs.md), [node catalog](../../v2-snapshot/references/node-catalog.md) | Org-owned references, resolved inputs, side effects and result. |
| Audio controls, barge-in, silence, latency | [Interruptions](../../v2-runtime/references/interruptions.md), [voice testing](../../v2-testing/references/voice.md) | Channel, active setting scope, accepted input and heard output. |
| Knowledge, memory, history, reuse, collaboration | [Knowledge sources skill](../../knowledge-sources/SKILL.md), [Resource boundaries](../../v2-lifecycle/references/resources.md) | Snapshot versus external resource, freshness and ownership. |
| Versions, branches, publish/promote/rollback | [Lifecycle](../../v2-lifecycle/SKILL.md), [API map](../../v2-lifecycle/references/api.md) | Exact candidate, environment values and current promotion policy. |
| Environments page: `{{env.KEY}}` variables, promotion checks, branch and merge | [Agent environments](../../agent-environments/SKILL.md), [procedures](../../agent-environments/references/environments.md) | Which environment resolves the candidate, referenced versus set keys, the staging check config and the latest run for the exact candidate, branch `behind`. |
| Phone binding, identity, experiments | [Phone numbers skill](../../phone-numbers/SKILL.md), [Rollouts](../../v2-lifecycle/references/rollouts.md), [Lifecycle](../../v2-lifecycle/SKILL.md), [resources](../../v2-lifecycle/references/resources.md) | Active channel/pin, external effects and account capability. |
| Scenarios, assertions, simulations, test chat | [Testing](../../v2-testing/SKILL.md) | Fixture, candidate, side effects, run and trace. |
| Judges, calibration, evaluation cohorts/results | [Evaluations](../../evaluations/SKILL.md) | Judge identity/version, roster, evidence and denominator. |
| Dispositions, extractors, post-call outputs | [Dispositions](../../dispositions/SKILL.md), [how it works](../../dispositions/references/how-it-works.md), [API](../../dispositions/references/api.md) | Draft revision, live version and state, pinned dependencies, test-run cohort, delivery mode. |
| Analytics Sankey (waypoint definitions) | [Analytics authoring](../../analytics-authoring/SKILL.md) | Agent, production pin, fingerprint, published and pending definitions, window. |
| Conversation cohorts (filtered call lists) | [Analytics cohorts](../../analytics-cohorts/SKILL.md), [contract](../../analytics-cohorts/references/contract.md) | Agent, window, predicate and cost class, cohort id, status, size and truncation, expiry. |
| Call/conversation analysis and recordings | [Call analysis](../../call-analysis/SKILL.md) | Stable IDs, attribution, bounded cohort and accessible evidence. |
| Alerts, automations, connected integrations | [Automations skill](../../automations/SKILL.md), [Tool library skill](../../tool-library/SKILL.md), [Operational resources](../../v2-lifecycle/references/resources.md#operational-surfaces), [API discovery](api.md) | Their separate current API contract, agent scope and ongoing effects. |
| Import/migrate from v1 | [Migration](../../v2-migration/SKILL.md), [lifecycle API](../../v2-lifecycle/references/api.md) | Source identity, preserved behavior, migration mode and run. |
| Browser page context and UI effects | [Workspace state](workspace.md) | Fresh page/draft revision; accepted changes versus displayed changes. |
| Launch checklist (built to live, in order) | [Agent launch](../../agent-launch/SKILL.md) | Latest version, pins, attached knowledge and tools, numbers, channels; promote before attach. |
| Web chat widget, API chat, texting on a number | [Agent channels](../../agent-channels/SKILL.md) | Which channel, production pin versus dev head, bound number, who gets texted. |
| Outbound calls, scheduling, batches | [Outbound calls](../../outbound-calls/SKILL.md) | Agent version selector, caller id, recipients, rate limits, DNC. |
| Issues (triage) | [Triage issues](../../triage-issues/SKILL.md) | Agent scope, evidence ids, open duplicates, who is assigned. |
| Voices and spoken language | [Voices](../../v2-lifecycle/references/voices.md) | Voice id resolves and is live, language code, production pin. Preview, cloning, studio: dashboard only. |
| Active calls, live end and transfer, contacts | [Live calls and contacts](../../call-analysis/references/live-calls-and-contacts.md) | Call still live, do-not-call on the transfer target, contact match and merge direction. Listening and the live transcript are dashboard only. |
| Agent identity: contact card, branded caller ID, RCS sender | [Identity](../../agent-channels/references/identity.md) | Application status, numbers in the application, sender per number. |
| Pathways page: library, copies, folders | [Pathway library](../../v2-lifecycle/references/pathway-library.md) | Owning agent, newest save versus pin, copies are independent. |
| Overview pages (org and agent) | [Overview pages](../../analytics-cohorts/references/how-it-works.md#overview-pages) | Window (30 days on the globe, 90 on Analytics). |
| Headline metric tiles, aggregate questions | [Metric tiles](../../analytics-cohorts/references/metrics.md), [measurement](../../analytics-cohorts/references/measurement.md) | Agent, window, attached `metric` target, backfill scope. |

Every feature also has a conceptual page; the index lists them under
[How each feature works](index.md#how-each-feature-works).

## Working contract

1. Discover the authenticated API and relevant docs using advertised tools. No
   API tools is a capability failure, not a reason to fabricate work in the UI.
2. Read target state into workspace files; preserve original revision and IDs.
   Large call datasets and snapshots belong in files, not repeated chat payloads.
3. Use code for transformations/analysis and API operations for actual resources.
   User-uploaded files and per-turn injected page context have different lifetimes.
4. Validate the intended delta, submit within scope, read back, then test the
   actual accepted version. Follow asynchronous jobs by returned ID.
5. Use the host's UI synchronization mechanism for accepted mutations. Browser
   controls remain available for requested browser work; a cursor animation is
   neither a mutation receipt nor proof of synchronized state.

## Limits and freshness

This map covers the known v2 product families, not every future field or every
feature entitlement. Some ancillary APIs intentionally require live discovery;
the wiki does not promise offline completion of unsupported operations. Distinguish
“not documented locally,” “not enabled for this account,” and “request failed.”

Behavioral contracts were reviewed against the available September 2026 source.
Confirm the target deployment's tool schema before using newer capabilities such
as exact-version promotion, disposition workflows or collaboration. An older
server may not implement them. Never bypass a check, change orgs, or deploy merely
because a newer local reference describes a feature.
