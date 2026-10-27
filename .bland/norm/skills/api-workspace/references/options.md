# Options: locate the field before changing behavior

The [snapshot field dictionary](../../v2-snapshot/references/knobs.md) is the
local field-by-field source; use the official schema for newly introduced
options. Do not recreate a v1 field on a v2 object because its name sounds right.

| Concern | Inspect | Common interaction to verify |
|---|---|---|
| Voice / language / personality | Agent `settings`, global prompt, current step prompt | A text simulation cannot prove audio delivery |
| Waiting versus immediate continuation | `settings.advanced.skipUserResponse` | Top-level spellings are not equivalent; automatic steps need an exit |
| Audio interruption | Calls → Conversation feel; agent call-level settings | Old per-step audio fields may be retained but inactive; do not confuse audio blocking with a routing hold |
| Backchannels | Level plus gated configuration | Disabled/off settings are meaningful; do not treat zero as missing |
| Background sound | Active call-level background setting | Old per-step background fields are not active overrides in the current v2 compiler |
| Privacy / recording | Agent and step privacy settings plus call recording availability | No recording means audio assertions may be untestable |
| Variables / tools | Extraction declarations, declared code inputs, tool pins, response mapping | Final variables do not show when they changed |
| Routing | Edge order, route conditions, fallback, loop condition | Ordered first-match behavior is not an unordered set |
| Global step interrupts | Global mode and return destination | Previous / redirect / manual return behave differently |
| Guardrails | Trigger window, prompt/condition, configured action | An automatic end/transfer can be a rail, not routing failure |
| Memory / knowledge | Enabled state, schema, attached knowledge IDs | Missing evidence is not permission to invent a lookup result |
| Environment values | Selector and per-environment key/value bindings | Testing dev does not validate production values |

## Safe option-edit procedure

1. Fetch the current complete object and identify the setting's scope.
2. Read the exact field, allowed values, documented default, and override rules.
3. Distinguish absent, null, false, zero, and empty string. Do not normalize them
   with truthiness checks; some are explicit off/inherit sentinels.
4. Change only the selected setting; retain adjacent supported fields.
5. Validate and read back the accepted value.
6. Test the behavior affected by the setting on the correct channel/version.

If a default or unit is not documented, say so and read the schema/docs rather
than asserting milliseconds, percentage, or a particular inheritance order.
Do not reveal or select internal model/provider identifiers to explain a knob.
