---
name: v2-lifecycle
description: Use when shipping a Bland v2 agent version to real traffic or asking which version answers ("publish to staging", "promote to production", "roll back", "which version is this call running", "my fix didn't take"), running an A/B test or staged rollout on the Experiments page ("start an experiment", "ramp the new version", "finish the rollout", "pick the winner"), attaching inbound numbers, deleting an agent, setting an agent's voice and language ("change my agent's voice", "make it speak Spanish"), or on the Pathways page ("copy this pathway to another agent", "update the pathway in all my agents", "pathway versions").
---

# v2 Agent Lifecycle

> **Server binding:** use only this plugin's MCP server (`plugin_norm_bland`), never the v1 plugin's or a project `bland` server; they may hold another org.

Which version runs where, and how it reaches callers. The
[lifecycle model](references/lifecycle.md) is the full model; read the
[endpoint dictionary](references/api.md) before the first request; objects
outside the snapshot are in [resource boundaries](references/resources.md).
Do not write fetch scripts or search the docs for these routes.

## Page context

Call `get_dashboard_page_context` (`mode: "synced"`) first.

- `/dashboard/scenarios` (sidebar Pathways), `/dashboard/agent/$agentId/scenarios`
  and `…/scenarios/$scenarioId/$versionId`: pathways, their versions and
  folders. Read the [pathway library](references/pathway-library.md).
- `/dashboard/pathways/$pathwayId`: a legacy pathway, read-only; hand to
  [v2-migration](../v2-migration/SKILL.md).

## Environments and the ship pipeline

`dev` is the newest save. `staging` and `production` pin one version. No
production pin: outbound calls fail (`AGENT_ENV_UNPINNED`); inbound runs the twin.

```text
save version ──► dev        (automatic)
publish ───────► staging    (mints a semver)
promote ───────► production (empty body = staging's pin, or an exact version_id)
rollback ──────► production (only a version production ran before)
```

Promotion enforces the staging check policy (`409 CHECKS_BLOCKED`); never
add `force: true` to pass it. Promote errors: [API map](references/api.md#lifecycle).
Variables, checks and branches (the Environments page):
[agent-environments](../agent-environments/SKILL.md).

## Which version answers

Why: [how environments work](../agent-environments/references/how-it-works.md).

| Channel | Runs | Override |
|---|---|---|
| Outbound `POST /v1/calls` with `agent_id` | production pin | `agent_version` selector |
| Inbound voice | production pin, or an experiment arm | none |
| Builder test-chat socket | dev head | `version_id` query parameter |
| Web widget, API chat, SMS | the twin, compiled from production | none |

Selectors: `production`, `staging`, `dev`/`latest`, `X.Y.Z`, `branch:<name>`.
The selector, not the version, picks whose variables resolve. A production
number attach puts the latest save on the twin until the next promote.

## Rollouts (the Experiments page)

Read [rollouts](references/rollouts.md) first. Enterprise only
(`403 ENTERPRISE_REQUIRED`).

- **One live rollout per agent**; creating another returns `409 CONFLICT`.
- `kind: "version"`: production to another version. `kind: "migration"`: a v1
  pathway to this agent.
- Presets `standard`, `cautious`, `fast`, `custom` ramp to 100% and finish
  themselves; `ab` holds one share until a person ends it.
- **Every action except reads moves live traffic.** `advance` approves a
  checkpoint; `rollback` returns all calls to the baseline. **`finish` on a
  version rollout promotes the candidate**: get explicit approval.
- For A/B, prefer preset `ab` over the low-level `POST …/experiments`.
- A live migration rollout blocks promote (`409 ROLLOUT_IN_PROGRESS`).
- After a write: "Saved through the API. The page shows it after a refresh."

## Other lifecycle work

- **Voice and language**, how a call picks them and how to change them:
  [voices](references/voices.md#how-voice-and-language-work).
- **Inbound numbers**: attaching clears a v1 pathway on that number. Send
  `only_if_unassigned: true` unless asked to move one
  ([attach](references/api.md#inbound-numbers-and-identity));
  [phone-numbers](../phone-numbers/SKILL.md) owns the workflow.
- **Delete agent** unbinds every number (`GET /v2/agents/:agentId/inbound`).
- **Reuse a pathway**: a copy is independent of its source
  ([pathway library](references/pathway-library.md)); imports:
  [workflows](references/resources.md#reuse-and-import-workflows).

## Confirm before

Promote, rollback, rollout or experiment writes, attach, detach, agent
delete, pathway copies and folder deletes, branded caller ID, RCS sender
steps, contact-card sends, memory writes:

```text
About to <verb> <object>: <what changes, who is affected, cost or count>.
This <moves live traffic | reaches the carrier | texts +1… | cannot be undone>.
Reply "yes" to proceed.
```
