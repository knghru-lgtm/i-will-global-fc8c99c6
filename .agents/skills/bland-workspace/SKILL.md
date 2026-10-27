---
name: bland-workspace
description: Use when editing, validating, testing or releasing the Bland agent in this Git repository.
---

# Bland agent workspace

Read the repository's AGENTS.md for its identity and Git workflow. It governs
source edits and testing in this checkout. Keep bland.json as the source of truth.

Norm 1.11.0 is bundled at .bland/norm, pinned to
f98a4f79953928ae9ff4b83df2eaa3a96d26706f. Paths below are relative to the repository root.
Load only the skill needed for the current task and follow its relative references:

- [.bland/norm/skills/agent-channels/SKILL.md](../../../.bland/norm/skills/agent-channels/SKILL.md)
- [.bland/norm/skills/agent-environments/SKILL.md](../../../.bland/norm/skills/agent-environments/SKILL.md)
- [.bland/norm/skills/agent-launch/SKILL.md](../../../.bland/norm/skills/agent-launch/SKILL.md)
- [.bland/norm/skills/analytics-authoring/SKILL.md](../../../.bland/norm/skills/analytics-authoring/SKILL.md)
- [.bland/norm/skills/analytics-cohorts/SKILL.md](../../../.bland/norm/skills/analytics-cohorts/SKILL.md)
- [.bland/norm/skills/api-workspace/SKILL.md](../../../.bland/norm/skills/api-workspace/SKILL.md)
- [.bland/norm/skills/automations/SKILL.md](../../../.bland/norm/skills/automations/SKILL.md)
- [.bland/norm/skills/call-analysis/SKILL.md](../../../.bland/norm/skills/call-analysis/SKILL.md)
- [.bland/norm/skills/dispositions/SKILL.md](../../../.bland/norm/skills/dispositions/SKILL.md)
- [.bland/norm/skills/evaluations/SKILL.md](../../../.bland/norm/skills/evaluations/SKILL.md)
- [.bland/norm/skills/knowledge-sources/SKILL.md](../../../.bland/norm/skills/knowledge-sources/SKILL.md)
- [.bland/norm/skills/outbound-calls/SKILL.md](../../../.bland/norm/skills/outbound-calls/SKILL.md)
- [.bland/norm/skills/phone-numbers/SKILL.md](../../../.bland/norm/skills/phone-numbers/SKILL.md)
- [.bland/norm/skills/tool-library/SKILL.md](../../../.bland/norm/skills/tool-library/SKILL.md)
- [.bland/norm/skills/triage-issues/SKILL.md](../../../.bland/norm/skills/triage-issues/SKILL.md)
- [.bland/norm/skills/v2-authoring/SKILL.md](../../../.bland/norm/skills/v2-authoring/SKILL.md)
- [.bland/norm/skills/v2-lifecycle/SKILL.md](../../../.bland/norm/skills/v2-lifecycle/SKILL.md)
- [.bland/norm/skills/v2-maintenance/SKILL.md](../../../.bland/norm/skills/v2-maintenance/SKILL.md)
- [.bland/norm/skills/v2-migration/SKILL.md](../../../.bland/norm/skills/v2-migration/SKILL.md)
- [.bland/norm/skills/v2-runtime/SKILL.md](../../../.bland/norm/skills/v2-runtime/SKILL.md)
- [.bland/norm/skills/v2-snapshot/SKILL.md](../../../.bland/norm/skills/v2-snapshot/SKILL.md)
- [.bland/norm/skills/v2-testing/SKILL.md](../../../.bland/norm/skills/v2-testing/SKILL.md)

If Norm is already installed, leave it installed and reuse its authenticated Bland
connection. Do not install or enable this nested bundle as another plugin, register
its MCP settings, enable its hooks, or change the user's global plugin version.
The bundle supplies pinned product guidance; this workspace entry supplies Git
targeting. Prefer these local references for work in this checkout instead of
loading a second version of the same guidance from an installed plugin.
References to /norm:<command> are guidance in .bland/norm/commands/<command>.md;
read those files instead of installing or invoking a second plugin. Snapshot
instructions describe bland.json's agent field, not the enclosing package.
This checkout's authenticated host connection is the explicit replacement for
bundled references to "this plugin's" MCP server. Before any account API work,
follow AGENTS.md's organization preflight: read the exact agent through that
connection and compare the response's agent and organization IDs with this repo's
identity. Matching display names are insufficient. Missing or mismatched identity
blocks API work, including creating snippets, tools or evaluation resources.
Never change the recorded IDs or silently switch connections to bypass this check.
Local editing and offline validation do not need an authenticated connection.

The bundled API-first instructions apply to account resources and reading results.
For edits to this agent's source, edit bland.json and use the repository workflow
in AGENTS.md. Do not also save the same edit through native version APIs.
For runtime tests, use AGENTS.md's targeted repository/checks request with the
actual Git branch, full local bland.json and saved package revision. Never silently
test latest or a deployed version. Stop on missing MCP/auth or a mismatched target;
do not create another connection or bypass the target guard. Bundled testing
examples using native /run or latest do not apply to tests of this Git checkout.

Run node scripts/validate.cjs for offline structure/graph checks. This does not
execute code, validate account resources or prove conversational behavior.
GitHub's Bland App check and the backend compiler remain authoritative.
