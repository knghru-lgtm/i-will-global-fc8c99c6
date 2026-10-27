# V2 resources outside the snapshot

Saving agent JSON does not save every object visible around the agent. Start
with the [API map](api.md), and retrieve the live contract for bodies not listed
there. Host tools expose capabilities; this wiki does not grant access to them.

## Contents

- [Resource ownership and activation](#resource-ownership-and-activation)
- [Agent-card settings](#agent-card-settings)
- [Knowledge and memory](#knowledge-and-memory)
- [Collaboration and page synchronization](#collaboration-and-page-synchronization)
- [Reuse, history and restoration](#reuse-history-and-restoration)
- [Reuse and import workflows](#reuse-and-import-workflows)
- [Operational surfaces](#operational-surfaces)

## Resource ownership and activation

| Resource | Where it lives / becomes effective |
|---|---|
| Behavior, prompts, node settings, knowledge references, voice and languages | Agent version snapshot; a trunk save advances dev, not production. |
| Saved tool, snippet, knowledge content, voice model | Separate org-owned resource referenced by a snapshot. Changing a shared resource can affect other consumers. |
| Environment values and secret references | Per agent and environment, separate from the snapshot; resolve according to the call or test selector. |
| Environment pins and deployment history | Lifecycle API; saving a draft is not promotion. |
| Branches | Separate working timelines; preserving a branch does not merge or deploy it. |
| Rollouts and experiments | Separate lifecycle objects that move live traffic. See [rollouts](rollouts.md). |
| Identity and number binding | Separate APIs; carrier submissions, messages and routing changes have external effects. |
| Check configurations and runs | Separate candidate and judge-version records; promotion policy is in the [lifecycle model](lifecycle.md#checks-and-promotion-policy). |
| Judges, scenarios, cohorts, evaluation runs | Separate objects; see [evaluations](../../evaluations/SKILL.md). |
| Dispositions and extractor versions | Separate draft, publish and run lifecycle; not agent snapshot fields. See [dispositions](../../evaluations/references/dispositions.md). |
| Calls, conversations, recordings, transcripts, memory records | Runtime evidence and data, not configuration and not a copy of the latest editor. |
| Alerts, automations and integrations | Separate configured resources. Inspect their own contract and agent scope before changing them. |

## Agent-card settings

The agent card's Settings tab writes snapshot `settings`, so every change is a
version save that reaches calls only through the pipeline.

- **Voice and languages**: follow [voices](voices.md). Only `languages[0]`
  reaches calls.
- **Memory**: `settings.enableMemory` and `settings.memorySchema`; see
  [knowledge and memory](#knowledge-and-memory) for the stored records.
- **Name**: the builder saves `settings.displayName` and then renames the agent
  with `PATCH /v2/agents/:agentId {name}`. Do both when renaming by API.
- **Delete agent** is not a setting: it unbinds every inbound number and stops
  live traffic. See the [API map](api.md#agents).
- Field-by-field semantics are in the
  [field guide](../../v2-snapshot/references/knobs.md).

## Knowledge and memory

- `knowledge.kbIds` attaches agent-wide retrieval; a `knowledge` step scopes
  retrieval differently. Avoid promoting node-only knowledge to call-wide simply
  because it is easier to find. An attached id does not prove ingestion
  finished, the source is current, or the requested answer was retrieved.
- Source ingestion, testing retrieval and open questions belong to the
  `knowledge-sources` skill. Test with an answerable question and one
  deliberately absent answer. Report evidence gaps rather than invent answers.
- Memory (`settings.enableMemory`, `settings.memorySchema`): what it is,
  when it is read and written, and how to diagnose it are in
  [agent memory](../../knowledge-sources/references/how-it-works.md#agent-memory).
  A schema change reaches callers only through a saved and promoted version.
- **Read what was stored** through the [memory routes](api.md#memory-records):
  `GET /v1/memory/changes?call_id=` for one call, or `GET /v1/memory/stores`
  then `GET /v1/memory/<store id>?search=` for a contact. A schema alone is not
  evidence that a fact was stored.
- **Correcting or deleting memory is a data mutation**, not a prompt edit.
  `PATCH …/contact/:id/summary` or `/facts` overwrites what the agent recalls.
  `POST /v1/memory/reset` hard-deletes a contact's memory. Confirm both.
  `POST /v1/memory/enable` is v1-only; never use it on a v2 agent.

## Collaboration and page synchronization

The builder can hold unsaved changes, a saved head and revision, an environment
view and a branch independently. Collaborative presence is not ownership of
every field. Editing leases and version fences still apply; an animation or a
selected node does not prove a save or permission.

Use host-provided draft tools and collaboration support when available. For
API-based edits preserve concurrency fields and handle conflicts through the
[workspace procedure](../../api-workspace/references/workspace.md). Do not invent
collaboration tokens, reuse another user's token, or clear a lease to force a save.
After a disconnect, re-read identity, head and revision, and pending operation
status before issuing a new mutation. An explicit Sync must not discard an
unsaved draft after its save failed. A cursor follows work; it is not the
transport for changes.

## Reuse, history and restoration

- Scenario library entries (the sidebar Pathways page) are read live from
  each agent's newest trunk save. A copy is independent: editing the source
  later never changes it. See the [pathway library](pathway-library.md).
- Archived nodes are copies. Archiving does not remove the original from its
  canvas. Deleting an archive removes a reusable copy, not an agent's live node.
- Reusing a subtree requires checking ids, internal references, external tools,
  auth-zone membership and environment dependencies. Do not merely rename the
  top node and leave conflicting child or edge ids.
- Scenario history supplies snapshots to compare. The `path` of container ids
  identifies nested scope; a label alone is not a stable identity.
- Restoring a past prompt means a new minimal edit against today's head, not
  replacing the whole agent with an old snapshot. Production rollback is a
  separate lifecycle action with eligible previously deployed versions.
- `GET /:agentId/versions/:versionId/graph` addresses a row id and returns
  compiled nodes and edges for historical interpretation. `/versions/:semver`
  is a different full-snapshot route. A compiled graph is not editable JSON.

## Reuse and import workflows

None of these publish. Each changes only the target agent's dev head; reaching
callers still needs publish and promote. Every save carries the fence
(`parent_version_id`, `parent_revision`); on `409 STALE_HEAD`, re-read and
redo the edit, never force it.

**Copy a scenario to another agent, or carry a change to its copies.**
Follow the [pathway library workflows](pathway-library.md#workflow-copy-a-pathway-into-another-agent):
paged library read, target read, id re-mint, snippet and auth-zone handling,
dependency check, one fenced save per target.

**Import v1 pathways into an existing agent.** Call budget: one convert, one
read, one save.

1. `POST /v2/agents/migrate/pathways` with `{pathways: [{pathway_id}], create:
   false}`. It returns `scenarios`, `warnings` and `import_warnings` without
   creating an agent. For `translate` mode use the async
   `/migrate/translations` and poll.
2. Read the target's `versions/latest`, insert the returned scenario nodes
   under the hub, and merge `import_warnings` into `settings.importWarnings`.
3. Save with the fence, then report every warning to the user.

**Archive a scenario.** `POST /v2/agents/:agentId/archived-nodes {node}`
first, then remove the node from the snapshot and save. The archive is a copy;
nothing else changes.

**Unarchive a scenario.** Re-insert the archived node into the snapshot and
save. Only after the save succeeds, `DELETE /v2/agents/library/archived-nodes/:id`.
Deleting first loses the only copy if the save fails.

**File a scenario in a library folder.**
`PUT /v2/agents/library/scenario-folders {agent_id, node_id, folder_id}`;
`folder_id: null` unfiles it. Folders are shared with legacy pathway folders;
folder create, rename and delete are in the
[pathway library](pathway-library.md#workflow-file-pathways-in-folders).

## Operational surfaces

For call and conversation investigations, preserve agent and version
attribution, channel, call or thread identity, timestamps and the difference
between messages and calls. Use the returned ids to retrieve full evidence;
one call-list row is not the complete conversation or all transfer legs. See
[call retrieval](../../call-analysis/references/retrieval.md).

For alerts and automations, inspect the selected agent, trigger, evaluation
version or metric, threshold and window, destination and enabled state through
their documented APIs. Running an eval is not enabling an alert; enabling an
automation can create ongoing effects. Do not guess endpoint names or toggle an
unrelated org-wide rule to repair an agent-local issue.

Rollouts, experiments, identity registration, RCS sender steps, contact-card
sends, number binding, shared tool changes, disposition publication, memory
resets and deletion all have effects beyond a local file. Follow the user's
requested scope and host permissions, with verification specific to the
resource changed.
