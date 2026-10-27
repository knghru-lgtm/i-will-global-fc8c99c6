# Bland agent workspace

Edit bland.json, then run `node scripts/validate.cjs` (Node.js 22 or newer).
No package install or Bland login is needed for local validation.

Norm 1.11.0 and its skills are included under .bland/norm.
Codex and Cursor discover the bland-workspace skill; Claude reads the workspace
guide through CLAUDE.md. Follow AGENTS.md for the target and test workflow.
An existing Norm installation and MCP connection can be reused. This repo does
not install a second plugin, activate hooks, or configure another MCP server.
To run simulations, connect Bland in your editor with access to this organization.

GitHub validates proposed changes through the Bland App. Local validation is fast
feedback, not a replacement for that check. Git pushes do not publish the agent.
Tool versions are pinned in .bland/norm/source.lock.json and
.bland/validator/source.lock.json; existing repos are not silently upgraded.
