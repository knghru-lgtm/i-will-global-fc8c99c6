# Builder JSON, visible canvas, and executable pathway

**The canvas is a view of the design, not a complete execution graph.** Read the
snapshot and the actual call trace before “repairing” a visual disconnection.
This reference describes the current v2 mapping; an older deployment may differ.
Verify the target environment/version rather than inferring deployment from this
plugin's version. See [interruptions](interruptions.md) for routing versus audio.

Contents: three views; mapping table; implicit root routes; worked example;
editing and UI reveal; verification limits.

## Three views of one resource

| View | What it represents | What it cannot establish alone |
|---|---|---|
| Snapshot JSON | Saved design: nested flows, authored edges, entries, tool routes, settings | Every stored field is active; some older fields are retained but ignored |
| Builder | Root orchestrator/resource overview, nested flow canvas, selected inspector | All runtime routes or the version a historical call used |
| Executable pathway / call trace | Flattened components, generated connections, selected nodes and actions | The user's current unsaved draft or which inspector is open |

The root overview and the nested flow canvas are different surfaces. Context or
entry-label connections can be presentation aids, not authored execution edges:
the return loops from a Pathway's End pills back to the agent card picture the
generated Default return and are not editable edges. The whole-call picture is
in [how it works](how-it-works.md#what-the-canvas-shows-versus-what-runs).
Hidden inspector fields can configure real routing without producing arrows.

## Mapping table

| JSON element | Builder meaning | Runtime meaning / diagnostic consequence |
|---|---|---|
| `behavior.nodes` hub (`agent`) | Orchestrator instructions | A conversational hub; not the entire graph |
| `inbound` edge target | Call entry connection | Selects initial hub/scenario entry; a generated startup node may appear in traces |
| `complex-scenario.data.flow` | Scenario card opened into a nested canvas | A component wrapper around executable inner steps |
| Inner `start` pill and its outgoing edge | The flow's entry connector | The edge's target is the entry step. The pill itself is omitted from executable steps. Array order/position does not choose entry |
| Inner `end` pill | Exit from this flow | Component exit, not necessarily phone hang-up. Continuation depends on the outer graph |
| Inner executable step | Node inside the opened flow | Retains its identity with component ownership; a trace can mention both wrapper and inner node |
| Root child's `data.entry` | Scenario/terminal entry criteria | Supplies eligible generated entry routes; see rules below |
| `rules[].targetNodeId` / `fallbackNodeId` | Route-step inspector | Deterministic destinations; don't count only `edges[]` |
| Step `responsePathways[].targetNodeId` | Webhook/tool response-routing inspector | Destination selected from response conditions, stored separately from drawn edges |
| Attached `tools[].responsePathways[].targetId` | Attached-tool inspector | Another response-routing shape; its field names differ from standalone steps |
| `settings.global` | Global settings / Global badge on a step | Router-wide eligibility plus previous/redirect/manual continuation, not an inbound arrow from every node |
| Guardrail action / configured verification | Separate guardrail or verification settings | Can end, transfer, or redirect execution without an ordinary local edge |

For exact response-pathway field spellings read the
[snapshot dictionary](../../v2-snapshot/references/knobs.md). Do not copy a
standalone step's row shape into an attached tool.

## Why root cards can execute without a drawn connection

The current root mapping has two distinct sets:

- **Auto-entered children:** root scenario, complex-scenario, and end-call
  children with no incoming nonstructural authored routing edge, excluding
  Start's item and the hub's "Starts in" pathway (`entryScenarioId`). The hub
  gets an entry route using the child's `data.entry`. An inbound/start
  connector is structural, not an ordinary route.
- **Returning children:** root scenario and complex-scenario children get a
  default fallback route to the hub, including when explicit outgoing routes
  exist. Root end-call nodes do not get that automatic return.

Returning children also get routes directly to eligible auto-entered siblings,
using the destination's entry criteria; Start's item and the "Starts in"
pathway get none, so no scenario cuts into a guaranteed start. A Pathway's
generated routes leave from its End pill, not its inner steps. Self-routes and
already-existing source/target pairs are not duplicated. Therefore **a scenario transition need
not take an extra hub turn**; the trace determines what happened.

Adding an incoming authored routing edge changes whether a target is
auto-entered. “I'll draw a missing arrow” can therefore change the available
routes rather than merely document them. Do not add one for cosmetic reasons.
These rules concern root children/component boundaries—not a guarantee that
every inner step can jump arbitrarily into every other scenario.

## A worked visual-disconnection example

The user says: “Returns has no line from the hub, so connect it.”

1. Read the intended saved version or unsaved draft and locate Returns by ID.
2. Check that it is an eligible root child, not the selected call entry, and
   whether any nonstructural authored edge already targets it.
3. Read its `entry` criteria. If it is auto-entered, the missing drawn line does
   not prove a missing runtime route. Explain the existing route instead.
4. Open its flow: verify a Start edge targets a real executable step. A card
   can be reachable while its inner entry is broken—different fixes.
5. Reproduce the requested intent on the same version, then inspect the selected
   route and node. Only edit JSON if that evidence identifies a real defect.

Likewise, a global Help step without ordinary incoming edges can be intentional;
an isolated cycle of ordinary steps can still be unreachable despite every node
having an incoming edge. Incoming-edge counts are not a reachability proof.

## Editing and revealing the right UI

- Record agent/version or draft revision, container path, node ID, tool/edge ID
  when applicable, and the changed field. Labels are not unique identifiers.
- Resolve array positions from stable IDs in the fresh snapshot before editing.
  Preserve unrelated fields and do not write generated runtime nodes back into
  the authoring JSON as though they were user-authored steps.
- If the changed field is a tool response route, reveal that tool's inspector;
  if it is a step prompt, open that scenario and select that step; if it is an
  audio setting, reveal Calls → Conversation feel, not an old node setting.
- Use the host's supported UI effect/navigation mechanism when available. The
  plugin teaches the correspondence; it does not implement automatic animations.
- Read back accepted state, refresh page context, and report whether visibility
  was verified. See [workspace state](../../api-workspace/references/workspace.md).

## Verification boundary

Use a current platform validator, compiled representation when exposed, and
call/test traces together. The bundled migration audit's incoming-target check
is not a complete graph traversal and does not model every global/guardrail
route. A pass is not proof of reachability; a finding requires checking the
actual route mechanism. Do not work around a failed check or add a harmful edge just
to quiet it—report unsupported validation and obtain the missing evidence.
