# V2 execution: practical reading order

Read [runtime](../../v2-runtime/SKILL.md) for the detailed contract and
[snapshot](../../v2-snapshot/SKILL.md) for the JSON dialect. This is the debugging
order, not a second competing implementation specification.

1. **Resolve what actually ran.** Identify channel, selected environment/version,
   and request data from the call/test evidence. Current editor content is not
   proof of a historical call's version.
2. **Check entry.** The inbound target determines bootstrap versus hub entry.
   A scenario's start node must lead to its intended first executable step.
3. **Separate prompt and state.** Global instructions, current step instructions,
   request data, extracted variables, and environment values have different
   roles. A missing input cannot be fixed by increasing prompt emphasis.
4. **Check higher-priority routing first.** Within the runtime decision stack,
   loop conditions can hold a tool step; attached tool response pathways can
   force a transition; deterministic edges/rules precede model-selected edges.
   Evaluate ordered rules with the actual variable values at that moment.
5. **Check scenario exit and outer continuation.** A component exit, generated
   sibling route, and hub fallback differ. The current compiler can connect root
   siblings directly; do not assume an extra hub hop. Read the
   [builder/runtime mapping](../../v2-runtime/references/builder-runtime-map.md).
6. **Check side effects and overrides.** A guardrail, transfer, explicit end, or
   automatic step can explain an apparent routing error. Correlate tool results
   and guardrail evidence before rewriting the prompt.
7. **Reproduce the exact disputed behavior.** Hold version, fixtures, channel,
   and settings constant; change one hypothesis at a time.

## Variables are not one interchangeable namespace

- `request_data` supplies initial per-call input. Trace extraction and tool
  output before assuming the final value existed earlier in the conversation.
- Plain `{{key}}` references per-call values; unresolved literals are a clue.
- `{{env.KEY}}` is environment configuration, resolved according to the chosen
  selector; missing values are an error. An explicit version test can use a
  different environment's values than live production.
- `{{SECRET.name}}` is a reference, not permission to fetch or print a secret.
- Code steps consume declared inputs and the configured executable pin. Editing
  display-only code does not prove the executed program changed.

## Evidence to collect

Call/run ID; target agent and version; channel/selector; initial fixture;
current node and chosen edge; variables before the decision; tool arguments,
status and relevant response; next node; observed output. Capture only fields
needed for diagnosis. Redact secrets and minimize personal information. Read
tool logs, knowledge retrievals and the SIP ladder with
[evidence for one call](../../call-analysis/references/retrieval.md#evidence-for-one-call).
