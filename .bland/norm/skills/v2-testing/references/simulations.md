# Platform simulations: contract, suite design, grading

A simulated caller talks to the real agent and judges assert outcomes. The
agent runs with its real integrations, so classify every integration first
([safety before any test](../SKILL.md#safety-before-any-test)). Persistent
judges and `/simulate` scoring live in the
[evaluations skill](../../evaluations/SKILL.md). Which version runs, who
speaks first and what the caller can see are in
[how agent testing works](how-it-works.md#how-a-simulation-exercises-the-agent).

## Contents

- [Create, run and read](#create-run-and-read)
- [Suite design](#suite-design)
- [Grading discipline](#grading-discipline)

## Create, run and read

Create; `POST /v1/agent-testing/scenarios`:

```json
{ "agent_id": "…", "name": "MIG-FINAL: sales - new home quote",
  "tester_persona_prompt": "You are calling …. Your name is Jordan Testwell … (you are NOT a real customer; the system will not find you, and that's expected).",
  "max_turns": 12,
  "request_data": { "from": "+15555550100" },
  "assertions": [ { "type": "LLM_JUDGE", "name": "routed to sales", "is_required": true,
                    "config": { "prompt": "Did the agent …?", "output_type": "boolean", "pass_on_true": true } } ] }
```

- `assertions[].type` is an ENUM; `LLM_JUDGE`, `NODE_REACHED`, `WEBHOOK_TRIGGERED`, … Uppercase; lowercase is a server validation error.
- `request_data` supplies the call-time contract (e.g. `from` in E.164 for phone-keyed lookups; a real `now_utc` string when clock logic matters).
- Run: `POST /v1/agent-testing/scenarios/:id/run` (async; poll). Read: `GET /v1/agent-testing/runs/:id`; transcript in `chat_history`, judge verdict + reasoning in `assertion_results[]` (populates after completion). Do not treat `nodes_visited` as a route trace.
- **The engine trace lives in the same run detail**: `metadata.turn_details[].logs[]`; per-turn entries typed `decision` (Current Node Name/ID, Chosen Pathway, Assistant Response), `tool_call` / `Tool Result: <name>` (arguments and full results, including a tool's own debug/HTTP evidence when the snippet emits it), `variables` (Request Data / Current Variables), and `loop`. `metadata.node_id_to_name` maps ids to step names. This is the surface every "grade on traces" instruction means; pull it before diagnosing anything.

## Suite design

- ~1 scenario per terminal/lane of the agent: each transfer destination, each deflection, each close, plus conduct probes (AI disclosure, human-request).
- Personas must be COMPLETABLE: give them every fact the flow can demand (account numbers, confirmations), and make probe timing explicit ("ask on your FIRST turn"); a persona that can't finish wedges the flow exactly as a real broken caller would, and that's a harness artifact, not an agent bug.
- Judges grade outcomes and conduct. Test termination timing separately; do not assume a fixed extra turn from the authoring graph.
- Assertions encode the SOURCE system's actual behavior, not idealized behavior.

## Grading discipline

1. Never conclude from judge prose alone; pull the run's engine decisions (per-turn node/route decisions in the run detail / call log) and check the call was where you think it was.
2. Classify each failure: harness artifact (fix persona/request_data/assertion) · judge flake (rerun; 3 reps; read reasoning) · routing flake (harden the specific entry/edge description) · real bug (fix the snapshot).
3. The bar: the FULL suite green in one sweep on ONE version head; not a patchwork of passes across different heads.
4. A lane that a gate keeps you out of (CRM-found, verified-identity) is NOT covered by sims that ran around it. List uncovered lanes explicitly in the report.
5. **v1 differential baselines settle disputes**: clone a failing scenario onto the v1 pathway (same persona/judges/request data), rep both 3×. v1-solid = real v2 regression; v1-failing-identically = inherited variance; judges must encode v1's real bar, and "run-to-run oscillation" on a fixed head is expected with LLM judges + live APIs (the record is one green sweep + classified flappers, not every rep green).
6. **Drain write-side artifacts after every sweep** with the customer's own cleanup scenarios, verified at tool level; record anything undrainable precisely (a booking can land on a generic vehicle/contact row that cancel lookups cannot find).
