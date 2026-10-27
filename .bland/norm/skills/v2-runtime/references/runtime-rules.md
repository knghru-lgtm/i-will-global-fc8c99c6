# Runtime rules: routing, scenarios, variables, guardrails

The observable rules behind every v2 call, in the order they usually decide a
symptom. Start from the [runtime skill](../SKILL.md) for which version and
which runtime answered, and [how it works](how-it-works.md) for the whole call.

## Contents

- [The routing decision stack](#the-routing-decision-stack)
- [Hub and scenario semantics](#hub-and-scenario-semantics)
- [Variables](#variables)
- [Guardrails at runtime](#guardrails-at-runtime)
- [Behavioral deltas to plan for (v2 model limits)](#behavioral-deltas-to-plan-for-v2-model-limits)

## The routing decision stack

For ordinary step routing, inspect these mechanisms before blaming model choice.
This is not an exhaustive universal priority order: global-node selection,
verification gates, after-run actions, and component routing also affect the
result. Use the actual decision trace and the interruption reference.

1. **Tool loop condition (waiting).** A step tool can carry a loop condition on its response. While it is unmet, the step holds ordinary onward routing and the model keeps conversing on the same step. This is not a blanket prohibition on global diversion or other exceptional routing; check their separate eligibility gates. "Waiting" is not a route the model picks; it is the gate not having released.
2. **Tool response pathways (deterministic).** When an attached tool fires and has `responsePathways`, conditional rows are checked top to bottom against the tool's output (`trigger variable / operator / value`); the first matching condition FORCES the next step. **`Default/Webhook Completion` is a deferred fallback, regardless of its array position**: it is used only when no conditional row matches. If multiple default rows exist, the first supplies the fallback. A default row before `success == true` does not steal a successful response; do not reorder it to fix that imagined bug. Ordinary broad conditions are still first-match, not deferred defaults. No model judgment.
3. **Deterministic edges and route steps.** Edge `conditions` rows and `route` step rules evaluate mechanically against call variables, after the turn's extraction, in authored order; the first match wins. When no conditioned edge matches, the step's unconditioned edges stay available to the model. An unmet loop condition still holds the step even when a conditioned edge matched. A route step with no matching rule falls to `fallbackNodeId`; with no fallback either, the call hard-fails for that caller.
4. **Model choice (last).** Only when nothing above decided does the model pick among the step's outgoing edges, using edge labels + descriptions, the step prompt, the system prompt, and conversation history. A self-loop edge is the model-chosen form of waiting. An `alwaysPick: true` edge is forced and removes every other option on that step, global steps included.

In the builder UI, layer 2 is configured inside the step's tool inspector panel ("Response pathways: conditions are checked top to bottom"), not ordinary canvas arrows. The canvas shows authored ordinary edges; route-step rules and fallback destinations also live in inspectors, and generated routes need not appear. Do not diagnose routing from the canvas alone.

## Hub and scenario semantics

- The **hub** (`agent` node) is conversational and uses its available routes,
  including eligible generated entry routes, not every stored entry from every
  location. If logic must run before the hub speaks, choose an intentional
  bootstrap entry rather than relying on a “stay silent” instruction.
- A complex scenario runs its nested flow; Start's outgoing edge selects entry,
  and End marks a component exit rather than a phone hang-up. Outer continuation
  can use explicit routes, generated sibling-entry routes, or fallback to the hub.
  Generated sibling routes leave a Pathway from its End pill, not from its
  inner steps; mid-flow, only the flow's own edges and global steps move the call.
  **A mandatory extra hub hop is not the current compilation rule.**
- Scenario **exits carry intent**: preserve one exit edge per distinct outcome
  and inspect its relationship to the outer continuation and destination entry.
- A caller topic change, global-node selection, and audible interruption are
  separate events. A root sibling route does not prove arbitrary inner-step
  jumps. Inspect loop state, available routes, and the chosen-node trace.

## Variables

- **Extraction rows** on prompt steps extract from conversation each turn; extracted values persist as call variables.
- **`{{placeholder}}` resolution**: strings resolve against call variables (plus `{{secret.id.<id>}}` and `{{SECRET.name}}` from the org's secret store). **An unresolvable placeholder stays in the string as the literal text `{{name}}`**; it does not become empty. Consequences: never let a prompt or a code input depend on a variable that may not exist yet, and never treat "the string is non-empty" as "the variable was set". Web-chat sessions do not resolve built-in clock variables like `{{now_utc}}`; supply a real value in request data when testing time-dependent logic (expected format example: "Monday, September 14, 2026 3:00 PM").
- **request data** (per-call key/values) merge into call variables at call start; this is the call-time contract a caller/integration must supply.
- **`{{env.KEY}}` is a different namespace with opposite failure semantics**: environment variables (per agent per environment) substitute into the snapshot at call PREPARATION, before the call exists. A referenced key with no value in the resolving environment fails the call loudly (`AGENT_VARIABLE_UNRESOLVED`), it never passes through as a literal. Plain `{{key}}` and `{{env.KEY}}` cannot collide, and request data cannot shadow an env variable. Which environment's values resolve is decided by the version SELECTOR, not the version: semver/`branch:`/`dev` selectors always resolve dev values, even for the production-pinned version (full model: the `v2-lifecycle` skill).

## Guardrails at runtime

`settings.guardrails` resolve straight off the snapshot on every call. Timed TCPA rails (`endSeconds` 1–600) fire their actions if the disclosure hasn't happened within the window from call start; `custom` rails are model-judged checks that watch the conversation as it happens, beside routing rather than inside it, so they can fire mid-turn (max 5 per agent). Actions: end_call / transfer / move_to_node. When a call ends or transfers "for no visible reason", check the rails before the routing stack.

## Behavioral deltas to plan for (v2 model limits)

Document these per agent instead of discovering them in production:

- **A flow exit is not a hang-up**: an `end-call` step inside a flow hangs up
  after its line; a wrap-up prompt step followed by the End pill does not, and
  hands the turn back to the hub. Verify that continuation reaches an actual
  termination action.
  A root end-call can be a generated sibling destination. Do not require a hub
  visit or promise a fixed extra caller-turn count from the canvas alone.
- **Fire-from-anywhere defaults don't exist at the hub**; it routes between turns only. HOWEVER, step-level globals DO exist: `settings.global.isGlobal` compiles a step into a runtime global node with auto-return (`returnMode: previous`), redirect, or manual modes (see the knob dictionary). Migrations have preferred systemPrompt folds for carried v1 globals; a deliberate new design may use step globals directly.
- **Cross-flow routing needs an explicit mapping check**: a nested step's exit
  and the root continuation are different scopes. Root sibling routes can be
  generated without a hub detour, but that does not make an arbitrary jump into
  another flow equivalent to the source graph. Preserve criteria and verify the
  executed route; do not insert a hub hop or broaden entry rules to match a diagram.
- **Code runs in two places**: an attached `custom-code` / `run_snippet` tool
  fires mid-turn when the model calls it; a `customCode` step fires on
  traversal, and a snippet failure there falls to the next `route` step's
  fallback. See [code steps and snippets](tools-and-handoffs.md#code-steps-and-snippets).
