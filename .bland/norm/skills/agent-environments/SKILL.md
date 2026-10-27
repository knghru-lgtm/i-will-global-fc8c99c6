---
name: agent-environments
description: Use when working on an agent's Environments or Variables page ("set an env variable", "add {{env.KEY}} for production", "AGENT_VARIABLE_UNRESOLVED", "set up checks before promote", "why is promote blocked", "test my branch", "merge the branch", "the branch is behind"), covering the unresolved-variable pre-flight, the staging check policy and verdicts, and branch, rebase and merge.
---

# Agent environments

Variables per environment, the staging check policy that gates promotion,
and branches. To explain which version answers and why, read
[how environments work](references/how-it-works.md); the
[lifecycle reference](../v2-lifecycle/references/lifecycle.md#environment-variables)
holds the model. Procedures, fields and error text:
[environments reference](references/environments.md). Do not write fetch
scripts or search the docs for these routes.

## Page context

Call `get_dashboard_page_context` (`mode: "synced"`) first. Take the agent id
from `route.params`. No target chip exists here.

- `/dashboard/agent/$agentId/environments`: redirects to `overview`.
- `…/environments/overview`: Development with branches, Staging,
  Evaluations (the staging check policy and latest run), Production.
- `…/environments/variables`: the environment tab is page state, not in the
  URL. Read the selected tab from the visible text, or ask.
- `…/environments/rollout`, `…/rollout/settings`: old addresses that redirect
  to Experiments; hand to [rollouts](../v2-lifecycle/references/rollouts.md).

No write here refreshes the page. After each one say: "Saved through the
API. The page shows it after a refresh."

## Workflow: set variables and pre-flight

Budget: one list per environment, one snapshot read, one write per key.

1. `list_agent_variables` `{agentId, env}`. Secrets read back as
   `{{SECRET.name}}` references, never values.
2. `set_agent_variable` `{agentId, env, key, value, isSecret?}`. Keys are
   letters, digits and underscores. A secret: the user types it on the
   Variables page ("Store as secret"), not into chat.
3. Pre-flight before a publish, check run or promote: read the candidate
   itself (by semver unless it is a head), collect every `{{env.KEY}}`,
   compare with the target environment's keys
   ([pre-flight](references/environments.md#variable-pre-flight)).
   Report "N referenced, all set" or each missing key.
4. `delete_agent_variable` only when the pre-flight shows no version that
   environment runs references the key.

## Workflow: checks, verdicts, then promote

Budget: one config read, at most one config write, one run, polls, one
promote.

1. `get_agent_check_config` with `env: "staging"`. Always pass `env`: the
   tool defaults to production, but promotion reads the staging policy.
2. To change it: `set_agent_check_config`, `env: "staging"`, the whole config
   ([fields](references/environments.md#check-policy)). A full replace; it
   voids earlier runs for the gate.
3. Pre-flight staging variables, then `start_agent_check_run`
   `{agentId, env: "staging", versionId}`. For a plain promote pass staging's
   `currentVersionId` from `list_agent_environments`; omitted, it scores the
   dev head.
4. Poll `get_agent_check_run` about every 30 seconds until terminal. Report
   each judge's `required`, `matchRate`, `passed`.
5. Pre-flight production variables, then `promote_agent`. On a block, name
   the [reason](references/environments.md#errors) and the failing judge;
   fix the agent and rerun. Never `force`.

## Workflow: branch, test, merge

Budget: one list, one create, the saves, test turns, one merge.

1. `list_agent_branches`, then `create_agent_branch` `{agentId, name}`.
2. Save edits with `save_agent_version` and `branchId`
   ([v2-maintenance](../v2-maintenance/SKILL.md)).
3. Test with selector `branch:<name>` ([v2-testing](../v2-testing/SKILL.md));
   it resolves dev variables.
4. `merge_agent_branch`. When dev moved (`409 BRANCH_BEHIND`):
   `rebase_preview_agent_branch`, a choice per conflict, `rebase_agent_branch`,
   re-test, merge ([steps](references/environments.md#branch-merge)).
5. A merge is one new dev version, not live until published and promoted.

## Confirm before

Staging or production variable writes and deletes (live on the next call),
check config writes, starting a run (it bills simulations), cancelling a run,
promote, rebase, merge, branch delete:

```text
About to <verb> <object>: <what changes, who is affected, cost or count>.
This <changes live calls now | bills N simulations | cannot be undone>.
Reply "yes" to proceed.
```

## Refusals and limits

- Never add `force`, disable checks, drop a required judge or delete the
  config to pass a block. A request to ship does not authorize skipping it.
- A green staging run proves staging variables, not production's.
- One active run per agent and environment.
- `insufficient_scope` on a run start: reconnect with evaluation runs
  allowed, or start it from the Evaluations card.
