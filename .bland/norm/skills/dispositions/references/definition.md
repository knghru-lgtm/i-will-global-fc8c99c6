# Designing a disposition definition

A definition is the document a draft holds and a published version freezes.
It says which values to produce after a call, how each is produced, and the
shape delivered. Concepts: [how dispositions work](how-it-works.md). Routes:
[API reference](api.md).

## Contents

- [The document](#the-document)
- [Values and their schemas](#values-and-their-schemas)
- [Sources](#sources)
- [Which schema each source can produce](#which-schema-each-source-can-produce)
- [The transformation](#the-transformation)
- [A worked example](#a-worked-example)
- [Validation messages](#validation-messages)

## The document

```text
{
  name            1 to 120 characters
  description     up to 2000 characters
  timing          "immediate" | "within_24h"
  values          up to 50 values (at least 1 to publish)
  transformation  { version: 1, root: <node> }
  postCallWebhook { mode: "hold" | "emit_followup", maxHoldSeconds?: integer 1 to 1800 }
}
```

The disposition itself has a `key` (`^[a-z][a-z0-9_]*$`, up to 64), set at
create and unique on the agent. A deleted disposition keeps its key
reserved. A published definition must be at most 256 KiB.

## Values and their schemas

```text
{ id: <uuid you generate>, key, label, schema, source }
```

- `id` never changes. Results, corrections and the transformation refer to
  it. Generate a fresh UUID for each new value.
- `key` (`^[a-z][a-z0-9_]*$`, up to 64, unique in the definition) is the
  field name in `values[]` of the delivered entry. It may be renamed.
- `label` (1 to 120) is the name people see.

| `schema.kind` | Extra fields | Notes |
|---|---|---|
| `boolean` | `description?` | |
| `string` | `format?: "date-time"`, `description?` | |
| `number` | `description?` | |
| `enum` | `options: [{key, label}]` | 1 to 24 options, unique keys up to 64 |
| `array` | `items`, `minItems?`, `maxItems?` | up to 1000 items |
| `object` | `properties`, `required` | up to 64 properties; `required` names declared properties |

A schema may nest 8 levels and 200 nodes. `description` (up to 2000) is
read by the model as the instruction for that field.

## Sources

Four kinds. Pick by what the value needs.

| Kind | Use when | Pins | Body |
|---|---|---|---|
| `variable_extraction` | The agent already defines this variable; re-extract it from the corrected post-call transcript | the agent's variable config at publish | `variableKey`, `execution?: {reasoningEffort}` |
| `structured_extraction` | A new field or category from the conversation | an extractor version | `extractorId`, `extractorVersionId`, `execution: {reasoningEffort, inputSourceIds}` |
| `judge` | A pass/fail or graded verdict the org already scores with an evaluation judge | a judge version | `judgeId`, `judgeVersionId`, `execution: {reasoningEffort, inputSourceIds}` |
| `custom_code` | Combine other values, map codes, or apply a rule | a snippet version | `snippetId`, `snippetVersion`, `timeoutSeconds` (1 to 60), `connections`, `secrets`, `dependencyValueIds` |

- `reasoningEffort`: `auto`, `low`, `medium`, `high`.
- `inputSourceIds` (1 to 8, from `transcript`, `audio_recording`,
  `call_metadata`, `pathway_logs`, `tool_logs`, `variables`, `agent_config`,
  `call_config`) choose what the model reads. Use `transcript` unless the
  value needs more.
- **Variable extraction.** Read `GET /variable-catalog` and copy the entry's
  `outputSchema` into the value's `schema` exactly. Only string, number and
  boolean variables from the agent's latest saved main version are listed.
  A variable defined twice with different prompts is left out.
- **Structured extraction.** Read `GET /extractor-catalog` for published
  extractors (organization-wide or scoped to this agent). The value's
  `schema` must equal the extractor's `outputSchema`. To make a new one, see
  [extractors](api.md#extractors).
- **Judge.** Read `GET /judge-catalog` (this agent's judges with a
  published version) and pin the listed `judgeVersionId`. An audio judge
  needs `audio_recording` in `inputSourceIds`. Two values that pin the same
  judge must use identical execution settings.
- **Custom code.** A JavaScript snippet version owned by the organization.
  It runs once, after every other value, and receives
  `{input, values}`: `input` is the call's post-call payload, and `values`
  holds only the values listed in `dependencyValueIds` (up to 20, never
  another custom-code value), keyed by their `key`, each as
  `{state, value?, evidence?}`. Its return value must match the value's
  schema. `connections` and `secrets` map an alias
  (`^[A-Za-z_][A-Za-z0-9_]{0,63}$`) to a `resourceId` or `secretId`, up to
  20 each. Save the code with `save_code_snippet`.

## Which schema each source can produce

| Source | Allowed schema |
|---|---|
| Variable extraction | Exactly the catalog's `outputSchema` (boolean, number or string) |
| Structured extraction | Exactly the extractor version's `outputSchema` |
| Pass/fail judge | `boolean`, or an `enum` whose two keys are `pass` and `fail` |
| Graded judge | An `enum` whose keys are exactly the judge's level keys; `boolean` only when the judge has target levels |
| Custom code | Any schema; output that does not match is an error |

## The transformation

The transformation shapes `payload`, the one object the integration reads.
Nodes:

```text
{ "kind": "value",   "valueId": "<value id>" }      the value, or null when not produced
{ "kind": "literal", "value": <any JSON> }
{ "kind": "object",  "fields": { "<name>": <node>, … } }
{ "kind": "array",   "items": [ <node>, … ] }        up to 50 items
```

Up to 2000 nodes. Every `valueId` must exist in `values`. A value that ended
`no_value` or `error` becomes `null` in `payload`; the per-value `values[]`
list next to it carries the real state.

When an op adds, removes or renames a value, send the new transformation
in the same op, so the draft never points at a missing value.

## A worked example

Synthetic. One enum outcome from a new extractor, one boolean from a
pass/fail judge, one variable rerun. All ids are placeholders.

```json
{
  "key": "call_outcome",
  "definition": {
    "name": "Call outcome",
    "description": "Outcome, compliance and the caller's account number after each call.",
    "timing": "immediate",
    "values": [
      {
        "id": "11111111-1111-4111-8111-111111111111",
        "key": "outcome",
        "label": "Outcome",
        "schema": {
          "kind": "enum",
          "options": [
            {"key": "booked", "label": "Booked"},
            {"key": "callback", "label": "Callback requested"},
            {"key": "not_interested", "label": "Not interested"}
          ]
        },
        "source": {
          "kind": "structured_extraction",
          "extractorId": "22222222-2222-4222-8222-222222222222",
          "extractorVersionId": "33333333-3333-4333-8333-333333333333",
          "execution": {"reasoningEffort": "auto", "inputSourceIds": ["transcript"]}
        }
      },
      {
        "id": "44444444-4444-4444-8444-444444444444",
        "key": "disclosure_given",
        "label": "Disclosure given",
        "schema": {"kind": "boolean"},
        "source": {
          "kind": "judge",
          "judgeId": "55555555-5555-4555-8555-555555555555",
          "judgeVersionId": "66666666-6666-4666-8666-666666666666",
          "execution": {"reasoningEffort": "auto", "inputSourceIds": ["transcript"]}
        }
      },
      {
        "id": "77777777-7777-4777-8777-777777777777",
        "key": "account_number",
        "label": "Account number",
        "schema": {"kind": "string", "description": "<copied from the variable catalog>"},
        "source": {"kind": "variable_extraction", "variableKey": "account_number"}
      }
    ],
    "transformation": {
      "version": 1,
      "root": {
        "kind": "object",
        "fields": {
          "outcome": {"kind": "value", "valueId": "11111111-1111-4111-8111-111111111111"},
          "compliant": {"kind": "value", "valueId": "44444444-4444-4444-8444-444444444444"},
          "account": {"kind": "value", "valueId": "77777777-7777-4777-8777-777777777777"},
          "schema_version": {"kind": "literal", "value": 1}
        }
      }
    },
    "postCallWebhook": {"mode": "emit_followup"}
  }
}
```

## Validation messages

Draft saves and creates check structure and pins; publish adds the budgets
(50 values, 256 KiB, hold limit) and requires archived pins. A rejected body
answers 400 "Definition failed validation" with
`problems: [{valueId, message}]`. Common messages:

| Message | Fix |
|---|---|
| `Duplicate value key "<key>"` | Rename one value |
| `Transformation references unknown value id <id>` | Send the transformation with the op that removed the value |
| `Variable "<key>" is not available in the agent's current variable configuration. Re-select the variable.` | The variable is gone from the latest saved version, or is a json variable |
| `Variable "<key>" changed in the agent's current variable configuration. Re-select it…` | Copy the catalog `outputSchema` again |
| `Disposition value schema must exactly match the pinned extractor output schema` | Copy the extractor version's `outputSchema` |
| `Structured extraction requires a pinned extractor version` | Set `extractorVersionId` |
| `Extractor pins must reference an archived (published) version…` / `Judge pins must reference an archived (published) version…` | Publish the extractor or judge, then pin that version |
| `A pass/fail judge maps to a boolean (or a fixed pass\|fail enum)` | Change the schema |
| `A graded judge's enum must match the pinned version's level keys exactly` | Copy the judge's level keys |
| `Audio judges require audio_recording (Call audio) as an input source` | Add `audio_recording` |
| `Custom Code inputs may reference only variable_extraction, structured_extraction, or judge values` | Drop the custom-code dependency |
| `Hold-until-ready delivery requires immediate timing — a webhook cannot be held for 24 hours` | Use `emit_followup` or `immediate` |
| `maxHoldSeconds is <n>; the limit is 1800` | Lower it |
| `Publish requires at least one value` | Add a value |
