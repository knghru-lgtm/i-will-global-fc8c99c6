# Editing this Bland agent

bland.json is the source: format 3, the native agent snapshot, evaluations,
cases and suites. Read or edit it directly with ordinary JSON tools or scripts.

Start with [.agents/skills/bland-workspace/SKILL.md](.agents/skills/bland-workspace/SKILL.md).
It selects the bundled Norm skills and explains how to reuse an installed plugin.

- Keep stable IDs and ordered routing arrays. Edge endpoints must exist in the
  same flow. Preserve fields outside your edit and avoid reordering routes.
- Use ordinary JSON tools to inspect just the scenario or fields you need.
- Prompt and code strings are data. Import and validation never execute them.
  Custom-code edits are prepared as immutable snippets before import or merge
  validation succeeds. Validation does not invoke them.
- Run node scripts/validate.cjs after edits. It is offline and free. It
  checks package structure and graph references; the server also checks native
  configuration, resource access and entitlements. Behavior checks are separate.
- Propose production changes through a pull request. Bland validates the exact
  merge result. When the GitHub plan supports rulesets, Bland configures a
  required check before merging into main. Otherwise checks are advisory:
  GitHub can accept invalid source, but Bland rejects invalid imports and
  releases. Repair the source and retry; live traffic keeps its last release.
  Work within this repository; fork pull requests cannot prepare account resources.
  If validation is unavailable, retry the check after restoring Bland access.
- Git pushes synchronize source. They do not deploy or run paid evaluations.
  main is production source; staging is staging source; dev/main maps to the
  default development draft. dev/<branch-name> maps to a named development draft.
  Production traffic stays on its selected saved version until an explicit
  successful release. Feature branches have independent native drafts.
- Refresh before saving through the API and send its expected version/revision.
  Resolve stale edits explicitly; never overwrite somebody else's newer draft.
- Voice, KB, tool and snippet IDs refer to the Bland account. Exporting does not
  copy resources, credentials, contact memory or call history.
- Keep tokens and real customer fixtures out of Git. Local runtime state and
  credentials stay outside versioned source.
- Old bland.yaml repositories need bland-agent-project migrate. Review and
  commit the migration; do not keep both JSON and YAML sources.

## Verify the organization before API work

This repository belongs to this target (identifiers, never credentials):

```json
{
  "org_id": "d23b8d6c-4e70-42f2-911c-1273c39cee78",
  "agent_id": "fc8c99c6-88c3-435d-952b-8c93c2db17a6",
  "repository_id": "1436082197"
}
```

Before any other account reads, writes, simulations or releases, use the same
Bland connection that will perform the work for this read-only preflight:

1. GET /v2/agents/fc8c99c6-88c3-435d-952b-8c93c2db17a6. Unwrap the tool result to the API JSON
   response body. Require a successful response with body.data.id exactly equal
   to "fc8c99c6-88c3-435d-952b-8c93c2db17a6" and body.data.org_id exactly equal to
   "d23b8d6c-4e70-42f2-911c-1273c39cee78". This endpoint scopes the agent lookup to
   the authenticated caller's organization; a wrong organization cannot read it.
2. Compare IDs, never organization names, browser account labels or a list of
   organizations the user can access. A successful login alone is not a match.
3. If either field is absent or different, the read fails, or authentication is
   unavailable, stop API work and ask the user to select the correct Bland
   connection. Do not search another organization, switch connections silently,
   edit this repository's target IDs to make them match, or create a replacement
   agent. Local editing and offline validation can continue.
4. Repeat before each new API work session and whenever the connection, account
   or authentication changes. Use that verified connection for subsequent calls.
   Do not use GET /v1/me for this check; OAuth-connected apps cannot access it.

This preflight verifies organization and agent identity, not permission to publish
or spend credits. Honor the user's authorized scope and the Git workflow below.

## Testing this checkout through Bland MCP

MCP is optional for local editing and validation. Runtime simulations need the
user's authenticated Bland connection for this organization. Discover the host's
Bland tools; do not install MCP configuration, copy credentials into Git, switch
organizations, or substitute another connection automatically. If unavailable,
report that runtime testing was not run and ask the user to connect Bland.

Use this repository workflow when testing Git edits, including with Norm:

1. Read the actual branch with `git branch --show-current`. Never infer it from
   the agent name or default to main/dev/main. Detached HEAD needs an explicit
   tracked branch from the user. Read the working tree's bland.json, including
   uncommitted changes; never replace it with a server export just to pass checks.
2. Through Bland MCP, GET /v2/agents/fc8c99c6-88c3-435d-952b-8c93c2db17a6/package?branch=<URL-encoded Git branch>.
   Keep its revision. A missing agent, inaccessible organization or untracked
   branch is a blocker; do not fall back to another agent, branch or latest version.
3. When the user requests runtime testing, POST
   /v2/agents/fc8c99c6-88c3-435d-952b-8c93c2db17a6/repository/checks?branch=<URL-encoded Git branch>
   using call_bland_api (or the host's equivalent). Send this JSON body:

```json
{
  "environment": "staging",
  "idempotency_key": "<new UUID; reuse only for retries of this exact request>",
  "target": {
    "org_id": "d23b8d6c-4e70-42f2-911c-1273c39cee78",
    "agent_id": "fc8c99c6-88c3-435d-952b-8c93c2db17a6",
    "repository_id": "1436082197",
    "branch": "<actual Git branch>",
    "revision": "<revision from step 2>",
    "files": {
      "bland.json": "<complete local file as a UTF-8 string>"
    }
  }
}
```

The server verifies the connected organization, agent, repository, branch,
revision and local source before starting a run. Prepared snippet pointers may
differ; the executable code must match. TEST_SOURCE_NOT_SYNCED means push/sync
the intended branch and wait for import, then read its new revision and retry.
TEST_TARGET_MISMATCH means verify the connection and target. STALE_PACKAGE means
someone changed the saved source; reconcile first. Never remove target to bypass
these checks, overwrite newer source, or publish to make a test run.

The environment selects the evaluation suite/policy, NOT the deployed agent:
staging is the default test policy; the source is the explicit Git branch above.
Checks require configured cases/judges and may spend credits or invoke real
integrations. Use safe fixtures and the plugin's testing guidance. No configured
checks means no behavioral coverage, not a pass. OAuth connections need evals:run.

Poll GET /v2/agents/fc8c99c6-88c3-435d-952b-8c93c2db17a6/check-runs/<returned id> until terminal.
Report its id, agent_version_id, tested branch and outcomes. The run pins the
captured version; later edits are not covered. GitHub validation alone proves
source validity and snippet preparation, not conversational behavior.
