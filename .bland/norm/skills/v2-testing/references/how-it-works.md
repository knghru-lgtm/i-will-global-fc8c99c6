# How agent testing works

The conceptual page for test cases, simulations, test chat and voice
probes: what each surface actually runs, which version it runs, and what it
touches. Request bodies are in [simulations](simulations.md) and
[probes](probes.md); evidence rules for audio are in [voice](voice.md);
judges and scoring are in
[how evaluations work](../../evaluations/references/how-it-works.md).

## Contents

- [What it is](#what-it-is)
- [Objects and how they relate](#objects-and-how-they-relate)
- [Lifecycle and states](#lifecycle-and-states)
- [How a simulation exercises the agent](#how-a-simulation-exercises-the-agent)
- [How each surface reaches the agent](#how-each-surface-reaches-the-agent)
- [On the dashboard](#on-the-dashboard)
- [Rules and limits](#rules-and-limits)
- [When it goes wrong](#when-it-goes-wrong)
- [Questions people ask](#questions-people-ask)

## What it is

Agent testing produces new conversations with a v2 agent before real
callers do. A **test case** describes a caller: who they are, what they
want, and the call inputs they arrive with. A **simulation** has a
simulated caller talk to the agent in text, then grades the transcript.

It is not:

- **Evaluating existing calls.** That is an eval run over call ids; nothing
  new is generated ([evaluations](../../evaluations/references/how-it-works.md)).
- **A voice test.** Simulations and test chat are text. They prove routing,
  wording, tool use and variables, not latency, interruption or audio.
- **A sandbox.** The agent runs its real integrations. Webhooks and tools
  fire for real in every surface.
- **A load test.** Conversations in one simulation run one after another.

## Objects and how they relate

```text
 AGENT-OWNED                                     PER EXECUTION
 ┌───────────────────────────────┐
 │ Test case (scenario)          │   POST …/run ──► one conversation run
 │  tester_persona_name / prompt │                  inline assertions only
 │  request_data, start_node_id  │
 │  max_turns                    │   POST …/simulate ──► simulation set
 │  inline assertions[]          │        │              N conversation runs
 │  judge roster (pinned         │        │              (one after another)
 │    judge versions + targets)  │        ▼
 │  source calls (provenance)    │   one scoring run (an eval run, text
 └───────────────────────────────┘   mode) with the roster's judges
                 │
                 └── used by a promotion check: N conversations per case,
                     pinned candidate version, that environment's values
```

- A test case belongs to one v2 agent (`agent_id`). Older cases may belong
  to a v1 pathway or persona until they are moved.
- **Inline assertions** live on the case and grade each conversation as it
  finishes (`LLM_JUDGE`, `NODE_REACHED`, `VARIABLE_EXTRACTED`,
  `WEBHOOK_TRIGGERED`, `REGEX_MATCH`, `STRING_CHECK` and others).
- **The judge roster** pins evaluation judges by version. Only `/simulate`
  and check runs use it.
- **Source calls** are production calls the persona was written from. They
  are provenance only; the agent never sees them.

## Lifecycle and states

### One conversation run

```text
 PENDING ──► RUNNING ──┬──► PASSED   every required inline assertion passed
   (202 says           ├──► FAILED   a required inline assertion failed
    "RUNNING")         ├──► ERROR    could not run: compile error, no saved
                       │             version, 10-minute limit, deadline
                       └──► CANCELLED
```

- The transcript and per-turn logs fill in while the run is `RUNNING`.
- A case with no inline assertions ends `PASSED` whenever the conversation
  completes. That says nothing about judges.

### One simulation

```text
 POST …/simulate (202, simulation_set_id)
   │
   ├─ conversations 1..N run one after another
   │     summary.status "RUNNING", eval_run_id null, logs empty
   │
   ├─ all conversations done ──► scoring run created (eval_run_id set)
   │     summary.status follows the scoring run: PENDING … RUNNING
   │
   └─► COMPLETE | PARTIAL | FAILED
         FAILED when generation produced nothing or every judgment failed
```

Read results with `GET /v1/agent-testing/simulation-runs/{simulation_set_id}/results`:

| Field | What it means |
|---|---|
| `assertions[].passed` | The judge's verdict for the case: true when at least half of the conversations with a determinable verdict hit its target. Null when no conversation had a determinable verdict. |
| `assertions[].score`, `breakdown` | Mean 0 to 100 score; for graded judges, the share of conversations per level. |
| `logs[].passed` | That conversation was scored cleanly. Not a verdict. |
| `summary.passed` | Every conversation was scored cleanly (no threshold is set on simulations). Not a verdict. |
| `summary.total_calls`, `passed_count` | Conversations in the scoring run, and how many scored cleanly. |

Report `assertions[]` as the outcome. A green `summary.passed` with a
failing assertion is a failing test.

## How a simulation exercises the agent

```text
 1. Resolve the agent: its latest saved version (the dev head),
    compiled with the dev environment's variable values.
 2. Open a text session on that graph, seeded with request_data
    (and start_node_id when the case sets one).
 3. Turn 0: the agent speaks first (greeting), with no caller input.
 4. Each later turn: the simulated caller writes one message,
    the agent answers through its normal step-by-step runtime.
 5. Stop when the agent ends the conversation or reaches a closing
    step, or after max_turns caller turns.
 6. Grade inline assertions on this conversation.
 7. After all N conversations: score the transcripts with the roster.
```

- **The agent side is real.** The same step-by-step runtime the builder's
  test chat uses: routing, extraction, tools, webhooks, knowledge. Tool and
  webhook steps make their real requests. A transfer does not dial anyone.
- **It is the voice graph in text.** It does not run the messaging brief,
  and voice settings (speech, interruptions, latency) have no effect.
- **The simulated caller sees little.** Only its persona name, its persona
  prompt and the transcript so far. It never sees the agent's prompts,
  steps or variables. Put every fact it must supply (names, numbers,
  confirmations, when to ask for a human) in `tester_persona_prompt`.
- **Call inputs come only from `request_data`.** Phone-keyed lookups need a
  `from` in E.164; clock logic needs the value it reads. Nothing is
  inferred from a real phone line.
- **The version is not selectable for agent cases.** `/run` and
  `/simulate` always run the dev head; `version_number` applies only to v1
  pathway cases. The run detail records the version that ran in
  `metadata.agent_version_id`. To score a specific candidate with an
  environment's values, use a promotion check run (see
  [agent environments](../../agent-environments/SKILL.md)).
- **Scoring sees simulation evidence only.** Judges get transcript, call
  metadata, pathway logs and semantics, variables, configs and tool logs.
  An audio judge on a test case is scored as a text judge on the
  transcript, so its verdict says nothing about how the call sounded.
- **It is not a production call.** Simulated conversations do not appear in
  call logs or on the Conversations page, and their ids cannot be sent to
  an eval run of existing calls.

## How each surface reaches the agent

| Surface | Version it runs | Variable values | Medium | Leaves a record |
|---|---|---|---|---|
| Simulation (`/run`, `/simulate`) | Dev head | dev | Text, step by step | Test-case conversation |
| Promotion check run | Pinned candidate | That environment | Text, step by step | Check run + scoring run |
| Test chat socket | `version_id` selector, default `latest` | dev; an environment label runs as that environment | Text, step by step | Chat session |
| Messaging preview | `agent_version` selector, default dev head | as selected | Text through the messaging runtime | None; nothing delivered |
| Browser voice test | `agent_version` selector, default `latest` | as selected | Live audio | A conversation, after processing |
| Phone call to the number | The number's production pin (staging pin if staging-attached) | That environment | Live audio | A production call |

"Latest" means the newest saved version. An edit the builder has not saved
yet is not tested by any surface; save first.

## On the dashboard

| Page | What it does |
|---|---|
| `/dashboard/agent/<agent id>/judges/test-cases` | Create, edit and delete test cases, build one from conversations (up to 50), add source calls, update the persona from them, run or simulate, watch the transcript stream in. |
| `/dashboard/agent/<agent id>/judges/runs` | Multi-case runs (judges times test cases), promotion check runs, and the onboarding starter run. |
| `/dashboard/judges/test-cases` | Org view of cases a v1 pathway or persona still owns, with a move-to-agent action. |
| Builder testing panel | Test chat, messaging preview, and a browser voice test on the version on screen. |
| Environments, checks | Promotion checks: which cases and judges must pass before a publish. |

- A multi-case run on the Runs tab is one `/simulate` per case, grouped by
  the browser that started it. Another browser, another user, or an API
  client sees the member simulations under each case, not one run.
- The Runs tab installs the chosen judges on each case's roster before it
  simulates, so a case's roster reflects the last run started from there.
- The page refreshes itself after a test-case create or edit, a roster
  write, a source-call add and `/run`. After `/simulate`, a delete or a
  persona update, say: "Saved through the API. The page shows it after a
  refresh."

## Rules and limits

| Rule | Limit or default | What the user sees |
|---|---|---|
| Conversations per `/simulate` | Default 5; values above 50 are cut to 50 | none |
| Conversations per test (plan) | 10 by default | 429 "Maximum simulations per test exceeded." |
| Conversation starts per minute (plan) | 10 per org by default, counting every conversation | 429 "Rate limit exceeded. Try again shortly." |
| Test cases per agent (plan) | 25 by default | 429 "Scenario limit reached." |
| `max_turns` | Default 20, capped at 50 | silently capped |
| One conversation | 10 minutes | run ends `ERROR` |
| Judges on a case | At least one for `/simulate` | 400 "This scenario has no eval agents attached." |
| Case names | Unique per agent | 409 |
| Source calls | 1 to 50 production calls of this org per request | 400 |
| Persona update from source calls | Calls must have finished at least ten minutes ago | 409 |
| Pathway-only assertions | `NODE_REACHED`, `NODES_VISITED`, `TRAVERSAL_MATCH`, `VARIABLE_EXTRACTED`, `WEBHOOK_TRIGGERED` refused on persona cases | 400 |
| Billing | Each conversation that completes is billable usage | charged whether it passes or fails |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| Every conversation `ERROR` at once | No saved version, or the dev head does not compile | `error_message` on the run | Save a valid version, then rerun. |
| A lane never reached | Persona cannot complete it, or a lookup misses on `request_data` | Trace in `metadata.turn_details[].logs[]` | Give the persona the facts; supply the fixture the case's own lane needs. |
| Simulation hits `max_turns` | Persona and agent loop on one step | Same step id on many turns | Tighten the persona; check the step's exit condition. |
| Change "not picked up" | Builder edits not saved, or the user expected a pinned version | `metadata.agent_version_id` vs the version on screen | Save, or use a check run for a pinned candidate. |
| Behaves differently in production | Simulations use dev values; production uses its own | Compare environment variables | Test with a check run in that environment. |
| `summary.passed` true, assertion false | Summary counts clean scoring, not verdicts | `assertions[].passed` | Report the assertion. |
| `eval_run_id` null for minutes | Conversations still generating | `summary.status` RUNNING, conversation runs still `RUNNING` | Keep polling the same set; do not start another. |
| 429 on `/simulate` | Per-test or per-minute plan limit | The 429 message | Lower `simulations_count`; wait a minute. |
| Real records created during a test | Write-side tools or webhooks ran | `tool_call` entries in the trace | Use a miss-on-lookup fixture; coordinate write lanes with the customer. |

## Questions people ask

**Which version did my simulation test?** The newest saved version, with dev
variable values. The run's `metadata.agent_version_id` names it.

**Can I simulate the production version?** Not with `/simulate`. A
promotion check run pins a candidate version and that environment's values.

**Does a simulation place a phone call or play audio?** No. It is text from
first turn to last. Prove audio with a browser voice test or a real call
([voice](voice.md)).

**Who speaks first?** The agent, as on a phone call. The simulated caller's
first message answers the greeting.

**Does the simulated caller know my agent's script?** No. It knows only its
persona prompt and what the agent has said.

**Why did one conversation pass and another fail on the same case?** Both
sides are model-driven, so wording and routing vary. That is why a case
runs several conversations and a judge passes on a majority.

**Do webhooks fire during tests?** Yes, in simulations, test chat and the
messaging preview. Classify every integration before the first run.

**Does deleting a test case keep its history?** No. Its conversations and
transcripts are deleted with it. Confirm first.
