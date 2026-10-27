# The `where` predicate grammar

`predicate.where` on `POST /v2/analytics/cohorts` is a tree of nodes. The
offline checker `scripts/validate-predicate.cjs` applies every rule on this
page. The API stays the authority when its allowlist moves ahead of the
packaged copy.

## Nodes

A node is exactly one of four shapes:

```text
{ "and": [ node, ... ] }      a non-empty array; every child must hold
{ "or":  [ node, ... ] }      a non-empty array; at least one child must hold
{ "not": node }               the child must not hold
{ "col": "...", "op": "...", "value": ... }    a leaf
```

- A group node has exactly one key: `and`, `or` or `not`.
- A leaf has only the keys `col`, `op` and `value`. Any other key is refused.
- `col` is `"<column>"` or `"<table>.<column>"`. A bare `<column>` reads
  `calls`. `a.b.c` and an empty part are refused.
- The virtual columns `outcome`, `connected` and `early_exit` are written
  bare. They are computed per call ([semantics](semantics.md#virtual-columns)).
- The tables and columns a leaf may name are in [tables](tables.md).

## Ops by type class

The ops are `=`, `!=`, `in`, `not_in`, `<`, `<=`, `>`, `>=`, `is_null`,
`is_not_null` and `contains`. The column's type decides which apply.

| Type class | Ops | Value |
| -- | -- | -- |
| string | all eleven | a string |
| number (`tinyint`, `smallint`, `int`, `integer`, `bigint`, `float`, `double`, `decimal`) | all except `contains` | a finite number |
| boolean | `=`, `!=`, `is_null`, `is_not_null` | a boolean |
| timestamp, timestamp_ntz | `=`, `!=`, `<`, `<=`, `>`, `>=`, `is_null`, `is_not_null` | an ISO-8601 instant |
| date | the same as timestamp | a `YYYY-MM-DD` day that exists on the calendar |
| complex (arrays, maps, structs) | `is_null`, `is_not_null` | none |
| virtual `outcome` | `=`, `!=`, `in`, `not_in` | one of the nine outcomes |
| virtual `connected`, `early_exit` | `=`, `!=` | a boolean |

## Value rules

- `is_null` and `is_not_null` take no `value`. Sending one is refused.
- `in` and `not_in` take a non-empty array of the column's value type, at
  most 200 entries.
- `contains` takes a non-empty string. It is case-sensitive.
- A timestamp value carries a `Z` or a numeric offset and at most three
  fractional digits.
- A date value is a real day: `2026-02-30` is refused.
- `call_length` is in minutes. Five minutes is `5`; 30 seconds is `0.5`.
- The nine outcomes: `contained`, `escalated_cold`, `escalated_warm`,
  `ai_abandoned`, `abandoned`, `agent_ended`, `voicemail`, `not_connected`,
  `errored`.

## Limits

| Limit | Value |
| -- | -- |
| Depth (a lone leaf is depth 1) | 8 |
| Leaves | 64 |
| Entries in one `in` or `not_in` list | 200 |

## Refusals

A `where` refusal answers 400 `COHORT_PREDICATE_INVALID`. The message reads
`<node>: <message>`, where `<node>` is the path below `where`, for example
`and[1].col: unknown column: calls.foo`. The offline checker names the same
node with a `where.` prefix (`where.and[1].col`) and lists every refusal, not
only the first.

| Message | Fix |
| -- | -- |
| `must be an object` | The node is a string, number, array or null. Write it as one of the four shapes. |
| `must be a non-empty array` | An `and` or `or` has no children or is not an array. Add the children or drop the group. |
| `nesting exceeds the maximum depth of 8` | Flatten. Nested `and` inside `and` (or `or` inside `or`) can merge into one level. |
| `more than 64 leaves` | Too many leaves. Replace a run of `=` leaves on one column with one `in`, or narrow the ask. |
| `unknown key; a node is { and } \| { or } \| { not } \| { col, op, value? }` | A leaf carries a key other than `col`, `op`, `value`, or a group node has two keys. Remove the key or split the node. |
| `must be a column name` | `col` is missing, empty or not a string. |
| `<col> must be <column> or <table>.<column>` | `col` has three parts or an empty part. Use `table.column`. |
| `unknown or unallowlisted table: <table>` | The table cannot be named. Pick a table from [tables](tables.md); tables without a call id are never allowed. |
| `table not available (not yet in the lake in any region): <table>` | `call_outcomes` and `disposition_value_facts` are refused today. Use the `outcome` virtual column or the `disposition` key instead. |
| `unknown column: <table>.<column>` | The column does not exist on that table. Check the spelling and the table in [tables](tables.md). |
| `denied column (may not be used in a predicate): <table>.<column>` | The column holds content or personal data. It cannot be filtered. Say so and hand off ([examples](examples.md)). |
| `must be one of =, !=, in, …` | Unknown `op`. Use one of the eleven ops. |
| `"<op>" does not apply to <col> (<kind>)` | The op does not fit the column's type class, such as `contains` on a number or `<` on a boolean. Pick an op from the table above. |
| `must be absent for is_null` (or `is_not_null`) | Remove `value`. |
| `<op> takes a non-empty array of <hint>` | `in` or `not_in` needs an array with at least one entry. |
| `<op> takes at most 200 values` | Split the list: an `or` of `in` leaves, or an `and` of `not_in` leaves. |
| `every element must be <hint>` | An array entry has the wrong type, such as a string in a number list or an unknown outcome. |
| `must be <hint>` | The value has the wrong type for the column. `<hint>` names what it needs. |
| `timestamp needs an explicit zone` | Add `Z` or an offset to the instant. |
| `timestamp precision beyond milliseconds is not supported` | Cut the fraction to three digits. |
| `contains takes a non-empty string` | Give `contains` a non-empty string. |

The loop: read the message, fix exactly the named node, run the checker, and
resend the same request. Do not rewrite nodes the API accepted.

Other 400s on the same route use `COHORT_INVALID_REQUEST` and come from the
rest of the body (window, the simple keys, an unknown key). They are listed in
the [contract](contract.md#errors).
