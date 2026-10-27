<!-- Example markers, read by tests/analytics-cohorts.test.cjs. Every json
fence holding a "where" or "predicate" key must validate clean and light. An
HTML comment "expect: heavy" on the line before a fence: clean and heavy.
"expect: refused MESSAGE": refused with exactly that one message. The next json
fence is its fix, either the whole corrected request or only the replacement
node; it must validate clean and change nothing but the node named. -->

# Worked prompts

Synthetic setting: an inbound support agent with a booking node, a transfer
desk and a post-call webhook. Today is 2026-10-08 and the page shows the last
30 days. Ids in angle brackets are placeholders. Real agent ids come from the
page context; real node ids come from a read, never from a guess.

Each turn follows the same calls: one offline validate, one POST, polls until
`ready` or `failed`, and a report. These turns run in a connected dashboard
session, so the Conversations page opens the list by itself. Standalone, give
`/dashboard/conversations?cohort=<id>` instead and say nothing was opened.

## "Show me the contained calls that ran five minutes or longer"

Both conditions sit on `calls`, so the predicate is light.

```json
{
  "agent_key": "<agent id>",
  "window": { "start": "2026-09-08T00:00:00Z", "end": "2026-10-08T00:00:00Z" },
  "predicate": {
    "where": {
      "and": [
        { "col": "outcome", "op": "=", "value": "contained" },
        { "col": "call_length", "op": ">=", "value": 5 }
      ]
    }
  }
}
```

Report: "1,284 contained calls of 5 minutes or more in the last 30 days, all
visible in the list, not truncated. The Conversations page is opening them
now." (Synthetic numbers; quote the real `size` and `visible_size`.)

`"predicate": { "outcomes": ["contained"], "where": { "col": "call_length", "op": ">=", "value": 5 } }`
selects the same calls.

## "Which calls reached the booking step?" and "which calls fired a webhook?"

A visit to a node is a `pathway_events` row with that `node_id`. Read the node
id first (the Sankey definition read lists every node with its id). This
predicate is **heavy**: say it will take longer.

<!-- expect: heavy -->
```json
{
  "agent_key": "<agent id>",
  "window": { "start": "2026-09-08T00:00:00Z", "end": "2026-10-08T00:00:00Z" },
  "predicate": {
    "where": { "col": "pathway_events.node_id", "op": "=", "value": "<booking node id>" }
  }
}
```

For webhooks, `call_webhook_logs` records that a webhook was logged for the
call. Its `url` and `payload` are denied, so a cohort can say "a webhook was
logged" but not which one. Also heavy.

<!-- expect: heavy -->
```json
{
  "agent_key": "<agent id>",
  "window": { "start": "2026-10-01T00:00:00Z", "end": "2026-10-08T00:00:00Z" },
  "predicate": {
    "where": { "col": "call_webhook_logs.call_id", "op": "is_not_null" }
  }
}
```

Tell the user which of the two you built and that a specific webhook URL
cannot be filtered. A 7-day window keeps the heavy build short.

## "Calls that escalated in the last 7 days for this agent"

"Escalated" covers both transfer outcomes. Light.

```json
{
  "agent_key": "<agent id>",
  "window": { "start": "2026-10-01T00:00:00Z", "end": "2026-10-08T00:00:00Z" },
  "predicate": { "outcomes": ["escalated_cold", "escalated_warm"] }
}
```

When the user clicked from the Escalation tile and wants the calls behind it,
send `"predicate": { "metric": "escalation" }` instead, so the list matches
the tile exactly. Say that the window is the 7 UTC days before today.

## "Calls where the caller asked for a human"

Not expressible from columns. What the caller said lives in transcripts, which
are denied columns, and no column records "asked for a human". An escalation
outcome is not the same thing: the agent can transfer for other reasons, and a
caller can ask and not be transferred.

Answer in this order:

1. Say the rule: a cohort filters columns; it cannot read what was said.
2. Offer what is close and say how it differs: the escalated calls above.
3. Offer the surface that can: a disposition that classifies each call with a
   boolean value such as `asked_for_human`
   ([dispositions](../../evaluations/references/dispositions.md)).
4. Once that disposition has scored calls, the cohort is:

```json
{
  "agent_key": "<agent id>",
  "window": { "start": "2026-09-08T00:00:00Z", "end": "2026-10-08T00:00:00Z" },
  "predicate": { "disposition": { "key": "asked_for_human", "op": "=", "value": true } }
}
```

Do not build a `contains` leaf on some other column as a stand-in.

## "Inbound calls that were transferred or dropped early, not web calls"

`or` holds the two alternatives, `not` removes web calls. All on `calls`, so
light.

```json
{
  "agent_key": "<agent id>",
  "window": { "start": "2026-09-08T00:00:00Z", "end": "2026-10-08T00:00:00Z" },
  "predicate": {
    "where": {
      "and": [
        { "col": "inbound", "op": "=", "value": true },
        {
          "or": [
            { "col": "outcome", "op": "in", "value": ["escalated_cold", "escalated_warm"] },
            { "col": "early_exit", "op": "=", "value": true }
          ]
        },
        { "not": { "col": "is_web", "op": "=", "value": true } }
      ]
    }
  }
}
```

In words: "inbound, not web, and either transferred or a connected call under
10 seconds". `not` on a `calls` column negates the leaf on the call row. Over a
joined table, `not` would mean "no such row"
([semantics](semantics.md#leaves-on-joined-tables)).

## A refusal and the fix

The user asks for "calls longer than 3 minutes that were abandoned". A first
draft names a column that does not exist.

Refused request:

<!-- expect: refused unknown column: calls.duration -->
```json
{
  "agent_key": "<agent id>",
  "window": { "start": "2026-09-08T00:00:00Z", "end": "2026-10-08T00:00:00Z" },
  "predicate": {
    "where": {
      "and": [
        { "col": "outcome", "op": "in", "value": ["abandoned", "ai_abandoned"] },
        { "col": "duration", "op": ">", "value": 3 }
      ]
    }
  }
}
```

The offline checker reports `where.and[1].col: unknown column: calls.duration`.
Had it reached the API, the answer is 400 `COHORT_PREDICATE_INVALID` with the
message `and[1].col: unknown column: calls.duration`.

Fix exactly that node. The length column is `call_length`, in minutes. Keep
`agent_key` and the window, so the scope stays the page's agent.

Corrected request:

```json
{
  "agent_key": "<agent id>",
  "window": { "start": "2026-09-08T00:00:00Z", "end": "2026-10-08T00:00:00Z" },
  "predicate": {
    "where": {
      "and": [
        { "col": "outcome", "op": "in", "value": ["abandoned", "ai_abandoned"] },
        { "col": "call_length", "op": ">", "value": 3 }
      ]
    }
  }
}
```

Validate again, then POST. Only `and[1]` changed; `and[0]` is as it was. If the next answer names
another node, fix that one the same way.

## Anti-patterns these examples guard against

- Scripting `fetch` or searching the docs for the cohort routes.
- Telling the user to reload the page or paste an id.
- Guessing a node id or a column name instead of reading it.
- Approximating "what the caller said" with a lookalike column filter.
- Reading `visible_size: null` as zero, or ignoring `truncated: true`.
- Rewriting the whole predicate after a refusal instead of the named node.
