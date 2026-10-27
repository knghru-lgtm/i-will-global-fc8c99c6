# How environments work: which version answers, and why

The conceptual model behind the [agent-environments skill](../SKILL.md) and
the [lifecycle skill](../../v2-lifecycle/SKILL.md). Procedures and exact
error text are in the [environments reference](environments.md); request
bodies are in the [endpoint dictionary](../../v2-lifecycle/references/api.md);
ramps and A/B tests are in [rollouts](../../v2-lifecycle/references/rollouts.md).

## Contents

- [What it is](#what-it-is)
- [Objects and how they relate](#objects-and-how-they-relate)
- [Lifecycle and states](#lifecycle-and-states)
- [How it reaches a live call or conversation](#how-it-reaches-a-live-call-or-conversation)
- [On the dashboard](#on-the-dashboard)
- [Rules and limits](#rules-and-limits)
- [When it goes wrong](#when-it-goes-wrong)
- [Questions people ask](#questions-people-ask)

## What it is

Every save of a v2 agent creates a version. Environments decide which of
those versions real callers reach. Development is where you edit
and test; Staging holds the version you intend to ship; Production holds the
version callers get. Moving a version forward is a pointer change, not a
copy, so it is instant and reversible.

It is not:

- **Saving.** A save changes Development only. No caller hears it
  (one exception: attaching a number compiles the latest save into the
  twin; see below).
- **A branch.** A branch is a private line of edits inside Development. It
  never answers live traffic on its own.
- **Call variables.** `{{env.KEY}}` values belong to an environment and are
  set before the call. Plain `{{key}}` values arrive with each call.
- **A rollout.** A rollout or A/B test sends a share of production traffic to
  another version for a while. Promotion moves all of it at once.

## Objects and how they relate

```text
 agent (org-scoped)
 ├── versions ──────────── immutable snapshots; trunk saves + branch saves
 │     ▲   ▲   ▲
 │     │   │   └── semver (X.Y.Z) minted the first time a version is published
 │     │   │
 ├── environments (exactly three, created with the agent)
 │     ├── dev ........... no pin: always the newest trunk save (the head)
 │     ├── staging ....... pin ──► one version
 │     └── production .... pin ──► one version
 │
 ├── deployment history ── one row per staging or production repoint
 ├── variables ........... per environment: KEY ──► value or secret reference
 ├── check policy ........ per environment; staging's gates production
 ├── check runs .......... a scored simulation batch for one version
 ├── branches ............ cut from the dev head; merge back as one dev save
 ├── rollout / experiment  production pin vs a candidate, by traffic share
 └── twin ................ a compiled copy that serves chat, SMS and widgets
```

Versioned objects (the snapshot, including voice and language) only change
callers through a pin. Live objects (variables, the check policy, the twin)
take effect without any version change.

## Lifecycle and states

A version moves forward through pins. Nothing deletes a version. A version
that is named, published, pinned or scored by a check run is frozen; an
unnamed autosave head can still be rewritten by the next autosave, so name a
version before you reference it.

```text
            save                publish               promote
 (edit) ─────────► dev head ─────────────► staging ─────────────► production
                     │  ▲                     │                      │
       branch save   │  │ merge (one squashed │ promote exact        │ rollback
       ──► branch ───┘  │ dev save)           │ version: staging     ▼
                        │                     │ follows         an earlier
       rebase ◄─────────┘ (dev moved: resolve │                 production
                          conflicts, then     │                 version
                          merge)              │
```

| Move | What changes | What it never does |
|---|---|---|
| Save | A new version; dev now means it | Touch staging or production |
| Publish | Staging's pin; mints a semver on first publish | Run or enforce checks (the dashboard runs them first; see below) |
| Promote, empty body | Production := staging's pin | Promote anything staging does not hold |
| Promote an exact version | Production and staging := that version | Skip the check policy |
| Rollback | Production := a version production ran before | Move staging; consult checks |
| Merge a branch | One new dev save holding the branch head | Publish |

Semvers: `bump` (`patch` by default) mints the next number above the highest
ever minted on the agent. A version keeps its first semver forever; publishing
or promoting it again re-records the same number.

Branch states: open (can be saved to, tested, published, promoted), `behind`
(dev moved since the branch was cut; merge refuses until a rebase), merged or
deleted (closed for good; its versions stay readable).

## How it reaches a live call or conversation

### Which version answers

```text
 incoming request
      │
      ├─ outbound call with agent_id ── selector given? ── yes ─► that version
      │                                       │
      │                                       no ─► experiment live? ─► arm
      │                                                    │
      │                                                    no ─► production pin
      │
      ├─ inbound call on a bound number ─► experiment arm or production pin
      │       (a number attached for staging resolves the staging pin;
      │        no pin or a failure falls back to the twin, unattributed)
      │
      ├─ builder test chat ─────────────► dev head (or the version you pick)
      │
      └─ web widget, API chat, SMS ─────► the twin (last compiled copy)
```

Only outbound calls (`agent_version`) and the builder's test chat (its
version picker) can choose a version per request. Selectors: `production`, `staging`, `dev` or `latest`, a minted `X.Y.Z`, or
`branch:<name>`. A semver selector reaches any version that was ever
published, not only the current pins. An unrecognized value (a number, a
typo such as `prod`) is refused by an outbound call with a 400, and nothing
dials; the test-chat connection's `version_id` treats it as no selector,
which means production.

### Which variables resolve

The selector decides the environment, and the environment decides the
variable values. The version alone does not.

| You select | Version | Variables from |
|---|---|---|
| nothing (default) | production pin | production |
| `production` / `staging` | that pin | that environment |
| `dev`, `latest`, `X.Y.Z`, `branch:<name>` | that version | dev |
| an experiment arm (automatic) | baseline or candidate | production |
| a staging check run | the candidate | staging |

So calling the production version by its semver runs it with **dev** values.
To test production's values, select `production`. The builder's test chat
has the same trap: when you test the Staging or Production version there, it
selects that version by its semver, so it runs with dev values.

At call start the platform reads every `{{env.KEY}}` anywhere in the
snapshot (prompts, tool bodies, settings, contact fields), looks each one up
in the resolving environment (case-insensitive), and substitutes the value.
Secret values stay as references and are filled in only while the call runs;
they are never written into the compiled call. One missing key stops the call
before it starts with `AGENT_VARIABLE_UNRESOLVED`, listing every missing key.

### What is frozen and what is read live

| Thing | When it is read | A change is felt |
|---|---|---|
| The version a call runs | Call start | On the next call after the repoint |
| Variables and the voice, on calls | Call start | On the next call; nothing mid-call |
| Variables on the twin (chat, SMS, widget) | When the twin is compiled | After the twin's next refresh |
| The check policy | At promote | On the next promote |
| Experiment arm | Call start, then fixed for that call | On the next call |

A promote or rollback reaches new inbound calls right away. A production or
staging variable write also reaches the next inbound call without a
promote. Treat both as live changes.

### The twin

Chat, SMS and widgets do not resolve a version per message. They run a
compiled copy of the agent, the twin. The twin exists once the agent has a
bound number, widget or API chat. It is refreshed only on these events:

| Event | The twin becomes |
|---|---|
| Production promote or rollback | the production pin, with production variables |
| Attaching a number for production | **the dev head** at that moment, with `{{env.KEY}}` references not filled in |
| Binding a web widget | production (or the latest save if never promoted) |
| A production variable write while a widget is bound | production, with the new values |
| The first API chat on an agent | production (or the latest save if never promoted) |

Publishing to staging does not touch it, and neither does a staging or dev
variable write. Between events it is stale: a fresh attach puts dev-head
behavior, with unfilled variable references, on SMS, API chat and the widget
until the next promote. If production cannot be prepared at a refresh (for
example a production variable is missing), the refresh is skipped and the
twin keeps its old copy. API chat also needs the API chat channel switched on
in the production version (`CHANNEL_DISABLED` otherwise).

Inbound voice resolves the production pin at call time and uses the twin
only as a fallback. When that resolution errors or does not finish in time
(no production pin, an invalid snapshot, a missing production variable), the
call still connects and runs the twin's stored copy, and it is not
attributed to a version. Keep production pinned and its variables complete.

### Checks and promotion

```text
 staging check policy ──► check run on candidate version V ──► verdicts
                                                                  │
 promote V to production ── reads the newest staging run for V ◄──┘
        │
        ├─ no policy, disabled, or no required judge ──► allowed
        ├─ run missing, or its frozen config differs ──► "Run evaluations before promoting"
        ├─ run pending or running ─────────────────────► "Evaluations are still running"
        ├─ a required judge failed ────────────────────► "A required evaluation failed…"
        └─ every required judge passed ────────────────► allowed
```

A run counts only when it scored the exact version being promoted, in
staging, with the same scenarios, the same conversations per scenario, and,
for every required judge, the same judge version and passing levels as the
saved policy. Editing the policy therefore voids earlier runs. Judges you
removed are ignored. A judge passes when at least half of its scored
conversations reach a passing level. A run that errored or was cancelled
counts as not run.

Rollback is never gated: it only returns to a version that already passed
through production. Promoting a version production already runs, to bring
staging level with it, is also not gated.

### Rollouts and experiments

A live rollout or experiment splits only calls that name no version:
outbound calls without `agent_version` and inbound calls on production
numbers. Chat, SMS, the widget and numbers attached for staging never split.
Both arms run with production variables. A promote or rollback ends a bare
experiment on production. A promote during a version rollout ends the
rollout as superseded; a promote during a migration rollout is refused.
Rollback is never blocked.
Details: [rollouts](../../v2-lifecycle/references/rollouts.md).

## On the dashboard

| Page | Shows | Can do |
|---|---|---|
| `…/environments/overview` | Rows in release order: Production, Experiment (enterprise), Evaluations, Staging, Development with its branches; an Activity list of saves, publishes, promotes and rollbacks, with a diff between two published versions | Publish (from Main or a branch), promote, roll back, create or delete a branch, configure and run checks |
| `…/environments/variables` | One tab per environment (Development first); values, with secrets masked and badged "Secret" | Add, replace, delete; "Store as secret" (cannot be read back after saving) |
| `…/experiments` | The live rollout or A/B test | Every rollout action |

What the page does that the API does not:

- **Publish runs the checks first.** The dashboard's Publish (in the builder
  and on Environments) starts a staging check run on the exact version and
  stops the publish if a required judge fails (a "Publish blocked" notice
  with the number of failed required evaluations). It also cancels an older run in flight. The API's
  publish does neither, so through the API you start the staging run
  yourself.
- **Promote holds** with the reason when nothing new is staged, production
  already runs it, a required check has not passed, or an experiment is
  live. "Promote anyway" names what it skips and is recorded as forced.
  Through the API that is `force`, which this plugin never sends. A live
  migration rollout hides promote entirely.
- **First deploy:** with production empty and no required check, Staging and
  Evaluations read "After first publish" and Publish sends Development
  straight to production (an exact-version promote).
- **Rollback** lists only versions production ran before, and warns that
  every live call uses the chosen version from then on.
- The checks dialog offers 1, 3 or 5 conversations per scenario (default 3).
  The API default is 5.

None of these pages refresh after an API write. Say "Saved through the API.
The page shows it after a refresh."

## Rules and limits

| Rule | Limit or behavior | Error |
|---|---|---|
| Environments | Exactly `dev`, `staging`, `production` | `INVALID_ENV` |
| Production must be pinned for outbound calls with no selector, and for anything that selects `production` | No fallback to the head; inbound falls back to the twin instead. Test chat and simulations default to the dev head and need no pin | `AGENT_ENV_UNPINNED` |
| Variable key | Letters, digits, underscore. A key starting with a digit saves but can never be referenced | `INVALID_KEY` |
| Variable value | Required | `MISSING_VALUE` |
| Missing referenced variable | Call never starts | `AGENT_VARIABLE_UNRESOLVED` |
| Branch name | 1 to 64 of letters, digits, `.`, `_`, `-`; not `dev`, `latest`, `staging`, `production` or `X.Y.Z` | `INVALID_NAME` |
| Branch selector on a merged or deleted branch | Not found | `AGENT_BRANCH_NOT_FOUND` |
| Publish or promote a closed branch's version | Refused | `BRANCH_CLOSED` |
| Concurrent publish or promote | One at a time per agent | `PUBLISH_IN_PROGRESS` |
| Check scenarios | 1 to 5, this agent's own, not targeting a pathway | `400` with the reason |
| Conversations per scenario | Default 5; at most 50 and at most the org's per-scenario simulation limit | "Conversations per scenario must be at most N" |
| Check judges | At least one; each once; graded needs passing levels; pass/fail takes none | `400` with the reason |
| Active check runs | One per agent and environment; a stuck run ends after 45 minutes | `409 CONFLICT` |
| Rollback target | A version production ran before, not the current one | `400` with the reason |
| Rollouts and experiments | Enterprise only; one live per agent | `403 ENTERPRISE_REQUIRED`, `409` |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| "My fix didn't take" on calls | Saved to dev, never promoted | `GET …/environments`: production's version differs from the head | Publish, then promote |
| Test chat is right, phone calls are wrong | Test chat runs the dev head; calls run production | Compare the call's version with the head | Promote, or test with the `production` selector |
| SMS, widget or API chat runs old or unreleased behavior | Twin is stale, or a production attach compiled the dev head | Last promote vs last attach time | Promote (or roll back) to refresh the twin |
| Call fails with `AGENT_VARIABLE_UNRESOLVED` | The resolving environment lacks a key | The message lists the keys and the environment | Set the keys in that environment |
| Inbound call works but shows no agent version | Inbound fell back to the twin | Call row has no version; production pin or variables broken | Pin production, fix variables, promote |
| Testing by semver passes, production fails | Semver resolves dev variables | Production variable list is missing keys | Set production values; test with `production` |
| Promote returns `CHECKS_BLOCKED` "Run evaluations…" | No run for this exact version, or the policy changed since | Latest staging run's version and frozen config | Run staging checks with this version id |
| Promote blocked though the last run passed | That run scored another version (often the dev head) | Run's candidate vs staging's pin | Rerun with `versionId` = staging's pin |
| `ROLLOUT_IN_PROGRESS` on promote | A migration rollout is live | `GET …/rollouts/live` | Finish or roll back the rollout |
| Merge refused `BRANCH_BEHIND` | Dev moved since the branch was cut | `behind: true` on the branch | Rebase preview, resolve, rebase, merge |
| `{{env.api.host}}` never resolves | Keys cannot hold dots or dashes | Key list | Rename the key and its references |

## Questions people ask

**Which version is this call running?** The call record names its agent
version. With no selector, an outbound or inbound call runs production's pin
at the moment it started, or an experiment arm.

**Does publishing make my change live?** No. Publish moves staging only.
Promote moves production.

**Why did my outbound test pass but real calls fail?** If the test named a
semver, a branch or `dev`, it used dev variables. Production may lack a key.

**How fast does a promote reach callers?** New calls after the promote get
the new version. Calls already in progress keep theirs. Chat and SMS change
when the twin refreshes, which a promote does.

**Can I undo a promote?** Yes: roll back to any version production ran
before. Rollback is never blocked by checks or rollouts.

**Do variable changes need a promote?** No. A staging or production variable
write is felt on that environment's next call. Chat and SMS pick it up when
the twin next refreshes.

**Why is promote blocked when every judge passed last week?** The run must
score the exact version being promoted with today's policy. Editing the
policy, or a different staging version, voids it.

**Is a branch a separate environment?** No. It is a workspace inside
Development, tested with `branch:<name>` and dev variables, and it reaches
callers only through publish and promote.
