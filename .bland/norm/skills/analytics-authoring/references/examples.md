# Worked prompts

Synthetic agent: an inbound line for a self-storage operator with nodes for
greeting, account lookup, OTP verification, gate access, payments, work orders,
move-out, new rental, transfer desk and wrap-up, plus the matching tools. Ids
below are placeholders; real ids come from the definition read.

## "Simplify the Sankey to 3 waypoints"

Read the definition and the chart. Fold the current groups into three
business stages that keep every member assigned, so `unclassified_share` does
not rise:

```json
{ "definition": { "groups": [
  { "id": "identify", "label": "Identify", "members": ["agent", "<greeting>", "<lookup>", "tool:lookup_account", "<otp>", "tool:send_code"], "stage": 1 },
  { "id": "serve", "label": "Serve", "members": ["<gate>", "tool:open_gate", "<payments>", "tool:text_payment_link", "<work-order>", "<move-out>", "<new-rental>"], "stage": 2 },
  { "id": "close", "label": "Close", "members": ["<transfer-desk>", "tool:transfer_call", "<wrap-up>", "<end-call>"], "stage": 3 }
] }, "expected_fingerprint": "<fingerprint>" }
```

PUT pending, POST publish, re-read, report the three stages with member
counts and the unchanged unclassified share. One read, one PUT, one POST.

## "Make it as detailed as you can"

Detailed means granular, but the cap is 7 groups. Do not try 12 and learn from
a 422; say the cap up front, pack all members into 7 flow-ordered groups, and
offer a `view=full` API read for node-level traffic (the Detailed tab draws
the same groups as Simplified, just unmerged). Report that unclassified
dropped if it did.

## "This is too chronological; gate access, payments and self-service are parallel"

Give the sibling groups the same `stage`. Expected shape, 7 groups max:

```text
1 Who is calling → 2 Authentication → 3 Gate access ‖ 3 Payments ‖ 3 Work orders, move-out, account ‖ 3 New rental → 4 How it ended
```

Then say what the user will see: Detailed shows the four branches apart;
Simplified merges them into one column labelled by the largest branch with +3.

## "Rebuild it as four categories that each split the same calls, and split the end states by reason"

Expected answer, in this order:

1. Fix what a definition can express: parallel branches via shared stages.
2. State what it cannot, with the rule: a member belongs to one group, so four
   independent categorisations of the same calls are not one definition; the
   cap is 7 groups; terminals are the engine's fixed vocabulary, so "transferred
   by design" versus "asked for a person" versus "could not authenticate"
   cannot be split here.
3. Point to the surface that can: dispositions (per-call classification with
   evidence), with the transfer-reason split as the first question to define.
4. Check any numbers the user quoted against the chart or call data in their
   exact window before agreeing or disagreeing; name the window you used.
5. Check that every concept they named exists in the agent (a category with no
   nodes, such as an "auction winner" path that is never visited, cannot be a
   group). Say so instead of inventing a near match.

## "Rename the second stage to Account and billing"

Keep the group `id`, change `label`, keep members and stages, PUT, POST.
Report the superseded id and that the fingerprint is unchanged.

## "Preview it first"

PUT pending, then read `…/pathway?view=simple&layout=stages&window=<n>&definition=<pending id>`
on the page's window and describe the stage table and unclassified share.
Stop there; publish only after the user confirms, in a later turn.

## Anti-patterns these examples guard against

- Scripting `fetch` calls instead of using the API tools.
- Searching documentation for the routes; the contract is in this skill.
- Discovering the 7-group cap or the one-group-per-member rule from a 422.
- Telling the user to reload the page.
- Echoing the user's own counts as if verified.
- Approximating an unexpressible split with a lookalike grouping.
