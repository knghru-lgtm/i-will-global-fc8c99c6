# The Pathways page: the pathway library, versions and folders

How the sidebar Pathways page works, what a v2 "pathway" on it is, and how to
reuse one in another agent safely. Part of the
[lifecycle skill](../SKILL.md). Request contracts are in the
[endpoint dictionary](api.md#memory-library-history); how a saved change
reaches callers is the [ship pipeline](lifecycle.md#the-ship-pipeline).

Do not write fetch scripts and do not search the docs for these routes.

## Contents

- [What it is](#what-it-is)
- [Objects and how they relate](#objects-and-how-they-relate)
- [Lifecycle and states](#lifecycle-and-states)
- [How it reaches a live call or conversation](#how-it-reaches-a-live-call-or-conversation)
- [On the dashboard](#on-the-dashboard)
- [Workflow: copy a pathway into another agent](#workflow-copy-a-pathway-into-another-agent)
- [Workflow: carry a change to agents that copied a pathway](#workflow-carry-a-change-to-agents-that-copied-a-pathway)
- [Workflow: restore an earlier version of a pathway](#workflow-restore-an-earlier-version-of-a-pathway)
- [Workflow: file pathways in folders](#workflow-file-pathways-in-folders)
- [Rules and limits](#rules-and-limits)
- [When it goes wrong](#when-it-goes-wrong)
- [Questions people ask](#questions-people-ask)

## What it is

On the dashboard a v2 **pathway** is a top-level scenario inside one agent:
a prompt scenario, a multi-step pathway scenario, or an authentication
scenario. In the snapshot it is a node in `behavior.nodes`
([snapshot dialect](../../v2-snapshot/SKILL.md)). The sidebar Pathways page
is an **inventory** of every agent's pathways in the org, with their version
history and a folder tree. It is not an editor and it is not a shared
component library.

It is not:

- **A shared, linked pathway.** Nothing on the page is referenced by several
  agents. "Copy to another agent" makes an independent copy. Editing the
  original later never changes the copy, and the reverse.
- **A separately versioned object.** A pathway has no versions of its own.
  Its "versions" are the saves of the agent that owns it.
- **A deploy unit.** A pathway ships only when its whole agent is published
  and promoted.
- **A legacy pathway.** Older pathways appear on the same page as Legacy.
  They are read-only here; see [the migration skill](../../v2-migration/SKILL.md).

## Objects and how they relate

```text
 org
 ├── agent A ── newest save (dev head) ── behavior.nodes
 │                                          ├── pathway P1 (scenario node)
 │                                          └── pathway P2
 ├── agent B ── newest save ─────────────── pathway P1' (a copy: new ids,
 │                                            no link back to P1)
 │
 ├── folder tree (org-wide, shared with legacy pathways)
 │     └── filing: (agent id, pathway node id) ──► folder
 │
 ├── archive (org-wide): self-contained copies of removed nodes
 │
 └── org resources a pathway may point at by id, shared live:
       library tools, knowledge sources, code snippets
```

- The library is **read live** from each agent's newest trunk save. It holds
  no copy of its own. Branch saves and unsaved builder edits are not in it.
- A filing is keyed by agent id and pathway node id, so a copy (new id) starts
  unfiled, and a removed pathway's filing simply stops showing.
- What a copy duplicates: prompts, steps, routes and settings inside the
  pathway. What stays shared: anything referenced by id outside the pathway.
  A change to a library tool or a knowledge source is felt by every agent
  that references it.

## Lifecycle and states

```text
 created in agent A's builder
        │ save
        ▼
 in A's newest save ──► listed in the library, "View versions" shows A's saves
        │
        ├─ publish + promote A ──► callers of A hear it
        │
        ├─ copy to agent B ─────► P1' saved on B's dev head (B unchanged for callers)
        │
        ├─ archive ─────────────► copy kept in the archive; removed from A at the next save
        │       └─ unarchive ───► back on A's canvas, saved, then the archive copy is dropped
        │
        └─ delete from A ───────► gone from the library; A's older saves still hold it
```

Filing is a separate two-state toggle (unfiled under "All pathways", or
filed in one folder) that never touches the agent.

## How it reaches a live call or conversation

A pathway reaches callers exactly like any other part of its agent.

- **Calls read the version, not the library.** Each call runs the version its
  channel resolves ([which version answers](lifecycle.md#which-version-answers-each-channel)).
  The library shows the dev head, which may be ahead of production.
- **A copy changes only the target's dev head.** Callers of the target hear
  it after the target is published and promoted. Test chat on the target
  runs it at once.
- **Copies drift by design.** Editing the source after a copy changes the
  source agent only. To carry the change, use the
  [update workflow](#workflow-carry-a-change-to-agents-that-copied-a-pathway).
- **Shared resources are live.** A library tool referenced with
  `byReference`, a knowledge source or a code snippet changes for every
  consumer when it changes, with no promote.
- **Folders, filing and the archive never affect calls.**

## On the dashboard

Read the page first: `get_dashboard_page_context` with `mode: "synced"`.

| Pathname | What it is | Context it yields |
|---|---|---|
| `/dashboard/scenarios` | The org-wide Pathways page | Search params: `q`, `connection` (`legacy` or `agent`), `agent` (an agent id), `folder` (a folder id), `sort`, `view=versions` with `pathway=<agent id>:<node id>` for the expanded row |
| `/dashboard/agent/$agentId/scenarios` | One agent's Pathways list (Current and Archived tabs) | `agentId` from `route.params` |
| `…/scenarios/$scenarioId/$versionId` | One pathway, as it stands in one agent version | `scenarioId` (the node id), `versionId` (a version id, or `latest` for the draft) |
| `/dashboard/pathways/$pathwayId` | A legacy pathway's read-only viewer | Hand to [the migration skill](../../v2-migration/SKILL.md) |

The org-wide page:

- One table: Pathway (name and kind: Prompt, Pathway or Authentication),
  Connection (the owning agent, or Legacy), Folder, then actions. Filters:
  search over name, agent and description; a Connection menu (All, Legacy
  (V1), All agents, or one agent); sort by name or by connection.
- **View pathway** opens the agent's read-only pathway page at its draft.
  **View versions** lists the owning agent's saves inline, each badged with
  the environment that pins it. **Move to a folder** files it. The row menu
  offers **Copy to another agent**. A legacy row offers **Migrate**, or a
  link to the agent it was migrated into.
- The folder aside creates, renames and deletes folders.

The agent's Pathways list shows the builder's current draft, including
unsaved edits, and offers **Create pathway**. The pathway page is a viewer: a
version rail, Compare, **Edit in builder** on the current version and
**Restore to draft** on an older one. It has no deploy control; Publish in
the top bar ships the whole agent. Edits need permission to edit agents.

Neither page refreshes after an API write. Say "Saved through the API. The
page shows it after a refresh." If the user has the target agent open in the
builder, ask them to reload before editing there.

## Workflow: copy a pathway into another agent

Call budget: one source read, one target read, one save, plus one
`save_code_snippet` per custom-code step.

1. **Find the source.** `bland_api_get`
   `/v2/agents/library/scenarios?paginate=true`, then repeat with
   `&after=<next_cursor>` until `next_cursor` is `null`. If a page fails,
   the list is incomplete: say so rather than report what is missing. Each
   group is `{agent_id, agent_name, scenarios: [{id, name, kind,
   description, children, node}]}`. If the source agent is known, its
   `GET /v2/agents/<source id>/versions/latest` is enough.
2. **Read the target** `GET /v2/agents/<target id>/versions/latest`. Keep
   `id` and `revision` for the fence. A target with no saved version needs a
   starting snapshot first ([v2-authoring](../../v2-authoring/SKILL.md)).
3. **Build the copy** from `node`:
   - give the pathway, and every node and edge inside its `flow`, a new id,
     and rewrite internal references (edge `source`/`target`, route
     `targetNodeId`/`targetId`, fallbacks, `exitPlacements`) to match;
   - remove `parentId`: the source's authentication zone does not come along;
   - on each custom-code step, read the code that actually runs before
     dropping the pin: `GET /v1/snippets/get/<snippetId>?all_versions=true`
     and take the entry for `snippetVersion`. The step's `code` field is only
     an editor copy and can be empty or stale. Save that code as a new
     snippet, then set the copy's `snippetId` and `snippetVersion` to it (two
     steps never share a snippet; see
     [custom code](../../tool-library/references/workflows.md#custom-code-tools)).
     Over an OAuth connection the snippet read is refused: stop and ask the
     user to copy the pathway on the Pathways page instead;
   - a route that points outside the pathway keeps an id the target does not
     have: re-point it or name it.
4. **Check dependencies** in the target: library tools and knowledge ids
   (shared, not copied), `{{env.KEY}}` keys with values in the target's
   environments ([pre-flight](../../agent-environments/references/environments.md#variable-pre-flight)),
   and whether the pathway must sit behind the target's verification. Name
   anything missing; do not invent it.
5. **Confirm**, then append the copy to the target's `behavior.nodes` and
   save `POST /v2/agents/<target id>/versions` with `{snapshot, name,
   parent_version_id, parent_revision}`. Report every entry in `warnings`.
6. Say what changed: the target's dev head only. Offer the pipeline; do not
   publish unasked.

```text
About to copy pathway <name> from <source agent> into <target agent>:
a new dev save on <target agent>; callers are unaffected until it is
published and promoted. Shared tools and knowledge stay shared.
Reply "yes" to proceed.
```

## Workflow: carry a change to agents that copied a pathway

The platform keeps no link from a copy to its source, so "update the shared
pathway" means re-copying into each agent the user names.

1. **List the targets.** Ask, or offer the library rows with the same name
   in other agents from a complete paged read. Confirm the list; never assume
   a same-named pathway is a copy.
2. Read the source pathway (as in copy step 1) and each target's
   `versions/latest`.
3. For each target, build a fresh copy (copy step 3), then give it the old
   copy's node `id`, `position` and `parentId`. Keeping the id keeps its
   filing and its version line. Show the user what differs between the old
   copy and the new one.
4. **Confirm once with every target named**, then save each target with its
   own fence. On `409 STALE_HEAD` re-read that target and redo its edit.
5. Report per target: saved version and warnings. Each agent ships through
   its own publish and promote.

```text
About to replace pathway <name> in <N> agents (<names>) with the current
version from <source agent>. Each agent gets a new dev save; callers are
unaffected until each one is published and promoted. Reply "yes" to proceed.
```

## Workflow: restore an earlier version of a pathway

1. `bland_api_get` `/v2/agents/<agent id>/scenarios/<node id>/history`
   (add `path=["<container id>"]` for a nested node, `before=<version id>`
   for older pages). Each entry carries the pathway `node` as saved, or
   `null` where that save did not hold it.
2. Read `versions/latest`. Replace only that pathway's `data` with the old
   entry's `data`; keep its id, position and routes.
3. Confirm, then save with the fence. This is a new dev save, not a rollback;
   production rollback is a separate [lifecycle action](lifecycle.md#the-ship-pipeline).

## Workflow: file pathways in folders

- File or unfile: `call_bland_api` PUT `/v2/agents/library/scenario-folders`
  `{agent_id, node_id, folder_id}`; `folder_id: null` unfiles. Use only a
  node id read from the library. Read filings with GET on the same path.
- Folders: `GET /v1/pathway/folders`; create `POST /v1/pathway/folders`
  `{name, parent_folder_id?}`; rename `PATCH /v1/pathway/folders/<id>`
  `{name}` (name only, no re-parenting).
- Delete `DELETE /v1/pathway/folders/<id>` only after moving everything out:
  subfolders first, legacy pathways with `POST /v1/pathway/folders/move`
  `{pathway_id, folder_id: null}`, and v2 filings unfiled. Confirm.

## Rules and limits

| Rule | Limit or behavior | What the user sees |
|---|---|---|
| What the library lists | Top-level scenario, pathway and authentication nodes of each agent's newest trunk save; not the hub, not steps, not branches | Missing rows |
| Agents per library request | 50; follow `next_cursor`. Without `paginate=true` only the first 50 agents come back | A silently partial list |
| Library cursor | An agent id | `400 INVALID_CURSOR` "Invalid agent cursor" |
| Agents with no save or no pathways, deleted agents | Not listed | |
| Row description | The first 160 characters of the prompt | |
| Version history | 25 saves per page, newest first, every save of the agent | "Content unavailable" where the save lacks the pathway |
| History `path` | A JSON array of at most 10 container ids | `400` "path must be a JSON array of node IDs" or "Invalid scenario history parameters" |
| Filing body | `agent_id` and `folder_id` UUIDs, `node_id` up to 200 characters | `400` "Invalid scenario folder membership"; `404` "Agent not found" or "Folder not found" |
| Folder create | A name is required; a parent must exist | "Folder name is required", "Invalid parent folder" |
| Folder delete | Refused while it holds subfolders or legacy pathways; v2 filings drop with it | "Cannot delete non-empty folder", "Move the folder's pathways out before deleting it" |
| Archive list | The newest 200 entries org-wide | Older entries not listed |
| Copy save | The target's save fence and validation | `409 STALE_HEAD`; on the dashboard "This agent changed while copying. Try again to use its latest draft." |
| Writes | Need permission to edit agents | Disabled controls on the page |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| A pathway is missing from the library | Only on a branch or unsaved; agent deleted; a step, not a top-level pathway; or only the first page was read | The agent's `versions/latest`; `next_cursor` | Save it to the trunk; follow the cursor |
| Edited the original; the copies did not change | Copies are independent | Compare the two snapshots | [Carry the change](#workflow-carry-a-change-to-agents-that-copied-a-pathway) |
| The copy works in test chat, not on calls | Saved on the target's dev head only | Target environments vs head | Publish and promote the target |
| A custom-code step in the copy does nothing | The snippet pointer was dropped and no new snippet was saved | Save warning "Custom code … hasn't been saved — the code won't run until you press Save code" | Save the code as a new snippet and set it on the step |
| Copied pathway fails `AGENT_VARIABLE_UNRESOLVED` | The target lacks an `{{env.KEY}}` value | The error lists the keys | Set them in the target's environments |
| Callers reach the copy without verifying | It sat in an authentication zone in the source | No `parentId` on the copy | Place it in the target's zone |
| A tool change hit two agents | Both reference the same library tool | `toolId` in both snapshots | Expected; fork the tool if they must differ |
| Folder delete refused | Subfolders or legacy pathways inside | The error text | Move them out, then delete |
| "Restore to draft" says "Nothing to restore" | Not viewing Development, or the draft already matches | The environment selector | Switch to Development |

## Questions people ask

**Is a pathway shared across agents?** No. Each pathway belongs to one agent.
Copying makes an independent copy.

**If I fix the original, do the copies update?** No. Re-copy into each agent
you name, then ship each one.

**Which version does the library show?** Each agent's newest save, which can
be ahead of what callers hear.

**Can I deploy one pathway on its own?** No. Publish and promote ship the
whole agent.

**Where are a pathway's versions?** They are the agent's saves. A row shows
the pathway as it stood in that save.

**Does moving a pathway to a folder change anything on calls?** No. Folders
only organise the page.

**Why can't I edit an old pathway on this page?** Legacy pathways are
read-only. Migrate one into an agent with
[the migration skill](../../v2-migration/SKILL.md).

**Can I copy into an agent that has never been saved?** The dashboard starts
a snapshot for it. Through the API, build a starting snapshot first.
