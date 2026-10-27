---
name: agent-launch
description: Use when someone wants to take a v2 agent from built to live end to end ("launch my agent", "go live", "set it up so it answers calls", "put it in production", "what's left before launch", "onboarding checklist"), including getting a number, teaching it from documents, wiring tools, picking a voice, testing, promoting and turning on chat or texting. Each step hands to its own skill; this skill owns the order and the checklist.
---

# Launch an agent

One ordering rule: a number or channel answers through the **production
pin**, so publish and promote before attaching anything. Each step names the
skill that owns it; read that skill at the step, not all up front. Do not
write fetch scripts and do not search the docs for these routes.

## Page context

1. Call `get_dashboard_page_context` (`mode: "synced"`). Take the agent id
   from `route.params`. With no agent, ask which one or offer to build one
   ([v2-authoring](../v2-authoring/SKILL.md)).
2. No target chip exists for a launch; the route is the context.

## Workflow: the launch checklist

Copy this list into the reply and mark items as you go; skip one only when
the user says so.

```text
Launch: <agent name>
- [ ] 1 Agent saved and compiles
- [ ] 2 Knowledge attached and verified
- [ ] 3 Tools proven
- [ ] 4 Voice and language set
- [ ] 5 Published to staging, simulations green
- [ ] 6 Promoted to production
- [ ] 7 Number attached and answered a real call
- [ ] 8 Chat or texting on (if wanted)
- [ ] 9 Post-call outputs and alerts (if wanted)
```

1. **Saved and compiles.** Read `/v2/agents/<agentId>/versions/latest`.
   Missing or failing: stop and hand to [v2-authoring](../v2-authoring/SKILL.md)
   or [v2-maintenance](../v2-maintenance/SKILL.md).
2. **Knowledge.** Per document or site:
   [knowledge-sources](../knowledge-sources/SKILL.md) "teach the agent"
   (ingest, poll, verify, attach by scope). Save a version.
3. **Tools.** Per integration: [tool-library](../tool-library/SKILL.md)
   "create and prove a tool". Connections first when needed.
4. **Voice and language.** [voices](../v2-lifecycle/references/voices.md):
   resolve the id, refuse a draft, match the service to `languages[0]`.
5. **Staging and simulations.** Publish to staging
   ([v2-lifecycle](../v2-lifecycle/SKILL.md)), then run the suite
   ([v2-testing](../v2-testing/SKILL.md)) with its live-integration rails.
6. **Promote.** Pre-flight production variables and pass the staging checks
   ([agent-environments](../agent-environments/SKILL.md)); then promote.
   Never `force`.
7. **Number.** [phone-numbers](../phone-numbers/SKILL.md): "get a number" if
   needed, "put an agent on a number", then the real test call from another
   account number.
8. **Chat or texting.** [agent-channels](../agent-channels/SKILL.md): widget,
   API chat (reads production, already promoted) or texting on the number.
9. **Post-call and alerts.** Dispositions
   ([evaluations](../evaluations/references/dispositions.md)), webhooks and
   alerts ([automations](../automations/SKILL.md)); create triggers inactive
   and test with the mock step first.

Budget: one read per item to establish state, then only the writes the owning
skill specifies. Re-read state after each promote or attach.

## Workflow: what is left before launch

Read-only. One read per item: latest version, attached knowledge, tools and
their last run, voice, staging and production pins, inbound numbers, widgets
and texting config, dispositions and automations. Report the checklist with
each item done, missing or not wanted, and the first missing item as the
next step.

## Confirm before

Nothing of its own; every write inherits the owning skill's confirm. Promote
and attach are the two the user feels first; name them.

## Refusals and limits

- An owning skill's routes are unreachable over this connection
  (`oauth_path_not_allowed`): mark the item "dashboard" with the path and
  continue.
- Local files and carrier submissions are dashboard-only; mark, do not
  block.
- Never promote to make a later step pass; promote is its own confirmed step.

## Do not

- Attach a number or turn on a channel before production is pinned.
- Run every skill's reads up front; read at the step.
- Mark an item done without the read that proves it.
- Write fetch scripts, search docs for these routes, or guess fields.
