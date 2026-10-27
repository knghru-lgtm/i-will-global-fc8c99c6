# How a v2 conversation runs, from connect to hang-up

The life of one call or chat: which version answers, what happens before the
first word, how each turn picks the active step, how global steps return, what
an interruption does, which settings apply where, and what the builder canvas
shows versus what runs. Field spellings live in the
[snapshot field guide](../../v2-snapshot/references/knobs.md); this page is
the behavior.

## What it is

A v2 agent is one saved version: a hub (the agent card), the scenarios it
routes to, the steps inside each pathway, and call-level settings. When a call
or chat starts, the platform picks one version, turns it into a runnable
conversation graph, and walks that graph one turn at a time.

It is not a free-form chatbot that rereads the whole design every turn, and it
is not the picture on the canvas. The canvas draws what you author. The call
runs the graph that design produces, which also holds routes nobody drew:
entry routes from the hub, direct routes between scenarios, returns to the
hub, and global steps reachable from almost anywhere.

## Objects and how they relate

```text
 agent ─── versions (immutable saved snapshots)
   │          dev head = newest save; staging and production = pins
   │                     │
   │                     ▼  one version, chosen at connect
   │        ┌──────────── runnable graph ─────────────┐
   │        │ Start ─► [Initialization] [Start item]  │
   │        │      ─► entry pathway, or the hub       │
   │        │ hub (agent card) ◄──────────┐ Default   │
   │        │   │ entry routes            │ returns   │
   │        │   ├─► Prompt scenario ──────┤           │
   │        │   ├─► Pathway ─► steps ─► End pill      │
   │        │   ├─► End conversation (hangs up)       │
   │        │   └─► auth zone ─► gated scenarios      │
   │        │ global steps: reachable from most steps │
   │        └─────────────────────────────────────────┘
   └─ call-level settings (voice, language, Conversation feel,
      voicemail, guardrails, system prompt) ─► the whole call
```

| Object | Lives at | What it decides |
|---|---|---|
| Hub (agent card) | Root | The opening conversation and which scenario to enter |
| Prompt scenario | Root | One prompt, held by its loop condition, then routed |
| Pathway (complex scenario) | Root | A nested flow of steps, entered at its Start edge |
| Step | Inside a Pathway or auth zone | One unit of work: speak, ask, call a tool, route, transfer |
| Global step | A step with "Make this a global node" on | An intent that can cut in from almost anywhere |
| Auth zone | Root | Verification before its gated scenarios |
| Call-level settings | Agent | How the whole call sounds and behaves |
| Environment pin | Agent (not versioned) | Which version production and staging run |

The system prompt and agent-scope knowledge apply on every step. A step's own
prompt, tools, loop condition and extraction rows apply only while that step
is active.

## Lifecycle and states

One call, as the caller experiences it:

```text
 connect ─► version chosen ─► opening ──────────► turns ──────────► ended
            (frozen for the   Initialization,     each turn:        end step, goodbye,
             whole call)      Start item,         pick step,        guardrail, silence,
                              entry pathway or    speak, listen     max duration, transfer,
                              hub speaks first                      caller hangs up
```

One step, while the call sits on it:

```text
            ┌──── loop condition unmet: stay and talk again
            ▼        │
 entered ─► active ─► routed ─► next step
            │   └── global step chosen ─► global replies ─► go back,
            │                                               redirect or manual
            └─► no caller turn (code, route, webhook, silent text):
                runs and moves on inside the same turn
```

A call never rereads the agent after it starts. Only routing moves it, and an
ended call stays ended.

## How it reaches a live call or conversation

### Which version answers

The version is chosen once, at connect, and frozen. A save or promote made
during a call does not change that call.

| Channel | Version that runs |
|---|---|
| Inbound call on a bound number | The production pin; the staging pin when the number is attached to staging. A running experiment can send the call to its variant |
| Outbound call (`POST /v1/calls` with `agent_id`) | The production pin or an experiment variant. Any `agent_version` selector, even `production`, runs exactly what it names and skips experiments |
| Builder test chat, web voice test | The dev head, or the version picked in the test panel |
| Deployed browser voice (widget voice, share link) | The production pin |
| Published web chat widget | The production version, refreshed on each promote or rollback |
| API chat (`POST /v1/chat`) | The production version (the latest save if never promoted) |
| Texts on a bound number | The production copy attached to the number; see the messaging note below |

