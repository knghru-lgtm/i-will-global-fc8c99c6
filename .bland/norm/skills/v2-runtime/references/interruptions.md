# Interruptions: audio is not routing

Use “interruption” with a qualifier. Stopping audible speech, changing scenario,
and selecting a global node are different mechanisms with different evidence.
For where each fits in a whole call, read [how it works](how-it-works.md).

| Mechanism | What changes | Inspect | Does not imply |
|---|---|---|---|
| Audio barge-in | Whether/how caller speech cuts off agent playback | Calls → Conversation feel, effective call settings, audio/playback evidence | A different node or scenario was selected |
| Scenario/topic change | Which conversation flow handles the caller's next intent | Entry criteria, explicit and generated routes, flow boundary, current variables and selected route | Agent audio was immediately cut off |
| Global-node interruption | A router-selected global step handles an intent, with its configured continuation | `settings.global`, loop conditions, return mode and trace | Every utterance or every moment can skip every gate |

## Audio settings: use the current scope

In the current v2 builder, audio controls are call-level settings under Calls →
Conversation feel. Snapshot fields include `settings.blockInterruptions`,
`settings.interruptibility`, `settings.interruptionSensitivity`,
`settings.agentBackchannelLevel`, `settings.agentBackchannelConfig`, and
`settings.backgroundNoise`. Inspect current schema/defaults and the actual
resolved call settings before changing an unfamiliar value.

- Blocking interruptions is a distinct setting, not a routing hold.
- Interruptibility levels configure how readily callers can cut in; they are
  not durations in milliseconds. A threshold is not a measured latency either.
- Backchannels are short acknowledgments, not necessarily full agent turns or
  transitions. Test them separately from barge-in and end-of-turn detection.
- Per-step turn-taking (`settings.advanced.interruptibility`,
  `blockInterruptions`, `interruptionThreshold`) compiles only on a step, and
  only when that step sets `advanced.turnTakingOverride: true` (the step
  Settings tab writes it with Interruptibility and Interruption threshold) or
  the agent sets `settings.nodeTurnTaking: true` (pathway imports). Then the
  step overrides the call baseline while it is the active step: a level of 0
  means blocked, 1 to 4 a level. Leaving the step returns to the baseline;
  the next step does not inherit it. Blocking follows the step whose audio is
  playing. Without either marker the values stay in the JSON, inert, because
  older builders wrote them on every step.
- The per-step backchannel pair (`agentBackchannelLevel`,
  `agentBackchannelConfig`) compiles only behind `advanced.backchannelOverride`,
  which only imports set. Per-step `backgroundTrack` is not emitted. Editing an
  inert field changes the JSON without changing the call.
- On an older deployment, verify the actual supported scope. Do not invent an
  override based solely on a field's presence in historical JSON.

To prove a cutoff, use actual playback instrumentation or aligned recorded audio,
not a transcript or an empty SDK queue. For runner timing, adaptive callers,
latency accounting, and recovery cases read [voice evidence](../../v2-testing/references/voice.md).

## Scenario/topic changes

The caller's new intent is a routing question. Inspect the current component,
its exit/continuation, and the destination's entry criteria. The current mapping
can route directly between eligible root siblings; do not require a hub hop
or add one merely to match an older mental model. See
[builder/runtime mapping](builder-runtime-map.md).

Within a rigid nested flow, ordinary steps follow that flow's routing. A broad
entry description does not prove every inner step has a cross-scenario escape.
A self-loop, `loopWhile`, deterministic route, global route, and a component
exit have different roles. Inspect the decision trace instead of guessing that
a caller topic change must immediately leave the current step.

## Global-node routing and return

Step-level globals exist. Their label/description supplies router eligibility;
the builder can show a Global badge without drawing incoming lines everywhere.

| `settings.global.returnMode` | Continuation |
|---|---|
| `previous` | Automatic return behavior to the interrupted node |
| `redirect` with `forwardingNode` | Redirect to the configured target; that target supplies the response |
| `manual` | Auto-return disabled; authored onward routes stay relevant, with optional labelled return |

On executable steps, `settings.advanced.conditionOverridesGlobalPathway` lets
an unmet loop/goal hold prevent the usual global-node diversion. It is not the
audio “block interruptions” switch. Without that hold, a selected global can
interrupt an unfinished step when the runtime's other eligibility conditions
permit. After-run actions and verification gates can also affect the result;
do not present one simplified priority list as every execution branch.

The current compiler retains step-level flow controls such as `skipUserResponse`
and this loop/global option, but ignores those old advanced flow controls on
hub/scenario cards. Stored JSON presence does not prove activation at that scope.

## Diagnostic examples

### Repetition after barge-in is not a diagnosis

A cut-in soon after the agent started speaking is answered again with the
caller's combined input: either on the current node, or one node back when the
agent had just moved. Recovery never steps back into a tool, code, router,
transfer, or other action step, so their side effects do not repeat. A cut-in
after the agent has been talking a while is an ordinary new turn from the
current node. Short acknowledgments ("mm-hm") do not stop playback at all.
None of these outcomes alone proves a broken route, missed transcription, or
noise-cancellation problem. Do not promise a universal rewind rule.

Before changing settings, align the caller audio and agent playback with the
accepted caller text, interruption/recovery events (when exposed), current and
previous nodes, chosen next node, variables, and tool results. Distinguish:

- Playback stopped, accepted text is correct, response regenerated on the same
  node: inspect recovery and loop/verification state before changing audio.
- Caller speech is audible but absent from accepted text: investigate the input
  path; this still does not identify which setting caused the loss.
- Correct caller text but unexpected next node: inspect routing evidence and
  gates, not just audio sensitivity.

If recovery details are unavailable, state that limit. A controlled comparison
on the same version and fixture can test a hypothesis; do not diagnose noise
cancellation from repetition or transcript evidence alone.

### Other symptoms

- **“It stopped talking but stayed on the same question.”** Check audio cutoff
  separately from node/variable progress. Barge-in can work without a route change.
- **“Help has no incoming arrow but it answered.”** Inspect global matching and
  return mode before adding ordinary edges.
- **“I changed a node's interruption threshold and nothing happened.”** Verify
  whether it is a retired per-node field; edit the active call-level control.
- **“I asked for another department but it stayed.”** Check loop state, actual
  available routes, entry criteria, and verification requirements—not audio
  sensitivity. A text test can investigate routing; voice evidence proves sound.
