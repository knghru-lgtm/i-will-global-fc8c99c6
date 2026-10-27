# The v2 lifecycle model

The full model behind the [lifecycle skill](../SKILL.md). Request contracts are
in the [endpoint dictionary](api.md); staged rollouts and A/B tests are in
[rollouts](rollouts.md). Older deployments can differ; check the connected API
before using new modes.

## Contents

- [Environments](#environments)
- [The ship pipeline](#the-ship-pipeline)
- [Which version answers each channel](#which-version-answers-each-channel)
- [Inbound binding, the twin and fail-open](#inbound-binding-the-twin-and-fail-open)
- [Branches](#branches)
- [Standalone experiments](#standalone-experiments)
- [Environment variables](#environment-variables)
- [Checks and promotion policy](#checks-and-promotion-policy)
- [The rest of the surface](#the-rest-of-the-surface)

## Environments

Every agent has exactly three fixed environments: `dev`, `staging` and
`production`. They are created with the agent and cannot be configured.

- **dev is never pinned.** It always means the newest version on the trunk
  timeline (the head). Saving a version deploys it to dev.
- **staging and production are pins**: a pointer at one immutable version row.
  A new agent has both unpinned. Anything that resolves production with no
  production pin (an outbound call with no `agent_version`, or any request
  that selects `production`) fails with `AGENT_ENV_UNPINNED`; it does not
  fall back to the head. Draft tests are unaffected: test chat, simulations
  and test runs default to the dev head and dev variables, so a new agent can
  be tested before anything is pinned. Inbound calls still connect and run
  the twin's stored copy, compiled at the last attach or promote (after a
  fresh attach to a never-promoted agent, that is the latest save),
  unattributed.

## The ship pipeline

```text
save version ──► dev        (automatic)
publish ───────► staging    (mints a semver if the version has none)
promote ───────► production (empty body = staging's pin; or an exact candidate)
rollback ──────► production (only a version production ran before)
```

- **Publish** moves only staging. Body modes: `{snapshot}` saves a new version
  and publishes it; `{version_id}` publishes an existing one (`branch_id`
  alongside publishes a branch head, and the branch stays open); `{}`
  publishes the dev head. `bump: patch|minor|major` (default `patch`) mints
  the next semver above the highest ever minted. Re-publishing a published
  version re-records its original semver.
- **Promote** takes an empty body (production := staging's current pin) or
  `{version_id, branch_id?, bump?}` for an exact candidate on dev or an open
  branch. An exact candidate also repoints staging and can mint a semver for a
  never-published version. `branch_id` must match the candidate's branch.
  Empty staging blocks only the empty-body form (`400 STAGING_UNPINNED`).
  Promotion enforces the staging check policy below. While a migration
  rollout is live, promote returns `409 ROLLOUT_IN_PROGRESS`.
- **Rollback** takes `{version_id}` of a version that already has a production
  deployment row. `GET /deployments?env=production` rows carry
  `is_rollback_eligible`; that list is the valid candidate set. Rollback is
  never blocked by a rollout.
- Every staging or production repoint appends an immutable **deployment row**
  (`GET /deployments`). dev never writes one.
- **Name versions you intend to reference.** A named version is kept forever.
  An unnamed save is an autosave head that later autosaves coalesce into, so
  its snapshot can be rewritten in place.

## Which version answers each channel

| Channel | Runs by default | Per-request override |
|---|---|---|
| Outbound `POST /v1/calls` with `agent_id` | production pin | `agent_version` selector |
| Inbound voice on a bound number | production pin, or a live experiment or rollout arm | none |
| Builder test-chat socket | dev head | `version_id` query parameter (takes a selector) |
| Web chat widget | the twin's stored graph | none; a widget has no version pin |
| API chat (`POST /v1/chat` with `agent_id`) | the twin's stored graph | none |
| SMS on a bound number | the twin's stored graph | none |

Selector grammar (`agent_version`, `version_id`): `production` | `staging` |
`dev` or `latest` | a minted semver `X.Y.Z` | `branch:<name>`.

- **The selector, not the version, decides which environment's variables
  resolve.** Environment labels resolve their own environment. A semver,
  `branch:` or `dev` selector always resolves dev variables, even when that
  version is the production pin. Testing by semver does not prove the
  production variable set.
- **Test chat proves the dev head**, not what customers hear. Publish and
  promote, or pass an explicit selector, before claiming production parity.
  When the builder tests the Staging or Production version it selects it by
  semver, so it runs with dev variables.
- An unrecognized selector (a number, a typo such as `prod`) depends on the
  surface. `POST /v1/calls` refuses it with a 400 naming `agent_version`, and
  nothing dials. The test-chat socket's `version_id` and the builder's test
  routes treat it as no selector and run the production pin. Send only the
  grammar above.
- **API chat** also needs the API chat channel switched on in the version the
  chat runs. The `agent-channels` skill owns that workflow.

## Inbound binding, the twin and fail-open

Attaching numbers (`POST /:agentId/inbound/attach`) does not bind a number to
the agent directly. It builds a **twin**, a compiled copy of the agent, and
points the number at it. The widget, API chat and SMS run the same twin.

- **Attach clears the number's direct-pathway columns.** A v1 pathway on that
  number stops answering at once. Send `only_if_unassigned: true` unless the
  user asked to move a number; the attach then refuses (`409
  NUMBER_ALREADY_ASSIGNED`) rather than take a number someone else holds.
- **The twin's stored graph changes on these events only**: a production
  attach or re-attach (compiles the **dev head** of that moment, with
  `{{env.KEY}}` references left unfilled), binding a widget (compiles
  production, or the latest save if never promoted), a production variable
  write while a widget is bound, and any **production repoint**, promote or
  rollback (compiles the production pin with production variables). Publish
  does not touch it. Between those events it is stale. If production cannot
  be prepared at a refresh, the twin keeps its old copy.
- So a fresh attach puts dev-head behavior on SMS, the widget and API chat
  until the next promote. Plan verification of those channels after promote,
  not after publish.
- At call time inbound voice resolves the production pin, and **fails open**:
  if resolution errors or does not finish in time (unpinned production,
  invalid snapshot, unresolved environment variable), the call still runs on
  the twin's stored graph, unattributed to the agent version. Keep production
  pinned and valid, and promote to refresh the twin.
- `environment: "staging"` on attach makes inbound calls on that number resolve
  the staging pin. It needs an enterprise org, routing that supports it, a
  published staging pin and resolved staging variables.
- One number binds one agent (rebinding overwrites). One agent can hold many
  numbers. A repoint, a staging or production variable write, an attach or a
  detach reaches the next inbound call on the affected environment.
- Deleting the agent unbinds every number and retires the twin. It is refused
  (`409 AGENT_HAS_BOUND_WIDGETS`) while a widget still runs the twin.

## Branches

A branch is a **dev workspace**, never a deployable line of its own. Names: 1
to 64 characters of `[A-Za-z0-9._-]`, never `dev`, `latest`, `staging`,
`production` or a semver shape (they would shadow selectors).

- Cut from the current dev head (`base_version_id`). Save onto it with
  `branch_id` on the version POST; read with `?branch=`.
- **Merge is a fast-forward-only squash.** It produces one new dev version
  carrying the branch head's snapshot. When dev has moved, merge returns
  `409 BRANCH_BEHIND`: run **rebase-preview** (a three-way dry run), then
  **rebase** with `{dev_head_version_id, resolutions}` (`"ours"` = branch,
  `"theirs"` = dev, or `{value}`). Rebase writes to the branch and advances its
  base; merge then fast-forwards. Order-sensitive routing arrays
  (`conditions`, `responsePathways`) and `position` conflict as a whole.
- A branch head can be tested with selector `branch:<name>` (dev variables),
  published to staging with `{version_id, branch_id}`, or promoted as an exact
  candidate. Promotion changes production and staging under the promotion
  policy; publishing changes only staging. A merged or deleted branch cannot
  be selected (`AGENT_BRANCH_NOT_FOUND` on a call or test) or published or
  promoted (`409 BRANCH_CLOSED`).

## Standalone experiments

`POST /:agentId/experiments` is the low-level A/B primitive. The Experiments
page labels a bare experiment "started through the API" and shows only a
small card for it. For a new A/B test, prefer a rollout with preset `ab`
([rollouts](rollouts.md)): the page then shows metrics, guardrails and
history, and `finish` promotes the winner. Experiments are enterprise-only
(`403 ENTERPRISE_REQUIRED`).

- One active experiment per agent: `{variant_version_id, traffic_percentage
  1-100, baseline_env (default production), run_hours?, starts_at?, ends_at?,
  variant_call_quota?}`. The variant is compiled at creation, so a broken
  variant is a 400 now, not a fail-open surprise later.
- Only **selector-less** calls are eligible. Any explicit `agent_version`, even
  `"production"`, is never split and never attributed. Outside run
  hours, quota or dates, calls run the baseline arm but stay attributed.
  Unanswered outbound calls never consume quota.
- The baseline is the environment pointer. A promote or rollback that
  repoints production **auto-completes a production-baseline experiment**
  (`baseline_changed`). For a staging baseline, do not rely on a publish to
  end it; stop it explicitly. A bare experiment has no winner endpoint:
  promote the variant, or `POST /experiments/:id/stop` and do nothing.
- Both arms of an experiment resolve production variables.
- Only `traffic_percentage`, dates, `run_hours` and quota are PATCHable. When a
  rollout drives the experiment, a traffic PATCH returns
  `409 ROLLOUT_IN_PROGRESS`; change it from the rollout.
- Read both arms with `GET /experiments/:id/metrics?window_hours=`.

## Environment variables

`{{env.KEY}}` values are stored per agent and environment. Keys match
`[A-Za-z0-9_]+`: **no dots** (the resolver splits on dots, so a dotted key never
resolves).

- The namespace is disjoint from call variables by design. `{{env.KEY}}` is
  substituted into the snapshot at prepare time, before the call exists. Plain
  `{{key}}` remains the per-call namespace. They cannot collide, and request
  data cannot shadow an environment variable.
- **Unresolved is a loud failure.** A referenced `{{env.KEY}}` with no value in
  the resolving environment fails call preparation
  (`AGENT_VARIABLE_UNRESOLVED`). It never passes through as a literal, unlike
  plain `{{key}}`.
- `{is_secret: true}` stores the value in the org secret store and keeps only a
  `{{SECRET.name}}` reference. Reads return the reference, never the value.
- A whole-string `{{env.KEY}}` is accepted where the validator expects a typed
  field (for example `contact.inboundNumbers`).

## Checks and promotion policy

A check config per agent and environment (`staging` or `production`): 1 to 5
agent-testing scenarios times judge evals (`required` defaults true), and
`simulations_count` per scenario (default 5, at most 50 and at most the
org's per-scenario simulation limit; the refusal names it).
`POST /environments/:env/check-runs` (body `{version_id?}`) runs simulations
against the candidate and scores them in one eval run. The default candidate
is what a promotion into that environment would deploy: staging's pin for
production, the dev head for staging.

- Statuses `PENDING`, `RUNNING`, then `PASSED`, `FAILED`, `ERROR` or
  `CANCELLED`. `overall_passed` means every required judge reached at least a
  0.5 match rate (no required judges passes vacuously).
- **Production promotion enforces the saved staging check policy.** If it is
  enabled with required judges, the latest staging run for the exact candidate
  must match the current scenarios, simulation count, judge versions and
  targets, and satisfy every required verdict. Missing or stale results,
  pending runs or failed required verdicts block with `409 CHECKS_BLOCKED`.
  Version rollouts apply the same policy when they start and when they finish.
- No enabled required policy means no gate. It does not prove quality. Read
  the detailed verdicts, not a headline status or an old passing run.
- Check runs freeze the candidate and use the check environment's variables. A
  staging check is not evidence that production bindings work.
- `force: true` is an explicit override, recorded as forced. Never add it,
  disable checks or remove required judges to make a failed promotion
  succeed. A request to deploy does not authorize skipping a known safety
  gate.
- Rollback is never gated by checks, and neither is a promote of a version
  production already runs (it only brings staging level).
- One active run per agent and environment. A stuck run returns 409 to new
  starts until it is cancelled or it is ended as timed out after 45 minutes.

## The rest of the surface

- **Agent CRUD**: create takes `{name}` only (configuration lives in versions);
  PATCH renames only; DELETE is soft and unbinds every number; list has only
  `?limit`.
- **Version reads**: `GET /versions/latest` is the full snapshot;
  `GET /versions/:semver` takes a minted `X.Y.Z`, never a row id;
  `GET /versions` is a metadata list. `GET /versions/:versionId/graph` takes a
  row id and returns a compiled graph, not an editable snapshot.
- **Identity and branded calling**: per-agent contact card and branded caller
  ID submission to carrier review. Both reach outside the org.
- **Memory**: `settings.enableMemory` and `settings.memorySchema`. Schema
  inference persists nothing. Inbound and SMS memory follow the twin
  persona's copy, refreshed on promote. Memory records are runtime data; see
  [resource boundaries](resources.md#knowledge-and-memory).
- **Library**: `GET /library/scenarios?paginate=true` (each agent's
  pathways, read live from its newest trunk save) and archived nodes
  (self-contained copies). How the Pathways page, copies, versions and
  folders work: [pathway library](pathway-library.md).
- **Platform migration endpoints**: `POST /v2/agents/migrate` (planner, 10 per
  hour, dry run by default), `/migrate/pathways` (deterministic 1:1, up to 20),
  `/migrate/persona`, and async `/migrate/translations`. These are the
  platform's own converters. `/norm:migrate` is the hand doctrine and does not
  use them.
