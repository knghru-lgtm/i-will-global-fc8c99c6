# Environments: procedures, fields and errors

Detail for the [agent-environments skill](../SKILL.md). The model behind it
(pins, selectors, the twin, what promotion enforces) is in
[how environments work](how-it-works.md) and the
[lifecycle reference](../../v2-lifecycle/references/lifecycle.md); the REST
routes are in the [endpoint dictionary](../../v2-lifecycle/references/api.md#environment-variables).
This page adds the procedures and the exact text each tool returns.

## Contents

- [Tools and routes](#tools-and-routes)
- [Variable pre-flight](#variable-pre-flight)
- [Check policy](#check-policy)
- [Branch merge](#branch-merge)
- [Errors](#errors)

## Tools and routes

The dedicated tools and the REST routes reach the same service. Prefer the
tool; use `bland_api_get` or `call_bland_api` on the route when a field is
missing from the tool. Tool inputs are camelCase; route bodies are
snake_case.

| Tool | Route | Note |
|---|---|---|
| `list_agent_variables` `{agentId, env}` | `GET /v2/agents/:agentId/environments/:env/variables` | `env` is `dev`, `staging` or `production`. |
| `set_agent_variable` `{agentId, env, key, value, isSecret?}` | `PUT …/variables/:key` `{value, is_secret?}` | Upsert. A secret keeps only a `{{SECRET.name}}` reference. |
| `delete_agent_variable` `{agentId, env, key}` | `DELETE …/variables/:key` | |
| `list_agent_environments` `{agentId}` | `GET /v2/agents/:agentId/environments` | Each row: `envType`, `currentVersionId`, `currentVersionSemver`. |
| `get_agent_check_config` `{agentId, env?}` | `GET …/environments/:env/checks` | **The tool defaults `env` to production.** Pass `staging`. |
| `set_agent_check_config` | `PUT …/environments/:env/checks` | Full replace. Same default; pass `staging`. |
| `delete_agent_check_config` | `DELETE …/environments/:env/checks` | Removes the gate. Never to pass a block. |
| `start_agent_check_run` `{agentId, env?, versionId?}` | `POST …/environments/:env/check-runs` `{version_id?}` | Bills simulations. Needs the evaluation-runs scope. |
| `list_agent_check_runs`, `get_agent_check_run`, `cancel_agent_check_run` | `GET /check-runs?env=`, `GET /check-runs/:runId`, `POST …/:runId/cancel` | |
| `promote_agent` `{agentId, versionId?, branchId?, bump?}` | `POST /v2/agents/:agentId/promote` | Never send `force`. |
| `list_agent_branches`, `create_agent_branch`, `delete_agent_branch` | `GET`, `POST /branches`, `DELETE /branches/:branchId` | |
| `rebase_preview_agent_branch`, `rebase_agent_branch`, `merge_agent_branch` | `POST /branches/:branchId/rebase-preview`, `/rebase`, `/merge` | |

## Variable pre-flight

A referenced `{{env.KEY}}` with no value in the resolving environment fails
call preparation with `AGENT_VARIABLE_UNRESOLVED` and the message
`Agent variables are unresolved — no "<env>" value for: <KEYS>`. Find it
before a caller does.

1. **Pick the candidate and the environment that will resolve it.**

   | About to | Candidate snapshot | Environment |
   |---|---|---|
   | Promote, empty body | staging's pin | production |
   | Promote an exact version | that version | production |
   | Publish to staging | the dev head or the named version | staging |
   | Staging check run | the run's candidate | staging |
   | Test by `branch:`, semver, `dev` | that version | dev |
   | Attach a number with `environment: "staging"` | staging's pin | staging |

   **Read the candidate itself, never a stand-in.** A pin or any published
   version: `get_agent_version` `{agentId, semver}` (staging's semver from
   `list_agent_environments`). The dev head: `get_latest_agent_version`. A
   branch head: `get_latest_agent_version` `{agentId, branchId}`. Check that
   the returned `id` equals the candidate's version id. A version that is
   neither published nor a head cannot be read in full: say the pre-flight
   could not run for it, and do not report "all set".

2. **Collect references.** Search the whole snapshot serialized as JSON, not
   only prompts: tool bodies, settings and contact fields count. A reference
   is `{{env.NAME}}` with optional spaces inside the braces, where `NAME`
   starts with a letter or underscore.
3. **Compare.** `list_agent_variables` for that environment. The match is
   case-insensitive (`{{env.Api_Host}}` resolves against `API_HOST`). A
   reference with a dot or a dash in its name never resolves, because keys
   cannot contain them; report it as a snapshot defect, not a missing value.
4. **Report** each referenced key as set or missing, per environment. Offer
   to set the missing ones (confirm for staging and production), then
   promote.

Where a missing key shows up:

| Path | Effect |
|---|---|
| Outbound call, test chat, simulation, check run | Fails at preparation with the message above. |
| Inbound voice on production | Fails open: the call runs the twin's last stored graph, unattributed ([fail-open](../../v2-lifecycle/references/lifecycle.md#inbound-binding-the-twin-and-fail-open)). |
| Staging attach | `409 AGENT_VARIABLE_UNRESOLVED`. |
| SMS, widget, API chat after a production attach | The twin holds the dev head with `{{env.KEY}}` left unfilled until the next promote. |

A production variable write reaches the next production call with no
promote. Treat it as a live change.

## Check policy

Promotion to production reads the **staging** config and the latest
**staging** run for the exact candidate. The dashboard's Evaluations card
reads the same pair.

`set_agent_check_config` input:

```json
{
  "agentId": "<agent id>",
  "env": "staging",
  "enabled": true,
  "scenarioIds": ["<scenario id>"],
  "simulationsCount": 5,
  "evals": [
    {
      "evalAgentId": "<judge id>",
      "evalAgentVersionId": "<judge version id>",
      "targetLevelKeys": ["<passing level key>"],
      "required": true
    }
  ]
}
```

- `scenarioIds`: 1 to 5 of this agent's test scenarios; a scenario that
  targets a pathway is refused. List them with
  `GET /v1/agent-testing/scenarios?agent_id=<agent id>`.
- `simulationsCount`: per scenario, default 5. At most 50, and at most the
  org's per-scenario simulation limit; above it the save is refused with
  "Conversations per scenario must be at most N". Cost is scenarios times
  this count; say the number in the confirm.
- `evals`: at least one, each judge once. Use a runnable judge version
  ([evaluations](../../evaluations/SKILL.md)). A graded judge needs at least
  one `targetLevelKeys` entry; a pass/fail judge must omit them. `required`
  defaults to true; a required judge blocks promotion when it fails.
- No required judge means no gate. That is legal and proves nothing.

A run counts for the gate only when its frozen config still matches the saved
one: same scenarios, same simulation count, and for every required judge the
same judge version and target levels. Editing the config therefore voids
every earlier run.

Verdicts on `get_agent_check_run`: `status`, `overallPassed`, and per judge
`{name, required, targetLevelKeys, matchRate, score, passed}`. A judge passes
at a match rate of at least 0.5. `simulationSetId` links the generated
conversations for the [v2-testing](../../v2-testing/SKILL.md) grading pass.
Report the failing required judges by name; do not summarize a FAILED run as
"mostly passed".

Default candidates when `versionId` is omitted: a staging run scores the dev
head; a production run scores staging's pin. For an empty-body promote, run
staging checks with `versionId` set to staging's `currentVersionId`, or the
run scores a different version and the gate stays shut.

## Branch merge

1. `list_agent_branches`. `behind: true` means a merge will be refused.
2. `rebase_preview_agent_branch` `{agentId, branchId}`. Read-only. Returns
   `devHeadVersionId`, `upToDate`, `autoMerged`, `changes[]` (dev-side
   edits that merge cleanly) and `conflicts[]`, each with `id`, `label`,
   `path_labels`, `base`, `theirs` (dev) and `ours` (branch).
3. Show every conflict by label with both values. Ask per conflict:
   `"ours"` keeps the branch, `"theirs"` takes dev, `{"value": …}` supplies a
   hand-merged value. Routing arrays (`conditions`, `responsePathways`) and
   `position` conflict as a whole; never splice them.
4. Confirm, then `rebase_agent_branch` `{agentId, branchId, devHeadVersionId,
   resolutions}` with `devHeadVersionId` from the preview. It saves a new
   branch version and moves the branch base.
5. Re-test with `branch:<name>`; the rebase changed what the branch runs.
6. Confirm, then `merge_agent_branch`. It squashes the branch head into one
   new dev version and closes the branch.

## Errors

The tools return a message; the REST routes return a status and code.

| Tool message | REST | Meaning and next step |
|---|---|---|
| "Run required evaluations successfully before promoting" | `409 CHECKS_BLOCKED` "Run evaluations before promoting" or "A required evaluation failed. Promotion is blocked" | No current run for this exact candidate, or a required judge failed. Read the latest staging run for the candidate to tell which. Fix and rerun; never `force`. |
| "Evaluations are still running" | `409 CHECKS_BLOCKED` same text | Poll the run, then promote. |
| "A check run is already in progress (<run id>)" | `409 CONFLICT` | Poll that run, or cancel it with a confirm. A wedged run ends after 45 minutes. |
| "No checks are configured for this environment", "Checks are disabled for this environment" | `400` | Configure or enable before starting a run. |
| "Staging has no version pinned — publish before running production checks" | `400` | Publish first ([v2-lifecycle](../../v2-lifecycle/SKILL.md)). |
| "Publish to staging before promoting to production" | `400 STAGING_UNPINNED` | Publish, or promote an exact `versionId`. |
| "A rollout is ramping traffic onto this agent's production version …" | `409 ROLLOUT_IN_PROGRESS` | Finish or roll back the rollout ([rollouts](../../v2-lifecycle/references/rollouts.md)). |
| "Development moved past this branch — rebase before merging" | `409 BRANCH_BEHIND` | Preview, resolve, rebase, then merge. |
| "Development changed since the preview — preview again" | `409 REBASE_STALE` | Run the preview again. |
| "Every conflict needs a resolution — unresolved: <ids>" | `400 UNRESOLVED_CONFLICTS` | Ask about the named conflicts. |
| "The merged config is invalid: …" | `400 INVALID_MERGE` | Choose different resolutions or fix on the branch. |
| "The branch has no saved changes to merge" | `400 NO_CHANGES` | Nothing to merge. |
| "An open branch with this name already exists" | `409 BRANCH_EXISTS` | Pick another name or use the open branch. |
| "key may only contain letters, numbers, and underscores" | `400 INVALID_KEY` | Rename the key and its references. |
