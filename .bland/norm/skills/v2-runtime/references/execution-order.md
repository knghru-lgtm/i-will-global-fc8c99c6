# Execution order: preparation, turns, and completion

The useful model is phases with explicit exceptions—not “every turn always does
A, B, C once.” Use [runtime](../SKILL.md) for routing precedence and
[node types](../../v2-snapshot/references/node-catalog.md) for action semantics.

## Before the first response

1. Resolve the agent, channel, version selector and any eligible experiment.
   Record the resolved version, not just “dev” or what the builder displays.
2. Resolve environment references for that selector and construct the executable
   graph. Missing `{{env.KEY}}` differs from a missing plain call placeholder.
3. Apply the channel's effective configuration and initial request data. Confirm
   external resource references belong to the same organization.
4. Enter the inbound target, including any intended bootstrap flow. A prompt
   asking the hub to be silent is not equivalent to an explicit bootstrap node.

Do not infer a historical call's resolved inputs by recompiling today's head.
The compiled graph endpoint helps map saved node IDs; it does not reproduce
historical environment secrets, third-party responses or all call-time overrides.

## During conversation

| Phase / mechanism | Observable dependency |
|---|---|
| Input accepted | Caller text/audio and interruption/silence classification affect the turn; heard audio and accepted transcript can differ. |
| Extraction and before-dialogue work | Declared extraction and step-specific actions supply variables. A final call variable does not prove it existed before the route decision. |
| Route evaluation | Loop/verification gates, deterministic decisions, tool response routes and eligible model routes participate; some work can overlap. Execution logs, not timestamp sorting alone, establish the accepted decision. |
| Entry actions | A chosen code/webhook/tool/scheduling step can perform work before its dialogue or onward route. Code outputs and mapped responses can change subsequent variables. |
| Response generation | Instructions combine with current step state and supported context. Attached tools can be invoked during generation and feed results back; this is not the same as traversing a tool node. |
| Playback | Generated text is not proof it was heard. Cancellation, interruption and audio buffering affect delivered speech. |
| Exit/after-run actions | When a step completes, its configured action can transfer, schedule, end, repeat or otherwise affect continuation. Do not assume an outgoing arrow means its destination already ran. |

Initial greeting, silence handling, interruption recovery, static text,
dialogue-free routes and guardrail actions can take different paths through
these phases. A single caller turn can traverse multiple automatic steps; a
single node can consume multiple turns. Do not count node changes as turns or
infer a full spoken response from a node-entry event.

## Decision checklist

- Read the current node, available targets, loop/verification state and actual
  variables used. Auth-zone membership and global eligibility can restrict routes.
- For attached-tool response routing, inspect the returned result and first
  matching conditional row. `Default/Webhook Completion` is deferred fallback.
- For a route/channel step, inspect authored rule order and the no-match path.
- Check generated sibling/return routes before adding a hub hop or visible edge.
- Check after-run actions and guardrails before blaming the route prompt.
- For repeated tools, distinguish one logical retry from repeated node execution.
  A node re-run can invoke tools again; a call cap is not idempotency protection.
- For interrupted speech, separate current-node regeneration from a route error;
  see [interruption evidence](interruptions.md).

## After the conversation

Call completion, finalized recording, post-call extraction, evaluation scoring,
disposition output and downstream webhook delivery are separate milestones.
Poll the relevant resource; a completed call or successful simulation generation
does not prove all post-call work succeeded. Changes to a judge or disposition
draft do not rewrite earlier frozen results.

Keep an evidence timeline in workspace files: call/run identity, resolved
version, caller input, node and variables before decision, tool invocation/result,
accepted route, delivered response when measured, and terminal outcome. Missing
events are an evidence gap, not permission to invent an execution sequence.
