---
name: v2-maintenance
description: Use when updating, repairing, debugging, or managing an existing Bland v2 agent, including prompt edits, routing, tools, settings, versions, environment configuration, and regression testing.
---

# Maintain an existing v2 agent

Use the existing agent as the baseline, not a new-agent template. Work through
this plugin's authenticated Bland MCP/API connection; prove the target org and
agent before writing. Never silently substitute another installed connection.
The host enforces permissions; this skill does not grant them.

## Choose the right references

| Work | Read |
|---|---|
| Discover endpoints, use code and workspace files | [API workspace](../api-workspace/SKILL.md) |
| Edit prompts, steps, tools, variables, edges, settings | [Snapshot dialect](../v2-snapshot/SKILL.md) |
| Diagnose routing, repetition, interrupts, hidden canvas routes | [Runtime](../v2-runtime/SKILL.md) and [debugging procedure](../api-workspace/references/debugging.md) |
| Reproduce safely with text, simulation, or actual speech | [Testing](../v2-testing/SKILL.md) |
| Judges, test cases, calibration, run results | [Evaluations](../evaluations/SKILL.md) |
| Find patterns across historical calls | [Call analysis](../call-analysis/SKILL.md) |
| Versions, branches, variables, publish, promote, rollback, numbers, experiments, memory | [Lifecycle](../v2-lifecycle/SKILL.md) and [API map](../v2-lifecycle/references/api.md) |

## Edit without losing someone else's work

1. Identify the requested agent, branch/environment, exact failing version and
   intended outcome. Read fresh saved state and available page/draft revision.
   API state cannot reveal another editor's unsaved work. Follow the
   [workspace state contract](../api-workspace/references/workspace.md).
2. Keep the base JSON and its version/revision in workspace files. Fetch a full
   snapshot, not a metadata listing. `/versions/:semver` does not accept a row
   UUID; use the documented full-snapshot endpoint for the intended target.
3. Make the smallest stable-ID patch. Preserve unrelated prompts, fields,
   integrations and layout. Do not rebuild the agent or insert routes just
   because the canvas hides generated behavior. A local edit alone is not a save.
4. Parse and validate against the current supported schema; inspect the diff
   and referenced destinations, tools, snippet pins and variables. Migration
   audit conventions are not universal validity requirements: do not reshape an
   existing agent merely to satisfy a migration-only check.
5. Apply to the requested draft or save through the supported API, retaining
   its concurrency fence. Never overwrite an unsaved draft to force a refresh.
   On `STALE_HEAD`, fetch again and reconcile base/patch/new head; ask only for
   real conflicts. After an ambiguous write timeout, read back/history before
   retrying—do not duplicate mutations or remove the fence.
6. Read back accepted content and revision. Test that exact candidate and the
   affected neighboring routes. Keep a named candidate when a stable version
   is needed. Saving trunk advances dev; it does not publish to production.
   Host-provided UI effects reflect accepted edits; browser clicks are not the
   primary authoring mechanism.

## Diagnose and manage with evidence

- Reproduce before changing behavior. Separate input/audio, node routing,
  tool execution, and evaluation verdict; a repeated node is not a diagnosis.
- Test the reported failure, a normal path, and an adjacent regression case.
  Simulations can execute real integrations: classify side effects first.
- For deployment, verify the exact candidate and environment values, required
  checks, and requested authorization. Select the exact promotion candidate;
  an empty-body promote uses the current staging pin. Follow the current
  lifecycle policy and coordinate concurrent changes. Never infer publication from
  “fix this prompt,” nor live-audio correctness from a text test.
- Report changed fields, accepted version, evidence and remaining gaps. Do not
  claim a save, UI refresh, audio cutoff, or production change you did not verify.
