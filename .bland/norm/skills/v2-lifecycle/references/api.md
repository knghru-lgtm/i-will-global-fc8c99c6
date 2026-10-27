# The v2 agent API: endpoint dictionary

Base: `/v2/agents` unless a row names another path. Auth: the org's API key.
Writes require an editor role (admin, owner, operator or prompter). Responses
use the `{data, errors}` envelope; an error is `{error: <CODE>, message}`.
Literal segments (`/library/*`, `/migrate*`) resolve before `/:agentId`.

**Error codes.** Many refusals come back as the generic `400 BAD_REQUEST`,
`404 NOT_FOUND` or `409 CONFLICT` with a human message. Match on the status
and read the message; do not expect a specific lowercase code. Rows below name
a specific code only where the API sends one.

## Contents

- [Agents](#agents)
- [Versions](#versions)
- [Lifecycle](#lifecycle)
- [Branches](#branches)
- [Experiments](#experiments)
- [Rollouts](#rollouts)
- [Environment variables](#environment-variables)
- [Checks](#checks)
- [Additional agent surfaces](#additional-agent-surfaces)
- [Inbound numbers and identity](#inbound-numbers-and-identity)
- [Identity: RCS sender](#identity-rcs-sender)
- [Memory, library, history](#memory-library-history)
- [Memory records](#memory-records)
- [Platform migration endpoints](#platform-migration-endpoints)
- [Agent-testing surface](#agent-testing-surface)

## Agents

| Endpoint | Body / query | Returns | Notes |
|---|---|---|---|
| `POST /` | `{name}` (non-empty) | 201 `{agent, environments[3]}` | Nothing else accepted; all config lives in versions. Creates dev, staging and production rows, all unpinned. |
| `GET /` | `?limit` (optional, 1 to 500) | agent rows + `color` + `twin_pathway_id` (null = no number bound) | Ordered `updated_at desc`. No `limit` returns every agent; a `limit` caps the list and there is no paging. For an org-wide scan read once with no `limit`. |
| `GET /:agentId` | none | agent row + `environments` | No snapshot or settings here; fetch a version for config. |
| `PATCH /:agentId` | `{name}` | updated row | Rename is the only agent-level mutation. |
| `DELETE /:agentId` | none | `{id, deleted: true}` | Soft delete; versions and history stay. **Unbinds every inbound number and retires the twin, so live inbound and texting on those numbers stop.** Disables the agent's alert configs. `409 AGENT_HAS_BOUND_WIDGETS` (with `widget_ids`) while a web chat widget runs the agent. List bound numbers first (`GET /:agentId/inbound`) and confirm. |

## Versions

| Endpoint | Body / query | Returns | Notes |
|---|---|---|---|
| `POST /:agentId/versions` | `{snapshot!, name?, branch_id?, autosave?, parent_version_id?, parent_revision?}` | 201 full version row (+`warnings[]`) | Validator: at most 2 MiB serialized, unique node ids, edge integrity, flow nesting at most 10, guardrail rules, `contact.inboundNumbers` (array or whole-string `{{env.KEY}}`). Named version = kept forever; unnamed = coalescing autosave head. `parent_*` = optimistic-concurrency fence, `409 STALE_HEAD` (+`head_version_id`, `head_revision`). No semver here; publish mints it. |
| `GET /:agentId/versions/latest` | `?branch=` | full row incl. `snapshot` | The whole-agent JSON export. Dev head, or branch head (falls back to the branch's base). |
| `GET /:agentId/versions/:semver` | none | full row incl. snapshot | `:semver` is a minted `X.Y.Z`, never a row id, no `v` prefix. Only published versions are addressable: 400 `INVALID_VERSION` or 404. |
| `GET /:agentId/versions/:versionId/graph` | none | `{agent_id, version_id, nodes, edges}` | Row UUID, including historical call attribution. Compiled graph, not an editable snapshot. |
| `GET /:agentId/versions` | `?branch=&limit=` (default 50, max 200) | metadata only `{id, name, created_via, created_by, created_at, semver\|null}` | `semver` = first deployment's mint. |

## Lifecycle

| Endpoint | Body | Returns | Errors |
|---|---|---|---|
| `POST /:agentId/publish` | `{snapshot, bump?}` \| `{version_id, bump?, branch_id?}` \| `{bump?}` (dev head) | 201 `{version, semver, environments}` (200 when `already_published`) | 400 `INVALID_BUMP` / `INVALID_SNAPSHOT` / `NO_VERSIONS`, 404 `VERSION_NOT_FOUND`, 409 `PUBLISH_IN_PROGRESS`, 409 `BRANCH_CLOSED`. Moves staging only. `bump` default `patch`. |
| `POST /:agentId/promote` | `{}` or `{version_id, branch_id?, bump?}`; optional `force` | 200 `{semver, environments, production_moved}` | See the promote table below. |
| `GET /:agentId/publish-preview` | `?version_id=` | candidate comparison | Read-only planning, not a lock or proof that promotion will succeed. |
| `POST /:agentId/rollback` | `{version_id}` | 200 `{semver, environments}` | `400 BAD_REQUEST` "Production is already pinned to this version" or "Cannot roll back to a version that was never deployed to production"; 404 `NOT_FOUND`. Production only; candidates = `is_rollback_eligible` deployment rows. Never blocked by a rollout. |
| `GET /:agentId/environments` | none | 3 rows `{env_type, current_version_id, current_version: {name, semver}\|null}` | dev is always null. |
| `GET /:agentId/deployments` | `?env=` (default production) `&limit=` (default 50, max 200) | newest first `{env_type, kind (publish\|promote\|rollback), agent_version_id, version_name, semver, deployed_by, deployed_at, check_run\|null, is_rollback_eligible}` | Append-only; never written for dev. `is_rollback_eligible` = a production row that is not the current pin. |

Promote errors:

| Status and code | Meaning and fix |
|---|---|
| 409 `CHECKS_BLOCKED` | The staging check policy blocks this candidate ("Run evaluations before promoting", "Evaluations are still running", "A required evaluation failed"). Run or fix the checks. Never add `force` to get past it. |
| 409 `ROLLOUT_IN_PROGRESS` | A migration rollout is ramping traffic onto production. Finish or roll back the rollout first. |
| 400 `STAGING_UNPINNED` | Empty body and staging has no pin. Publish first, or promote an exact `version_id`. |
| 400 `ALREADY_IN_PRODUCTION` | Production already runs this version. Nothing to do. |
| 409 `PUBLISH_IN_PROGRESS` | Another publish or exact-version promote is running for this agent. Retry after it ends. |
| 400 `INVALID_BRANCH` | `branch_id` was sent without `version_id`. |
| 409 `BRANCH_CLOSED` | The candidate's branch was merged or archived. Promote from dev. |
| 400 `INVALID_FORCE` | `force` was not a boolean. |
| 400 `INVALID_BUMP`, 404 `VERSION_NOT_FOUND` | Bad `bump`, or the version is not on this agent. |

`force: true` is a recorded override of the check policy, not a retry. This
plugin never sends it; a request to ship does not authorize it.

## Branches

| Endpoint | Body | Returns | Errors |
|---|---|---|---|
| `POST /:agentId/branches` | `{name}` (1 to 64 `[A-Za-z0-9._-]`, not an env label or semver shape) | 201 branch + `behind: false` | 409 `BRANCH_EXISTS` (open branches only). Base = current dev head. |
| `GET /:agentId/branches` | none | open branches, each with `behind` (base is not the dev head) | `behind: true` means merge would return 409. |
| `DELETE /:agentId/branches/:branchId` | none | soft delete (abandon) | Branch versions retained. |
| `POST …/:branchId/merge` | none | one new squashed dev version; branch stamped merged | 409 `BRANCH_BEHIND` (rebase first), 400 `NO_CHANGES`, 409 `MERGE_IN_PROGRESS`. Fast-forward only. |
| `POST …/:branchId/rebase-preview` | none | `{dev_head_version_id, up_to_date, auto_merged, changes, conflicts}` | Dry-run three-way merge. |
| `POST …/:branchId/rebase` | `{dev_head_version_id, resolutions?: {<conflictId>: "ours"\|"theirs"\|{value}}}` | new version on the branch; base advances to that dev head | 409 `REBASE_STALE`, 400 `UNRESOLVED_CONFLICTS` (returns them), 400 `INVALID_MERGE`. `"ours"` = branch, `"theirs"` = dev. |

## Experiments

The low-level A/B primitive. Enterprise only (`403 ENTERPRISE_REQUIRED`). The
Experiments page labels a bare experiment "started through the API"; prefer a
[rollout](#rollouts) with preset `ab` for a new A/B test.

| Endpoint | Body | Notes |
|---|---|---|
| `POST /:agentId/experiments` | `{variant_version_id!, traffic_percentage! (1 to 100), baseline_env? (production\|staging, default production), run_hours? {timezone, days: {mon: {start, end}, …}}, starts_at?, ends_at?, variant_call_quota? (up to 1M)}` | `409 CONFLICT` when an experiment is already active. `400 BAD_REQUEST` when the baseline has no pin, the variant is already the baseline's pin, the variant is not on this agent, or the variant does not compile (it is compiled now). |
| `GET /:agentId/experiments[/:id]` | none | Statuses `active` / `completed` (`completed_reason`: manual, date_ended, quota_reached, baseline_changed). |
| `GET /:agentId/experiments/:id/metrics` | `?window_hours=` (1 to 336, default 24) | `{metrics}`: baseline and variant over the window. |
| `PATCH /:agentId/experiments/:id` | only `{traffic_percentage?, run_hours?, starts_at?, ends_at?, variant_call_quota?}` | Variant and baseline are immutable. `409 CONFLICT` on a completed experiment. `409 ROLLOUT_IN_PROGRESS` on a traffic change while a rollout drives it. |
| `POST /:agentId/experiments/:id/stop` | none | `completed_reason: manual`. Never refused by a rollout. |

No winner endpoint for a bare experiment: promote the variant (the baseline
repoint completes it as `baseline_changed`) or stop it.

## Rollouts

Enterprise only. Routes under `/:agentId/rollouts`: list, `live`,
`metric-sources`, `/:rolloutId`, `/events`, `/metrics?window_hours=`, create,
PATCH, and the actions `pause`, `resume`, `advance`, `traffic`, `step-back`,
`rollback`, `finish`. The full contract, bodies, refusals and workflows are in
[rollouts](rollouts.md).

## Environment variables

| Endpoint | Body | Notes |
|---|---|---|
| `GET /:agentId/environments/:env/variables` | none | `[{variable_key, value, updated_at}]`; secret values come back as their `{{SECRET.name}}` reference. |
| `PUT …/variables/:key` | `{value!, is_secret?}` | Key must match `[A-Za-z0-9_]+` (no dots); start it with a letter or underscore, or no reference can reach it. `400 MISSING_VALUE` without `value`. `is_secret: true` stores the raw value in the org secret store; only the reference persists. A staging or production write reaches that environment's next inbound call; a production write also refreshes the twin when a widget is bound. |
| `DELETE …/variables/:key` | none | `{deleted: true}`; backing secret cleaned up best-effort. |

`:env` here is all three (dev, staging, production). A referenced but missing
`{{env.KEY}}` fails call preparation loudly.

## Checks

| Endpoint | Body | Notes |
|---|---|---|
| `GET/PUT/DELETE /:agentId/environments/:env/checks` | PUT: `{enabled?, scenario_ids! (1 to 5, this agent's, non-pathway), simulations_count? (default 5, at most 50 and the org's per-scenario simulation limit), evals!: [{eval_agent_id, eval_agent_version_id, target_level_keys?, required? (default true)}]}` | `:env` = staging or production only. Full replace; GET returns `null` when unconfigured. Graded evals need `target_level_keys`; pass/fail must omit them. |
| `POST /:agentId/environments/:env/check-runs` | `{version_id?}` | 202 PENDING run. Default candidate: staging pin (for production), dev head (for staging). `400 BAD_REQUEST` with a message when no checks are configured, checks are disabled, the config is invalid, or there is no candidate. `409 CONFLICT` "A check run is already in progress" (a stuck run is ended after 45 minutes). Config frozen into the run. |
| `GET /:agentId/check-runs?env=&limit=` (default 25, max 100) · `GET …/check-runs/:runId` · `POST …/check-runs/:runId/cancel` | none | Candidate, environment, frozen judge roster and result links. Cancel on a finished run: `409 CONFLICT`. Promotion validates the saved staging policy; see [policy](lifecycle.md#checks-and-promotion-policy). |

Check simulations use the check environment's variables. `DELETE …/checks/evals/:evalAgentId`
removes a configured judge; that weakens the policy and is not a workaround
for failing results.

## Additional agent surfaces

- `GET /starter` reads the starter agent; `POST /starter` ensures one and may
  start its supported simulation. It is not a read-only discovery operation.
- `POST /:agentId/collaboration`, `/edit`, `/heartbeat`, `/leave` support the
  builder's scoped collaboration protocol. Reuse host support and preserve its
  tokens and baselines; do not guess payloads.
- `/:agentId/dispositions/*` owns definitions, extractor versions and result
  workflows. Read the [disposition API guide](../../evaluations/references/dispositions.md).
- `POST /migrations` starts the managed migration workflow; GET
  `/migrations/:runId` observes it and POST `/migrations/:runId/cancellations`
  requests cancellation. This is distinct from the `/migrate*` converters below;
  discover the current request and eligibility before starting billed work.

## Inbound numbers and identity

| Endpoint | Body | Notes |
|---|---|---|
| `GET /:agentId/inbound` | none | `{agent_id, persona_id, pathway_id, numbers[], staging_attach_supported}`. The twin ids are null before the first attach. Each number carries `agent_env_type` (`"staging"`, or null for production). |
| `POST /:agentId/inbound/attach` | `{inbound_numbers: string[], only_if_unassigned?: boolean, environment?: "production"\|"staging"}` | See the attach notes below. |
| `POST /:agentId/inbound/detach` | `{inbound_numbers: string[]}` | Unbinds only rows bound to this agent's twin. The number then runs only its own remaining settings, if it has any. A v1 pathway cleared by an earlier attach is not restored. Repeat calls are safe. |
| `POST /:agentId/widgets/:widgetId/bind` | none | Points a web chat widget at the agent's twin, compiled from production (or the latest save if never promoted). |
| `GET/PUT /:agentId/identity` | PUT partial: `display_name (up to 80), tagline (up to 140), support_email, website, address, vcf_delivery_enabled, rcs_enabled, bcid_enabled` | Contact-card branding; not versioned. `vcf_delivery_enabled` makes the agent send a real contact card after a first reply. `POST …/identity/logo` is multipart (dashboard only); `GET …/identity/contact-card.vcf`. |
| `GET /:agentId/identity/bcid` · `POST …/bcid/submit` | submit: `{display_name (up to 30), call_reason (up to 60), category, phone_numbers[], carriers ⊂ [tmobile, verizon], attest, resubmit?}` | Branded caller ID: submits to carrier review through the telecom registry. Reaches outside the org; get explicit approval. Status: not_submitted, submitted, pending_review, approved or rejected. |
| `POST /:agentId/identity/contact-card/test` | `{to, channel: sms\|imessage\|rcs}` | A real, billed send to `to` (402 on a short balance). Rate-limited 5 per minute; needs a bound number or configured sender. Confirm first. |

Attach notes:

- **Attach clears the number's direct-pathway columns. A v1 pathway on that
  number stops answering at once.** It also takes a number bound to another
  agent or persona. Before attaching, read who answers each number now and say
  what the cutover does.
- `only_if_unassigned: true` binds only numbers with no agent, persona or
  pathway, and refuses the whole batch with `409 NUMBER_ALREADY_ASSIGNED`
  otherwise. Send it unless the user asked to move a number.
- A production attach compiles the **dev head** into the twin, which also
  changes SMS, the widget and API chat until the next promote.
- `environment: "staging"` makes inbound calls resolve the staging pin.
  Refusals: `403 ENTERPRISE_REQUIRED`, `409 STAGING_NUMBER_UNSUPPORTED` (the
  org's routing cannot do it), `409 AGENT_ENV_UNPINNED` (publish to staging
  first), `409 AGENT_VARIABLE_UNRESOLVED` (staging variables missing).
- Other errors: `400 INVALID_BODY`, `400 INVALID_INBOUND_NUMBERS` (numbers must
  belong to the org), `400 NO_VERSIONS`, `422 COMPILE_FAILED`.
- The `phone-numbers` skill owns the full number workflow (owner check,
  cutover, verification call).

## Identity: RCS sender

Path `/v1/messaging/rcs/:phone`, where `:phone` is one of the org's numbers.
This is a multi-step registration wizard on the dashboard's Identity page.
**Every write registers something with an outside messaging provider or a
carrier, and none can be undone from here.** Use the confirm template before
each write and name what it registers.

| Endpoint | Body | Effect |
|---|---|---|
| `GET /v1/messaging/rcs/:phone` | `?refresh=true` re-reads status now | The sender and its review status. Read-only. |
| `POST …/sender` | `{sender: {…profile}}` | Creates or updates the RCS sender and its brand profile with the provider. |
| `POST …/test-devices` | `{phone_number}` | Registers a phone as a test device with the provider. |
| `POST …/registrations/google` | registration form | Submits the compliance registration to the RCS network and locks it. |
| `POST …/registrations/us` | registration form | Submits the US compliance registration (creates an address record) and locks it. |
| `POST …/submit` | none | Submits the sender for review. |
| `POST …/attach` | none | Switches live outbound messages on the number to RCS. `409` until the sender is online. |

Field shapes for the forms are not listed here. Read the current state with the
GET, and prefer the dashboard Identity page for the forms. Branded caller ID
needs a business profile the dashboard keeps in the browser; do it on the
Identity page.

## Memory, library, history

| Endpoint | Notes |
|---|---|
| `GET /:agentId/memory/schema` | `{entity_schemas, source: settings\|cached_version\|null}`. Resolution: dev head `settings.memorySchema`, then a previously inferred schema, then the twin's production copy. |
| `POST /:agentId/memory/schema/infer` | `{snapshot?}`. Infers entity schemas from the compiled agent and persists nothing (save the result into `settings.memorySchema` yourself). 6 per minute. An OAuth connection cannot reach it. |
| `GET /library/scenarios?paginate=true&after=&exclude_agent_id=` | Top-level scenario nodes read live from each agent's newest trunk save, full node inline. With `paginate=true`: `{groups, next_cursor}`, 50 agents per page; follow `after=<next_cursor>` until `null`. Without it, a bare array of the first page only. See [pathway library](pathway-library.md). |
| `GET /library/archived-nodes` · `POST /:agentId/archived-nodes {node}` · `DELETE /library/archived-nodes/:id` | Self-contained node copies (org-wide, 200 listed). Archiving never edits the canvas; delete is hard but removes only a copy. |
| `GET /library/scenario-folders` · `PUT /library/scenario-folders {agent_id, node_id, folder_id\|null}` | Which folder each v2 scenario is filed under (shared with v1 pathway folders). `folder_id: null` unfiles. |
| `GET /library/pathway-migrations` | For each migrated v1 pathway, the newest live v2 agent it went into. An agent built from several pathways records only the first. |
| `GET /:agentId/scenarios/:nodeId/history?path=&branch=&before=` | Per-scenario snapshots (the client diffs them), keyset-paged 25 per page, plus both pins' copies. `path` = JSON array of container ids for nested flows. |

## Memory records

Base `/v1/memory`. What an agent remembered about a contact. These are runtime
data, not configuration. 100 requests per 15 minutes. Writes need an admin,
owner or operator role.

| Endpoint | Body / query | Notes |
|---|---|---|
| `GET /v1/memory/changes` | `?call_id=` or `?conversation_id=` | The memory diff recorded for that call or conversation. 404 means no memory data. |
| `GET /v1/memory/stores` | none | `{stores}`. A v2 store id is `v2-persona-<twin persona id>` (inbound and SMS) or `v2-agent-<number>`. |
| `GET /v1/memory/:memoryId` | `?limit=` (default 50) `&offset=&search=` | Contacts with summaries in that store. |
| `GET /v1/memory/context` | `?persona_id=` or `?agent_number=`, plus `contact_id` | The full context the agent would see. An OAuth connection cannot reach it. |
| `GET /v1/memory/contact/:id` · `GET …/contact/:id/messages` | none | One contact's memory; its recent messages. |
| `PATCH /v1/memory/contact/:id/summary` · `PATCH …/facts` | `{summary}` · `{facts}` | Overwrites what the agent recalls on the next call. Confirm first. |
| `POST /v1/memory/reset` | `{persona_id or agent_number, contact_id}` | **Hard-deletes** that contact's memory row. Cannot be undone. REQUIRED confirm. |

`POST /v1/memory/enable` is for v1 pathways and personas only. A v2 agent turns
memory on with `settings.enableMemory` in a version.

## Platform migration endpoints

The platform's own converters.

| Endpoint | Body | Notes |
|---|---|---|
| `POST /migrate` | `{pathway: {nodes, edges, name?, globalPrompt?}, name?, create?}` | Planner plus deterministic materializer. `create: false` (default) = dry run `{plan, snapshot, lint}`; `create: true` = 201 with agent and version. Caps: 500 nodes, 2000 edges, 2 MB. 10 per hour per org. 422 on lint failure, blocking loss, open question or unsupported custom code. |
| `POST /migrate/stream` | same | Server-sent progress events. |
| `POST /migrate/pathways` | `{pathways: [{pathway_id, version?, mode?} \| {pathway}], name?, create? (default true)}` | Deterministic 1:1 conversion, up to 20 pathways into one agent. `create: false` returns `{created: false, scenarios, warnings, import_warnings, lint}` to insert into an existing agent. 60 per hour per org. |
| `POST /migrate/persona` | `{persona_id, name?, pathway_modes?}` | Deterministic persona to agent shell plus scenarios. Always creates. `translate` modes go to `/migrate/translations`. |
| `POST /migrate/translations` → `GET /migrate/translations/:runId` → `POST …/:runId/cancellations` | pathways body or persona body | Async (202, then poll). Up to 5 translate items, 3 active runs per org. Statuses PENDING, RUNNING, FINALIZING, COMPLETE, FAILED, CANCELLED; cancel only before FINALIZING. |

## Agent-testing surface

`/v1/agent-testing`: scenario CRUD (`/scenarios`, supports `?agent_id=`) ·
per-scenario eval agents (`/scenarios/:id/eval-agents`) · templates
(`/templates`, `/templates/:id/clone`) · `POST /scenarios/generate-from-call` ·
execution (`/scenarios/:id/run`, `/scenarios/:id/simulate`, `/batch-run`) ·
results (`/runs`, `/runs/:id`, `/batches/:id`, `/runs/:id/analyze`) · simulation
sets (`/simulation-sets`, `/simulation-sets/:id`, `/scenarios/:id/simulation-runs`,
`/simulation-runs/:id/results`) · analytics (`/analytics/:pathwayId[/enhanced]`) ·
load-test mode (`/tornado/*`). Grading discipline and safety rails: the
`v2-testing` skill.