Experiments assign each call at random by traffic share, unless a staged
rollout keeps each caller on one side. Selectors and experiments: the
[lifecycle skill](../../v2-lifecycle/SKILL.md).

Environment variables (`{{env.KEY}}`) resolve at connect too. Production and
staging labels, and no selector, use that environment's values; a semver,
branch or `dev` selector uses dev values even for a pinned version. A missing
key fails an outbound or test call before it starts
(`AGENT_VARIABLE_UNRESOLVED`). An inbound call is still answered, but from the
copy last attached to the number, which can differ from the production pin.
"The fix didn't take" on inbound is often this. Plain `{{name}}` placeholders
resolve each time a string is used and stay as literal text when unset; see
[variables](runtime-rules.md#variables).

New calls normally pick up a promote at once; a call that connects in the
moments right after can still get the previous version. Scheduled outbound
calls may keep the version they were created with.

Call-level settings become the call's defaults:

- **Outbound.** A value the request sends wins. `request_data` and `metadata`
  replace the agent's values whole; they are not merged, and `{}` clears them.
- **Inbound.** The agent's settings win over the number's own, except
  language: a language chosen on the number wins.
- **Voice rotation.** With two or more usable voices in the pool, each call
  picks one at random. A `voice` on the request skips the pool.

Texts and API chat can run differently: by default a texting turn is answered
from a brief of the whole agent instead of step by step, unless the agent
uses steps that need the step-by-step run. See
[messaging runtime](../SKILL.md#messaging-runtime).

### Before the first word

```text
 connect
   ├─ Initialization?       the saved snippet runs once, before anyone speaks;
   │                        its returned keys are live, and a matching route
   │                        opens the hub or a chosen root scenario directly
   ├─ Start item?           a Prompt scenario or Pathway in Start runs next,
   │                        then hands on
   ├─ "Starts in" pathway?  the call opens inside it; the hub's routing turn
   │                        is skipped
   └─ otherwise the hub     the agent card speaks first
```

- The agent speaks first. On outbound calls with "wait for greeting" on, the
  first sentence waits until the callee speaks.
- Initialization runs before the opening line, so the greeting can use its
  results. Without a saved snippet it does not run.
- The Start item and the "Starts in" pathway are guaranteed starts: the hub
  never auto-enters them, and no generated sibling route cuts into them.
- An auth zone in Start always resumes at the hub after verification, so the
  save refuses it together with a "Starts in" pathway.

### Each turn: how the active step is chosen

When the caller finishes speaking, the current step resolves in this order:

1. **Extraction.** The step's extraction rows read the caller's words into
   call variables. Deterministic conditions wait for these, so a condition can
   test what was said in the same turn.
2. **Holds.** An unmet loop condition keeps the call on the step, even when a
   deterministic edge matched. A captured value being read back to the caller
   also holds it (a global step can still take the turn). Steps that never
   wait for the caller (code, route, webhook, silent text) count as finished.
3. **Deterministic edges.** Conditioned edges are checked in authored order;
   the first match wins. A route step works the same way, then its fallback;
   with no match and no fallback the turn fails.
4. **Model choice.** If no condition matched, the model chooses among the
   step's other edges (label and description), the generated routes and the
   eligible global steps, reading the step prompt, the system prompt and the
   conversation. It can also stay. An "always pick" edge removes every other
   option on that step, global steps included.
5. **Global steps.** A chosen global step takes the turn, unless the step's
   loop condition is unmet and "condition overrides global" is on. A step with
   an after-run action (such as a transfer after its line) keeps the turn.
6. **Auth gate.** A destination inside an auth zone the caller has not passed
   sends the call through the zone's verification first, then on to it.
7. **Speak.** The destination generates its reply or recites its static text.
   Attached tools can run during the reply, and a tool's response pathways can
   force the next step; see the
   [routing decision stack](runtime-rules.md#the-routing-decision-stack).

One caller turn can pass through several silent steps (code, route, webhook,
the End pill) before anyone speaks, and one step can hold many turns. Step
changes are not turns.

### Scenarios, pathways and returns

```text
       hub ── entry routes (each scenario's routing condition) ──┐
        ▲                                                         ▼
Default │                                           Prompt scenario
return  │                                            ├─► sibling scenario (direct)
        ├────────────────────────────────────────────┘   or Default back to the hub
        │
        │  Pathway: Start edge ─► step ─► step ─► End pill
        │    inner steps follow only the Pathway's own edges (plus global steps)
        └─── End pill passes straight on: sibling, explicit outer edge, or Default
```

- **Entry routes.** Every root Prompt scenario, Pathway and End conversation
  card with no incoming routing edge gets an entry route from the hub, built
  from its routing condition. Adding an incoming edge removes that generated
  route; the card is then reached only through the edge.
- **Sibling routes.** Prompt scenarios and Pathways also route directly to
  those same auto-entered cards, so a topic change needs no extra hub turn.
  For a Pathway these leave from its End pill, not from its inner steps.
- **Default return.** Every Prompt scenario and Pathway can return to the hub,
  even when it also routes onward. It is the fallback when no other routing
  condition applies.
- **The End pill is not a hang-up.** It passes straight on without waiting
  for the caller.
- **Mid-pathway topic changes.** A caller who changes the subject inside a
  Pathway stays in it until its own edges reach the End pill, unless a global
  step takes the turn. Add an exit edge or a global step for intents that must
  break out.

### Global steps and returns

A step with "Make this a global node" on can be chosen from any step except an
End conversation step. Its label and description are its routing condition;
it needs no drawn edges.

| "When finished" | After the global step replies |
|---|---|
| Go back (default) | The call returns to the step it was on before |
| Redirect | The chosen step answers instead and the call continues from there |
| Manual | The global step's own edges decide, with an optional labelled route back |

"Return to node before global" goes on a step a global leads to: after that
step replies, the call goes back to where it was before the global.

### Interruptions and barge-in

A barge-in (the agent stops talking), a topic change (routing picks another
scenario) and a global step (an intent cuts in, then returns) are different
events. On a voice call:

- Short acknowledgments ("mm-hm", "okay") do not stop the agent.
- A few words or more stop playback, unless interruptions are blocked for the
  call or for the step whose audio is playing.
- A cut-in soon after the agent started speaking is answered again with the
  combined input: on the current step, or one step back. It never steps back
  into a tool, code, webhook, transfer, route or other action step, so those
  do not re-run.
- A cut-in after the agent has been talking a while is an ordinary new turn
  from the current step.

Settings, evidence and diagnosis: [interruptions](interruptions.md).

### Silence and the end of the call

When the caller says nothing, the agent re-prompts on the same step without
routing, unless that step turns this off. After a long run of unanswered
silence (over a minute at default timing) the call ends, except while the
agent is deliberately waiting or on an IVR step.

A call ends when an End conversation card or step says its line; when the
agent decides the conversation is over and says goodbye (an imported step can
withhold this); when a transfer or hand-off completes; when a guardrail fires
an end action (timed disclosure rails check a window from call start, custom
rails watch the conversation as it happens); on sustained silence, max
duration or outbound voicemail handling; or when the caller hangs up.
Recording, extraction, dispositions, evaluations and webhooks finish later;
see [execution order](execution-order.md#after-the-conversation).

## On the dashboard

### What the canvas shows versus what runs

| On the canvas | What actually runs |
|---|---|
| Root view: the agent card with Start, channels, tools, knowledge and one branch per scenario | Generated entry, sibling and Default routes, not drawn route by route |
| Pathway view: the agent card above, Start pill, steps, End pills, return loops | Return loops picture the Default return; they are not edges you edit |
| Route and channel steps: one arrow per rule | The rules and fallback stored on the step |
| Tool response pathways: in the tool inspector only | Forced next steps with no canvas arrow |
| Global step: a yellow card with a Global badge and no incoming lines | Reachable from almost every step |
| Guardrails page | Can move or end the call with no edge anywhere |

The canvas cannot prove reachability. A missing line is not a missing route,
and an added incoming edge can remove a generated one. Details and a worked
example: [builder/runtime mapping](builder-runtime-map.md).

### Where each setting applies

| Setting | Scope | Where |
|---|---|---|
| System prompt, knowledge, memory | Whole call | Agent card |
| Voice, voice rotation, language (first entry only) | Whole call | Agent card, Settings |
| Interruption sensitivity, interruptibility, backchannels, background noise | Whole-call baseline | Channels, Calls, "Conversation feel" |
| Max duration, recording, noise cancellation, keypad, voicemail, keywords | Whole call | Channels, Calls |
| Guardrails | Whole call | Configure, Guardrails |
| Prompt, static text, loop condition, extraction, tools | While the step is active | Step inspector |
| Global, temperature, skip caller turn, silence repeat, condition overrides global | Pathway steps only | Step Settings tab |
| Interruptibility and threshold override | That step, then back to the baseline | Step Settings tab, not "Inherit from agent" |
| Disable recording or logging, exclude response from history | That step or card | Settings tab |

On the agent card and Prompt scenario cards, temperature, skip caller turn,
silence repeat, condition overrides global, tags and turn-taking overrides
have no effect, even if older JSON holds them.

### What refreshes

The builder autosaves to the dev head. Saving never changes live traffic;
production and staging change only on promote or publish. The test panel runs
the dev head by default, so it reflects saved edits, not unsaved ones. An API
save does not rewrite a builder page already open; reload it.

## Rules and limits

| Rule | Observable effect |
|---|---|
| Missing `{{env.KEY}}` | Outbound and test calls fail to start; inbound answers from the number's attached copy |
| Outbound `request_data`, `metadata` | Replace the agent's values whole |
| `languages` | Only the first entry reaches calls |
| Loop condition unmet | The step holds, even against a matched deterministic edge |
| Route step, no match, no fallback | The turn fails for that caller |
| "Always pick" edge | The only option on that step; no global steps there |
| "Starts in" pathway | A root Pathway, not behind an auth zone, not already in Start |
| Global steps | Not offered from End conversation steps |
| Turn-taking override | Only with an explicit step override or an imported agent |
| Snapshot size | Over 2 MiB is refused at save |
| Custom guardrails | At most 5 per agent |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| "My fix didn't take" | Another version ran: production pin, staging number, experiment, selector, or an inbound call that could not prepare its version | Resolved version in the call details or trace; that environment's env values | Promote, fill the env value, or use the intended selector |
| Agent's request data missing on an outbound call | The request's own `request_data` replaced it | The request body | Send the full object, or omit it |
| Agent loops on one question | Loop condition never met, or a read-back holds | Trace shows the same step re-run turn after turn | Reword the loop condition or add an exit |
| Caller changed topic, agent stayed | Inner Pathway steps follow only their own edges | Trace stays inside the Pathway | Add an exit edge or a global step |
| Scenario reached with no line drawn | Generated entry or sibling route | Chosen route in the trace | Nothing; do not add a cosmetic edge |
| Scenario no longer entered from the hub | An incoming edge removed its entry route | Snapshot shows an incoming routing edge | Remove the edge or route to it on purpose |
| Global step never fires on one step | "Always pick" edge, or "condition overrides global" with an unmet loop | That step's edges and Settings tab | Remove the always-pick, or release the loop |
| Call ended "for no reason" | Guardrail, the agent's goodbye, silence, max duration | End reason and guardrail log | Adjust the rail, prompt or limit |
| Pathway finished, agent kept talking | The End pill is not a hang-up | Trace returns to the hub | Route to an End conversation step |
| Step interruption setting does nothing | No override, or set on a card | Step shows "Inherit from agent" | Set it on the step's Settings tab |

## Questions people ask

**Does every scenario change go back through the hub?**
No. Prompt scenarios and Pathway exits route directly to sibling scenarios.
The hub is the fallback when no other routing condition applies.

**Can a caller jump to another scenario from the middle of a Pathway?**
Only through the Pathway's own edges or a global step.

**If I promote during a call, does the call change?**
No. The version is fixed at connect; new calls pick up the new pin.

**Does the test chat run my unsaved edits?**
No. It runs the saved dev head. Let autosave finish first.

**Why does the agent go back to an old question after a global step?**
That is the default "go back" return. Choose Redirect or Manual instead.

**Why does the canvas show no line to a scenario that clearly runs?**
Entry and sibling routes are generated from routing conditions. Read the
trace, not the canvas.

**Where do I change how easily callers interrupt?**
Channels, Calls, "Conversation feel" for the whole call; a step can override
it on its Settings tab while it is active.

**Which model makes the routing decisions?**
That is internal to the platform. You control the routing conditions,
deterministic conditions, loop conditions and global settings.
