---
description: Set up, run, and grade platform simulations (and test-chat probes) against a v2 agent — suite design from the agent's lanes, safety rails for live integrations, engine-trace grading, and the green-sweep bar. Use to verify a v2 agent after any push.
argument-hint: "<agent id, and what to verify>"
allowed-tools:
  - "mcp__plugin_norm_bland__*"
  - "Task"
  - "Read"
  - "Write"
  - "Bash"
---

# /norm:simulate — verification loop

Target:

```text
$ARGUMENTS
```

Load the `v2-testing` skill (API contracts, WS recipe, grading discipline) and `v2-runtime` (to predict correct behavior). Then:

1. **Fixture discovery.** List the org's EXISTING test scenarios and group by target pathway/agent: the request data their own suites use for this system is the valid fixture (tenant keys, test caller numbers with seeded records). Verify it hydrates end-to-end (trace the bootstrap step's own debug/HTTP calls) before trusting any verdict. Never invent tenant keys.

2. **Safety analysis.** Enumerate the agent's integrations from its snapshot; classify read vs write. Writes are OFF LIMITS for routine sims — personas must stop short of completing those branches. Pick a synthetic caller identity that read-lookups will miss. If a lane cannot be tested safely or reachably (data-gated, write-side), record it as UNCOVERED — do not fake coverage.
3. **Suite design.** ~1 scenario per terminal/lane + conduct probes (AI disclosure, human request). Prefix names (e.g. `MIG-FINAL:`) so reruns are idempotent — check existing scenarios before creating. Personas completable; probe timing explicit; assertions encode the source system's actual behavior, worded to ignore hang-up timing. `type: "LLM_JUDGE"` uppercase.
4. **Run** each scenario (`POST /v1/agent-testing/scenarios/:id/run`), poll runs to completion, collect transcript + `assertion_results`.
5. **Grade on traces.** For every failure, pull the engine's per-turn decisions before diagnosing. Classify: harness artifact → fix persona/request_data/assertion; judge flake → 3 reps, read reasoning; repeated failure → run a v1 DIFFERENTIAL (clone the scenario onto the v1 pathway, rep both): v1-solid = real v2 regression (fix via the builder's hardening hooks — promptAppends/variableAppends/silentPills — construct-level when prompt rules fail twice), v1-failing-identically = inherited variance (judge encodes v1's real bar, document the rate). After ANY snapshot change, the bar resets: full suite green in ONE sweep on the new head.
6. **Test-chat probes**, only if the host supplies the supported WebSocket connection described in `v2-testing`. Use the WS recipe (setup frame with request data, text turns, keepalive) to check greeting, lane entry, and disclosure. The packaged HTTP MCP connection alone does not configure that socket. Otherwise use platform simulations and report direct-chat coverage as unavailable, not passed.
7. **Drain write-side artifacts.** Every booking/task a sweep created is real: cancel via the customer's own cleanup scenarios, verify at tool level (success / none-found), and record anything undrainable (exact date/time/persona name) for the customer to purge directly.
8. **Report**: per-scenario verdicts with judge reasoning, the head version everything passed on, uncovered lanes with the reason (data-gated / write-gated), v1-baseline rates for any inherited flappers, and any hardening hooks added during the loop.
