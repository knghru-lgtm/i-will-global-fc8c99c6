# What a predicate means

Read this before you tell the user what a cohort selected. The words you use
must match what the build does. For how a call reaches a cohort at all, and how
fresh the data is, see [how it works](how-it-works.md).

## Leaves on calls

A leaf on `calls` (a bare column, or `calls.<column>`) filters the call row
itself. `{ "col": "call_length", "op": ">=", "value": 5 }` keeps calls of five
minutes or longer.

## Leaves on joined tables

A leaf on any other table is its own existence test, correlated to the call by
call id:

```text
{ "col": "pathway_events.node_id", "op": "=", "value": "<node>" }
  means: some pathway_events row for this call has node_id = <node>
```

Three consequences:

- **Each joined leaf is a separate test.** `{ "and": [ t.a = 1, t.b = 2 ] }`
  means "some row of `t` has `a = 1` and some row of `t` has `b = 2`". The two
  rows can differ. There is no way to require one row to satisfy both.
- **`not` over a joined leaf is "no such row".** `{ "not": t.a = 1 }` means
  the call has no row of `t` with `a = 1`. A call with no rows of `t` at all
  matches.
- **`!=` on a joined leaf is not the same as `not`.** `t.a != 1` means "some
  row of `t` has an `a` other than 1". A call with rows `a = 1` and `a = 2`
  matches `!=` and fails `not`.

Explain these in plain words when the user's ask depends on them. "Calls that
visited node X and then ended" cannot be read as "the same event did both".

## Scope

- Every cohort is limited to the caller's organisation. `calls` is scoped by
  its organisation column. A joined table with its own organisation column is
  scoped by it too; one without is scoped through the already-scoped call.
- `agent_key` narrows to one agent. Without it, the cohort spans the
  organisation.
- Joined tables are read only inside the window, on their own date column.
  A timestamp date column is read a little past the window end, so rows
  written shortly after a call still count.
- `disposition_runs` leaves see only runs whose reference is a call.

## Virtual columns

Written bare. They come from the same taxonomy the Analytics tiles use.

| Column | Meaning |
| -- | -- |
| `outcome` | the call's single outcome, from the list below |
| `connected` | the call completed, was not answered by voicemail, and did not error in queueing |
| `early_exit` | a connected call shorter than 10 seconds |

`early_exit` is a flag, not an outcome. A contained call and an abandoned call
can both be early exits.

### Outcomes

Each call has exactly one. The first rule that fits wins, in this order:

| Outcome | In business words |
| -- | -- |
| `escalated_warm` | transferred to a person with a warm hand-off |
| `escalated_cold` | transferred to a person or number without a warm hand-off (a transfer to hold music does not count) |
| `voicemail` | reached voicemail |
| `errored` | failed while queueing or starting |
| `not_connected` | never connected |
| `contained` | the agent finished the call itself or met its objective |
| `ai_abandoned` | the caller hung up in the first 15 seconds |
| `abandoned` | the caller hung up later, before the agent finished |
| `agent_ended` | anything else, for example the agent side ended the call without finishing |

"Escalated" in a user's words usually means both `escalated_cold` and
`escalated_warm`. "Abandoned" usually means both `ai_abandoned` and
`abandoned`. Say which you used.

## Units and matching

- `call_length` is in minutes. "Longer than 90 seconds" is `> 1.5`.
- `contains` is a case-sensitive substring match. `"Refund"` does not match
  `"refund"`. When case is uncertain, use an `or` of the spellings you expect,
  and say so.
- Timestamps compare as instants. Send them with `Z` or an offset.
- `is_null` matches a missing value. On a joined table it needs a row to exist
  whose column is null; it does not match a call with no rows.

## Cost class

A predicate is **heavy** when any leaf reads a heavy table, and **light**
otherwise. A leaf whose column does not resolve counts as heavy. The offline
checker prints `cost_class`.

| Light | Heavy |
| -- | -- |
| `calls`, `logs`, `call_citations`, `call_metadata` | `call_webhook_logs`, `context_data`, `disposition_runs`, `pathway_events`, `call_utterances` |

Heavy builds read more data and take longer, often minutes. To keep a
predicate light or cheap:

- Prefer a `calls` column or a virtual column when it says the same thing.
  `outcome` answers "was it transferred" without reading any event table.
- Use one heavy table, two at most. Each heavy leaf adds a scan; several heavy
  tables in one predicate are slow.
- Narrow the window first. A 7-day heavy cohort is far cheaper than a 92-day
  one.

Tell the user when a cohort is heavy and that it will take longer.
