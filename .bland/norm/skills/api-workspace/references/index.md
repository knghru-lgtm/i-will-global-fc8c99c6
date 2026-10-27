# Norm product wiki

Start with the row matching the task. Open that reference, not every file in
this index. Local references explain behavior; the connected tool schema and
current official API documentation determine the request that can be sent.

For the complete navigation/coverage map, including all node families,
dispositions, external resources and operational surfaces, read the
[v2 surface map](surface-map.md).

| Task / question | Read |
|---|---|
| Find an endpoint; use API tools from code; recover a failed request | [API workspace skill](../SKILL.md), [API contract](api.md) |
| Which state am I editing? Why does the dashboard look stale? | [Workspace and page state](workspace.md) |
| Why do nodes look disconnected? What does this JSON edit change in the UI? | [Builder JSON → runtime → canvas](../../v2-runtime/references/builder-runtime-map.md) |
| Is this audio barge-in, a topic change, or a global-node jump? | [Interruption mechanisms and setting scope](../../v2-runtime/references/interruptions.md) |
| Build a new v2 agent and choose scenario boundaries | [Authoring](../../v2-authoring/SKILL.md) |
| Update, debug, or manage an existing v2 agent without overwriting other work | [Maintenance](../../v2-maintenance/SKILL.md) |
| Write or validate snapshot JSON, steps, tools, and edges | [Snapshot dialect](../../v2-snapshot/SKILL.md) |
| Find an option, default, override, or field interaction | [Option guide](options.md), [field dictionary](../../v2-snapshot/references/knobs.md) |
| Why did the agent choose this node or miss a tool? | [Execution order](execution.md), [runtime](../../v2-runtime/SKILL.md), [debugging](debugging.md) |
| Build a judge, attach a test case, run evaluations | [Evaluations skill](../../evaluations/SKILL.md), [evaluation workflow](../../evaluations/references/workflows.md), [API map](../../evaluations/references/api.md) |
| Simulate a caller or investigate a test result | [Testing](../../v2-testing/SKILL.md) |
| Test actual audio, interruptions, recovery, or response latency | [Voice evidence](../../v2-testing/references/voice.md) |
| Build, edit or simplify the analytics Sankey (waypoint groups, stages, parallel branches) | [Analytics authoring](../../analytics-authoring/SKILL.md) |
| List or count the calls matching a condition (outcome, length, metadata, tools, webhooks); open them on the Conversations page | [Analytics cohorts](../../analytics-cohorts/SKILL.md), [predicate grammar](../../analytics-cohorts/references/grammar.md) |
| Analyze hundreds or thousands of calls with code | [Call analysis skill](../../call-analysis/SKILL.md), [retrieval and pagination](../../call-analysis/references/retrieval.md), [analysis recipe](../../call-analysis/references/analysis.md) |
| Save, publish, promote, rollback, or select a version | [Lifecycle](../../v2-lifecycle/SKILL.md), [lifecycle API](../../v2-lifecycle/references/api.md) |
| Set `{{env.KEY}}` variables and find unresolved ones before a promote; configure and run promotion checks; branch, test, rebase and merge | [Agent environments](../../agent-environments/SKILL.md), [procedures and errors](../../agent-environments/references/environments.md) |
| Migrate v1 content into v2 without changing its meaning | [Migration](../../v2-migration/SKILL.md) |
| Take an agent from built to live: knowledge, tools, voice, staging, promote, number, channels, in order | [Agent launch](../../agent-launch/SKILL.md) |
| Who answers a number; put an agent on a number; per-number settings; block a caller; SIP trunks | [Phone numbers](../../phone-numbers/SKILL.md), [endpoints](../../phone-numbers/references/endpoints.md) |
| Teach the agent from a document, site or file link; test a source; update a source; answer open questions; explain what it looked up on a call; delete a source safely | [Knowledge sources](../../knowledge-sources/SKILL.md), [knowledge API](../../knowledge-sources/references/api.md) |
| Publish a web chat widget; turn on API chat; configure a number's texting; send or take over a text | [Agent channels](../../agent-channels/SKILL.md) |
| Call a person or run a batch with a v2 agent; schedule, watch, stop; DNC and rate-limit pre-flight | [Outbound calls](../../outbound-calls/SKILL.md), [batches](../../outbound-calls/references/batches.md) |
| Set up or diagnose a trigger, alert or post-call webhook; test without dialing | [Automations](../../automations/SKILL.md), [testing order](../../automations/references/testing.md) |
| Create and prove a tool, including custom code; change a shared tool safely; debug a tool run; delete a tool safely; secrets by id; connect or disconnect an integration | [Tool library](../../tool-library/SKILL.md), [procedures](../../tool-library/references/workflows.md), [tool contract](../../v2-runtime/references/tool-library.md) |
| Set up post-call outputs on every call (outcome categories, fields, verdicts); test and publish them; calibrate; backfill past calls; diagnose blank or missing results; migrate v1 citations and outcomes | [Dispositions](../../dispositions/SKILL.md), [API](../../dispositions/references/api.md) |
| Who is on a call now; end or transfer a live call; everything about a caller; merge contacts | [Live calls and contacts](../../call-analysis/references/live-calls-and-contacts.md) |
| Set up branded caller ID, the contact card or an RCS sender | [Identity](../../agent-channels/references/identity.md) |
| Pathways page: reuse or copy a pathway across agents, pathway versions, folders | [Pathway library](../../v2-lifecycle/references/pathway-library.md) |
| File an issue from a bad call; work, link, close issues | [Triage issues](../../triage-issues/SKILL.md), [triage API](../../triage-issues/references/api.md) |
| Run a staged or A/B rollout and decide; read experiment results | [Rollouts](../../v2-lifecycle/references/rollouts.md) |
| Choose, set or debug an agent's voice and language | [Voices](../../v2-lifecycle/references/voices.md) |
| Read text, chat and voice threads for one agent; export | [Conversations](../../call-analysis/references/conversations.md) |
| How is the agent doing; add or edit a headline metric tile | [Measurement](../../analytics-cohorts/references/measurement.md), [metric tiles](../../analytics-cohorts/references/metrics.md) |
| What the dashboard sends Norm, which writes refresh the page, OAuth versus API-key reach | [Workspace and page state](workspace.md), [connection modes](api.md#connection-modes) |

## How each feature works

Open the matching page when the question is "how does X work" or "why did X
happen". Each explains the objects, their states, how the feature reaches a
live call or conversation, what the dashboard shows, the limits, and a cause
map.

| Feature | How it works |
|---|---|
| A v2 call from connect to hang-up: version, opening, per-turn routing, globals, interruptions, setting scopes, canvas versus runtime | [Runtime](../../v2-runtime/references/how-it-works.md) |
| Which version answers and why a change did not take: environments, pins, variables, checks, branches, rollouts | [Environments](../../agent-environments/references/how-it-works.md) |
| How voice and language are chosen for each call | [Voices](../../v2-lifecycle/references/voices.md#how-voice-and-language-work) |
| From a ring to the agent picking up: number ownership, caller screening, caller ID, SIP | [Phone numbers](../../phone-numbers/references/how-it-works.md) |
| From an uploaded source to the answer a caller hears; open questions; the Knowledge map; agent memory | [Knowledge](../../knowledge-sources/references/how-it-works.md) |
| How a tool call runs mid-conversation, what the caller hears, why it failed | [Tools](../../tool-library/references/how-it-works.md) |
| Which version answers texts, web chat and API chat; session lifetime; why a channel is silent | [Channels](../../agent-channels/references/how-it-works.md) |
| Why a call or batch behaved as it did: version, voicemail, statuses, batch states | [Outbound calls](../../outbound-calls/references/how-it-works.md) |
| Why an automation, alert or post-call webhook fired, failed or did not fire | [Automations](../../automations/references/how-it-works.md) |
| Post-call outputs: which calls are scored, which version, when results arrive, where they go | [Dispositions](../../dispositions/references/how-it-works.md) |
| Judges, eval runs, verdicts, scores, PARTIAL, verdict tags | [Evaluations](../../evaluations/references/how-it-works.md) |
| What a simulation, test chat, browser voice test or phone test actually runs | [Agent testing](../../v2-testing/references/how-it-works.md) |
| How a call becomes a Sankey path; why today's calls are not on the chart | [Analytics Sankey](../../analytics-authoring/references/how-it-works.md) |
| Why a call is missing from analytics; how fresh tiles, cohorts and metrics are | [Cohorts and metrics](../../analytics-cohorts/references/how-it-works.md) |
| What evidence a call leaves and when each piece appears | [Call evidence](../../call-analysis/references/how-it-works.md) |
| What Active calls shows and what a contact is | [Active calls](../../call-analysis/references/how-it-works.md#active-calls), [contacts](../../call-analysis/references/how-it-works.md#contacts) |
| Branded caller ID, contact card and RCS states; why texts show no logo | [Identity](../../agent-channels/references/how-it-works.md#identity) |
| What a pathway in the library is and why copies do not update | [Pathway library](../../v2-lifecycle/references/pathway-library.md) |
| What the Overview pages show and why they differ from Analytics | [Overview pages](../../analytics-cohorts/references/how-it-works.md#overview-pages) |
| How an issue moves from filed to closed | [Issues](../../triage-issues/references/how-it-works.md) |

## What this package is—and is not

- Customer-facing product semantics, task procedures, and API navigation.
- No private platform source, runtime credentials, or production data is needed
  to use these references.
- Not a complete offline copy of every API schema. For an option or endpoint
  not documented here, retrieve the official contract through the docs tools.
- Not an authorization system. The connected API and host enforce access.
- Not an automatic file synchronizer. See the workspace reference before saving.
- Not proof that a capability is enabled for this account. A documented feature
  can still be unavailable; surface that limitation rather than inventing it.
