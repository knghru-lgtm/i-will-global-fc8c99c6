# Every knob in the snapshot: what it does, what is inert, what is deprecated

Field-by-field reference for authors. Node data shapes are in the
[node catalog](node-catalog.md).

## Contents

- [Status meanings](#status-meanings)
- [Agent-level `settings`](#agent-level-settings)
- [`settings.voiceCall`](#settingsvoicecall)
- [Chat and messaging settings](#chat-and-messaging-settings)
- [Top-level `contact`, `knowledge`, `initialization`](#top-level-contact-knowledge-initialization)
- [`settings.guardrails`: live call rails](#settingsguardrails-live-call-rails)
- [Step `settings.advanced`](#step-settingsadvanced)
- [Step `settings.global`](#step-settingsglobal)
- [Step settings extras](#step-settings-extras)
- [Step-family data flags](#step-family-data-flags)
- [`customCode` steps](#customcode-steps)
- [`route` steps](#route-steps)
- [`transfer`, `webhook` and `tool` steps](#transfer-webhook-and-tool-steps)
- [Attached tools](#attached-tools)
- [Deprecated, inert and nonexistent: the trap list](#deprecated-inert-and-nonexistent-the-trap-list)

## Status meanings

- **ACTIVE**: the compiler or runtime consumes it.
- **CONDITIONAL**: active only under the stated condition.
- **EDITOR-ONLY**: persisted for the builder, never executes.
- **INERT**: kept so old snapshots stay valid; nothing reads it.
- **DROPPED**: silently discarded at compile.
- **NONEXISTENT**: a v1 concept with no v2 spelling.

Voice, language and call-feel settings are not compiled into the graph. They
become call defaults. A value the caller passes on the call wins over them.
Confirm the target deployment's behavior; plugin availability is not
deployment proof. See [interruptions](../../v2-runtime/references/interruptions.md)
and [builder mapping](../../v2-runtime/references/builder-runtime-map.md).

## Agent-level `settings`

| Knob | Status | Behavior |
|---|---|---|
| `systemPrompt` | ACTIVE | The agent's global brain; applied on every step of every scenario. |
| `displayName` | ACTIVE | Agent display name. Renaming the agent through the API is a separate write. |
| `color` | EDITOR-ONLY | One of the builder's ten hue names. Absent = derived from the agent id. |
| `voice` | ACTIVE | Voice id (a UUID from `GET /v1/voices`). `""` = platform default. The validator does not check it. The id must resolve for this org and be a live voice: a deleted, private or draft trained voice saves cleanly, then fails outbound calls and plays the default on inbound. |
| `voicePool` | ACTIVE | Up to 20 voice ids; one is picked at random per call. Rotation needs two or more distinct ids, otherwise `voice` is used. Keep `voice` equal to `voicePool[0]`. Unusable entries are skipped. |
| `languages` | ACTIVE, first entry only | Language codes or modes, for example `["en"]`, `["en-GB"]`, `["babel-es"]`, `["fluent"]`, `["babel"]`, `["auto"]`. Codes come from `GET /v1/languages`. Only `languages[0]` reaches calls. Old friendly ids (`"english"`) are still read; an unknown value sets no language. |
| `interruptionSensitivity` | ACTIVE | Ms before the agent yields (50 to 1000). Absent = the inbound number's own threshold, else the runtime default. |
| `blockInterruptions`, `interruptibility` | ACTIVE | Call-level barge-in. `interruptibility` is 1 to 4, `null` = balanced. Blocked is spelled only as `blockInterruptions: true`. |
| `agentBackchannelLevel`, `agentBackchannelConfig` | ACTIVE | Level 1 to 3, `null` = off. Config `{continuersOnly?, blockedTokens?}` applies only with a level. |
| `backgroundNoise` | ACTIVE | `off`, `office`, `coffee-shop`, `restaurant`. `call-center` is deprecated and plays nothing. |
| `enableMemory` | ACTIVE | Cross-call memory toggle. |
| `memorySchema` | ACTIVE with memory | The entity schema memory extracts into. Absent or `null` = inferred on first use; an array, even empty, is authoritative. |
| `reactions`, `tapbackReactions` | ACTIVE, messaging | Reaction set and on/off for incoming messages. |
| `guardrails` | ACTIVE | Inline rails resolved at call time; see below. |
| `disabledGuardrails` | EDITOR-ONLY | Built-in rails toggled off, kept for re-enable. An id or kind in both arrays is a validation error: move the entry, do not copy it. |
| `nodeTurnTaking` | ACTIVE, import marker | Set by the 1:1 import. Makes every step's turn-taking trio compile. Leave it as found. |
| `importWarnings` | EDITOR-ONLY | `[{code, message, nodeId?, field?}]` the import could not carry. Read it when debugging a migrated agent. |

Whole-snapshot cap: the validator rejects any snapshot over **2 MiB serialized**.
There is no voice or synthesis field below `settings`: no per-step voice, no
per-language voice, no agent-level stability or speed. Those live on the voice.

## `settings.voiceCall`

Each field becomes a call default only when it differs from the builder
default. A default-valued field emits nothing, so the inbound number's own
configuration applies.

| Knob | Status | Behavior |
|---|---|---|
| `enabled` | INERT | Deprecated. Gates nothing: calls are taken and placed either way. |
| `fallbackNumber` | INERT | No server path reads it. The number's own fallback is what dials. |
| `record` | CONDITIONAL | `true` turns recording on even for a number that is off. `false` is "no opinion": it cannot turn off a number that records. |
| `maxDurationMinutes` | ACTIVE | Call length cap. Default 30. |
| `noiseCancellation` | ACTIVE | Default `true`. |
| `ignoreButtonPress` | ACTIVE | Ignore caller keypad presses. Default `false`. |
| `waitForGreeting` | ACTIVE, outbound | Hold the first sentence until the callee speaks. Forced off on inbound. Only `true` is emitted. |
| `voicemailAction` | ACTIVE, outbound | `hangup` (default), `ignore`, `leave_message`, `leave_sms`. Overrides the agent's own reasoning when voicemail is detected. |
| `voicemailMessage` | ACTIVE with `leave_message` | Spoken after the beep. Blank = no voicemail keys at all. |
| `voicemailSms` | ACTIVE with `leave_sms` | Text body sent instead. Blank = no voicemail keys at all. |
| `requestData`, `metadata` | ACTIVE | `{key, value}` rows: facts the agent sees on every call, and passthrough metadata returned in webhooks and call details. An outbound request that sends its own `request_data` or `metadata` replaces these whole (no merge; `{}` clears them). |
| `keywords` | ACTIVE | Transcription hints. At most 20 strings, each at most 100 characters, optional `word:<integer>` boost. |

## Chat and messaging settings

| Knob | Status | Behavior |
|---|---|---|
| `webChat.*` | EDITOR-ONLY | `enabled`, `widgetTitle`, `greetingMessage`, `allowedOrigins` do not configure any widget. The widget record owns title, greeting and domains. `webChat.enabled` only feeds reachability warnings. |
| `apiChat.enabled` | ACTIVE, production | Opening an API chat refuses an agent whose flag is off (403 `CHANNEL_DISABLED`). The gate reads the **production** version, so a dev edit takes effect only after promote. |
| `messaging.mode` | ACTIVE, messaging | `reasoning` (default when absent) answers texting turns from a brief of the whole agent; `pathway` runs the compiled graph node by node. Voice and web chat never read it. |
| `messaging.reasoningEffort` | ACTIVE, messaging | `low`, `medium` (default), `high`. |
| `messaging.progressUpdates` | ACTIVE, messaging | `auto` (default) or `off`. Plain SMS, RCS and WhatsApp never get one on `auto`. |
| `messaging.computerUse` | ACTIVE, messaging | `auto` (default) or `off`. Off while `website` is unset. |
| `messaging.website` | ACTIVE, messaging | The company's https site; web lookups start there. |

## Top-level `contact`, `knowledge`, `initialization`

| Knob | Status | Behavior |
|---|---|---|
| `contact.inboundNumbers` | ACTIVE (required) | Array, or supported whole-string `{{env.KEY}}`. Not inside `settings`. Verify resolved values. |
| `knowledge.kbIds` | ACTIVE | Agent-scope knowledge: lookups the model chooses, named by the source, on API-placed calls and text conversations; inbound phone calls and test chat may not consult them ([how knowledge reaches a call](../../knowledge-sources/references/how-it-works.md)). Distinct from node-scoped `kbIds` on `knowledge` steps. Lift node-scoped KBs here only when they were genuinely call-wide. |
| `initialization.enabled` | ACTIVE | Off = no node, the call starts as if the step were absent. |
| `initialization.step` | ACTIVE | A `customCode` step's data (`name`, `code`, `snippetId`, `snippetVersion`, `variables`, `timeoutMs?`). Runs once on connect, before the first prompt; returned keys are live in the opening line. Without a saved `snippetId` it does not run. |
| `initialization.routes[]` | ACTIVE | `{id, key, valueType, value, targetId}`. When the returned `key` equals `value`, the call opens on `targetId` (the hub or a root scenario, never an auth zone). Comparison is string-based; `valueType` (`string`, `number`, `boolean`) is an authoring aid. No match = the normal entry. |
| `initialization.ringBeforeAnswer`, `ringFailureAction` | CONDITIONAL | Keep inbound calls ringing while the step runs; `ringFailureAction` is `answer` or `reject`. Needs an org capability, the step on, and a saved snippet. |

## `settings.guardrails`: live call rails

Array of guardrail objects, each `{id, kind, actions[]}`. Kinds:

| Kind | Extra fields | Behavior |
|---|---|---|
| `tcpa:ai_disclosure`, `tcpa:recording_disclosure`, `tcpa:self_introduction` | `endSeconds` (REQUIRED, 1 to 600) | Timed rails: the disclosure must happen within the window from call start or the actions fire. One entry per kind. |
| `tcpa:opt_out` | none | Opt-out rail (no window). One entry per kind. |
| `custom` | `name` (non-empty), `description`, `prompt` (non-empty) | A model-judged check that watches the conversation as it happens and can fire at any point in the call. Max **5 per agent**; adding a new custom rail is enterprise-gated at save time (already-saved ones keep running). |

`actions[]` rows: `{type: "end_call"}`, `{type: "transfer", phoneNumber}` or
`{type: "move_to_node", nodeId}`. The validator enforces unique ids, no
duplicate built-in kinds, and `endSeconds` within bounds. A v2 agent does not
use the v1 guard-rails resource; the snapshot rails apply.

## Step `settings.advanced`

All omit-when-default; absence = default.

| Knob | Default | Status | Behavior |
|---|---|---|---|
| `temperature` | 0.2 | ACTIVE | Emitted only when not 0.2. |
| `skipUserResponse` | false | ACTIVE | The step acts without waiting for a caller turn (silent pills, code steps). Must live HERE; a top-level key of the same name is not a v2 spelling. |
| `interruptibility`, `interruptionThreshold`, `blockInterruptions` | `null` / builder value | CONDITIONAL | Compile on steps only when the step has `turnTakingOverride: true` or the agent has `settings.nodeTurnTaking: true`. Otherwise inert: older builders wrote defaults on every step. To tune one step, set the trio and `turnTakingOverride: true`. |
| `turnTakingOverride` | absent | ACTIVE | Marks this step's trio as chosen. |
| `agentBackchannelLevel`, `agentBackchannelConfig` | absent | CONDITIONAL | Compile on a step only with `backchannelOverride: true`, which only an import sets. |
| `backgroundTrack` | builder value | DROPPED | Retired everywhere; use `settings.backgroundNoise`. |
| `disableRecording`, `disableLogging` | false | ACTIVE | Compile into the step's privacy settings. |
| `disableSilenceRepeat` | false | ACTIVE | Suppresses the silence re-prompt at this step. |
| `conditionOverridesGlobalPathway` | false | ACTIVE | This step's loop condition outranks global-node interruption. |
| `excludeResponseFromHistory` | false | ACTIVE | The step's tool or webhook response stays out of the conversation history. |
| `disableEndCallTool` | false | ACTIVE, import only | Withholds the hang-up tool on this step. The builder does not edit it. |

On hub and scenario cards the compiler omits `temperature`,
`skipUserResponse`, `disableSilenceRepeat`, `conditionOverridesGlobalPathway`,
`disableEndCallTool`, the turn-taking trio and `tag`. Privacy and
history-exclusion settings work at both scopes.

## Step `settings.global`

| Knob | Status | Behavior |
|---|---|---|
| `isGlobal` | ACTIVE | Makes the step eligible for global router selection without ordinary inbound edges; loop, verification and other runtime gates can still affect selection. |
| `label` / `description` | ACTIVE (when global) | The fire-condition text. |
| `returnMode: "previous"` | ACTIVE (default) | After the global speaks, return to the interrupted node. |
| `returnMode: "redirect"` + `forwardingNode` | ACTIVE | The redirect target generates the response. |
| `returnMode: "manual"` + `manualReturnLabel?`, `manualReturnDescription?` | ACTIVE | No auto-return; the step's own edges stay live, with an optional labelled route back. |
| `returnToPreviousBeforeGlobal` | ACTIVE | Set on a step a global leads to: after its reply, jump back to where the call was before the global. Independent of `isGlobal`. |

Migrations so far preferred systemPrompt folds or hub scenarios over step
globals for carried v1 globals, but the knob is live and a design may use it.

## Step settings extras

| Knob | Status | Behavior |
|---|---|---|
| `tag` | ACTIVE on steps | `{name, color}` or `null`. Disposition tag on the compiled node. Dropped on cards. |
| `media` | ACTIVE | `[{id, url, name, description}]`; images the agent may attach. Inline image data counts toward the 2 MiB cap. |
| `conditionGuardRails`, `extractVarsGuardRails` | ACTIVE for enabled orgs | `{actions: [...]}`; extra verification of the loop condition or of extraction. Usual action: `{type: "restart_node", config: {fallback, max_restart_iterations}}`. Empty `actions` = off. |
| `dialogueExamples` | ACTIVE | `[{"Conversation History", "Assistant Response"}]`. The keys contain spaces and must be spelled exactly. |
| `conditionExamples` | ACTIVE | `[{"Conversation History", "Condition Achieved"}]`. |
| `pathwayExamples` | ACTIVE | `[{"Conversation History", "Chosen Pathway"}]`. |
| `routeExamples` | ACTIVE | `[{route, userInput}]`. |
| `unitTests` | ACTIVE, import only | Carried verbatim; graded after the turn as telemetry. |

## Step-family data flags

| Knob | Status | Behavior |
|---|---|---|
| `prompt` | ACTIVE | The step's instruction text, or static speech when `useStaticText`. |
| `useStaticText` | ACTIVE | true = `prompt` is spoken verbatim (a `"."` static prompt is the silent pill). |
| `loopWhile` | ACTIVE | The v2 spelling of v1's node `condition`: hold criteria for the step. |
| `loopConditionType`, `toolResponseLoopCondition` | ACTIVE, import | `tool_response` ends the loop on a tool's response pathways. |
| Extraction `variables` rows | ACTIVE | See the [node catalog](node-catalog.md#variable-rows-two-different-contracts). Code inputs use key/value rows instead. |
| `extractionPrompt` | ACTIVE | Custom extraction instructions. Blank = platform default. |
| `ignorePreviousExtractions`, `useAudioExtraction` | ACTIVE | Extraction modifiers. |

## `customCode` steps

| Knob | Status | Behavior |
|---|---|---|
| `snippetId` + `snippetVersion` | ACTIVE | THE executable artifact. Org-scoped: a pin from another org silently no-ops. Unpinned step = inert. |
| `code` | **EDITOR-ONLY** | Display copy; the runtime never executes it. |
| `variables` | ACTIVE, exclusive | The only inputs the snippet receives (unresolved `{{x}}` passes as the literal). Returned object keys merge into call variables. |
| `timeoutMs` | ACTIVE | 1000 to 60000; absent = 10 s. The call continues without the result after it. |

## `route` steps

| Knob | Status | Behavior |
|---|---|---|
| `rules[].conditions[]` `{id, field, operator, value}` | ACTIVE | Conditions within a rule AND; rules are alternatives in order. `operator`: `equals`, `equals exact`, `not equals`, `not equals exact`, `contains`, `does not contain`, `greater than`, `less than`, `is`. `equals` and `contains` ignore case and surrounding spaces; the `exact` forms do not. `is` takes `null`, `not null`, `true`, `false`, `empty`, `not empty`, `undefined`, `defined`. |
| `fallbackNodeId` | ACTIVE | No match and no fallback = hard runtime failure for that caller. Never omit unless the source truly had none. |

Deterministic edges use a different row shape and vocabulary; see the
[snapshot skill](../SKILL.md#conditions).

## `transfer`, `webhook` and `tool` steps

**`transfer`**: `transferNumber` (supports `{{variable}}`), `transferType`
(`phone` or `twilio-app`), `transferExtension`, `warmTransfer`, and the SIP and
application fields in the [node catalog](node-catalog.md#steps-inside-a-flow).
The warm-transfer shape uses `agentPromptStatic`, `mergePromptStatic`,
`timeout`, `dtmfSequence` and optional `retry`, not compiled
`isAgentPromptStatic` or `useCustomHoldMusic` names. Read
[tools and handoffs](../../v2-runtime/references/tools-and-handoffs.md).

**`webhook`**: `url`, `method`, `headers` as `{id, key, value}` rows (v1's
`[key, value]` tuples are not the v2 spelling), `body`, `timeoutSeconds`,
`maxRetries`, `auth {type, token, encode}` (the supported auth mechanism;
custom Authorization headers are the v1 trap), `responsePathways` rows, and
`responseData` rows `{id, name, path, context, sensitive?}` (v1's
`response_data {name, data}` is not the v2 spelling).

**`tool`**: `toolId` (org-scoped), `overrides` rows `{id, key, value}`
(dot-paths into the tool definition, for example `body.agent_email`),
`isStaging`, `responsePathways`. Draft response-pathway rows (missing variable
or target) are silently DROPPED at compile.

Step response pathways (`webhook`, `tool`, `scheduling`) are
`{id, label, variable, operator, value, targetNodeId}` with `operator` one of
`==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`. `label` is unused; leave `""`.

## Attached tools

`data.tools[]` on hubs, scenarios and prompt-family steps. Every field below is
a supported key; keep the ones you find when you edit.

| Field | Behavior |
|---|---|
| `id`, `name`, `description` | Identity; `description` tells the model when to call it. |
| `behavior` | `feed_context` (result goes back to the model) or `feed_context_and_route` (then `responsePathways` route). |
| `toolType` | `custom_tool` (default) or `track` (a chain). Nothing else. |
| `toolId` | Library tool id, or `""` for a tool created inline. |
| `definition` | The embedded tool request (integration, action, body, inputs, response mapping). Its schema is closed: one undeclared key demotes the tool to a plain HTTP call with no URL, and every call fails with HTTP 0. Schema per kind: [tool library](../../v2-runtime/references/tool-library.md). |
| `byReference` | `true` with a `toolId`: compile only the id, so each call runs the library tool's latest version. `definition` then holds only name and description for display. |
| `toolOverrides` | Dot-path body overrides applied to a `byReference` tool. An embedded definition carries its overrides folded into its body. |
| `isStaging` | Run the staging version. |
| `stagingDefinition` | The definition run while `isStaging` is set, on an embedded single tool. A `byReference` tool uses the library row's staging version. |
| `responsePathways` | Skewed rows; see below. |
| `retryLimit` | Retries on failure, 0 to 5. |
| `maxCalls` | Invocations per call; 0 = unlimited, absent = runtime default. Set it on every tool. |
| `excludeResponseFromHistory` | Keep the result out of history; extracted values still flow. |
| `wrapperSpeech` | Filler line while the tool runs, for `byReference` and `track` tools. Wins over the definition's own `speech`. |
| `speechMode`, `speechPrompt` | `static` (default) speaks the line verbatim; `prompt` composes it from `speechPrompt`. |
| `toolAssist` | `{enabled, nudges?: [{delayMs, text?, prompt?}], aside?: {enabled, prompt?}, streamUpdates?: {enabled, maxUpdates?}}`: timed lines, a conversational aside, or progress narration while a slow tool runs. `delayMs` is clamped to 250 to 55000. |
| `steps`, `variableDefinitions` | `track` only; see below. |

**The skew.** Attached-tool `responsePathways` rows are
`{id, label, variable, condition, targetId, targetName}` where `label` = the
trigger (a variable name, `BlandStatusCode`, or `Default/Webhook Completion`),
`variable` = the operator (`==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`,
`!contains`, `is`), `condition` = the compared value. Author in exactly that
skew.

**Chains** (`toolType: "track"`). `definition` is an unused placeholder.

```json
{"steps": [{"type": "custom_tool", "name": "<step name>", "config": {"tool": {"tool": {"name": "<step name>", "description": "<what it does>", "integration": "<integration>", "action": "<action>"}, "tool_id": "<library tool id>"}, "isStaging": false}, "output_schema": ["<output variable>"]}], "variableDefinitions": [{"name": "<input>", "type": "string", "description": "<what the agent fills in>", "required": true}]}
```

Every step embeds its definition under `config.tool.tool`; a step taken from
the library also carries `config.tool.tool_id`. A step without an embedded
definition compiles to an empty placeholder. `output_schema` lists the names of
the definition's `response_data` rows. `variableDefinitions[].type` is
`string`, `number` or `boolean`; `sensitive` is optional. Inputs are
referenced in any step as `{{name}}`.

**Code tool.** A snippet can run mid-turn as an attached `custom_tool` whose
`definition` is `{name, description, integration: "custom-code", action: "run_snippet", body: {snippet_id, snippet_version, variables?}, input_schema?, response_data, timeout?}`.
Outputs become call variables only through `response_data` rows
`{name, data: "$.data.custom_code_result.<key>"}`. A failed run returns its
error as the result and the call carries on, so route on the outputs when a
failure must branch. Use a `customCode` step instead when the code must run at
a fixed point in the flow.

## Deprecated, inert and nonexistent: the trap list

| Knob | Status | Reality |
|---|---|---|
| `toolType: "code"` | NONEXISTENT | Use a `custom_tool` with the `custom-code` / `run_snippet` definition, or a `customCode` step. |
| `customCode.code` | EDITOR-ONLY | Never executes; the pin is the artifact. |
| Top-level `skipUserResponse` on a step | NONEXISTENT | Only `settings.advanced.skipUserResponse` is real. |
| `voiceCall.enabled`, `voiceCall.fallbackNumber` | INERT | Neither gates nor dials anything. |
| `voiceCall.record: false` | NO-OP | Cannot turn off recording on a number that records. |
| `webChat.*` | EDITOR-ONLY | Configure the widget record instead. |
| Per-step turn-taking without `turnTakingOverride` | INERT | Unless the agent has `nodeTurnTaking`. |
| `backgroundTrack` | DROPPED | Use call-level `backgroundNoise`. |
| Draft responsePathway rows (no variable or target) | DROPPED | Silently removed at compile. |
| Attached-tool rp field names read literally | TRAP | The skew (label / variable / condition) is deliberate. |
| Deterministic edge rows with the comparison in `operator` | TRAP | Saves cleanly but runs with OR between rows and shows wrong in the builder. Use `operator: "AND"` or `"OR"` plus `conditionOperator`. |
| `languages: ["english"]` | LEGACY | Still read; write codes (`["en"]`). |
| v1 tuple spellings (`extractVars` `[name, type, desc]`, header `[k, v]` tuples, `response_data {name, data}` on webhook steps) | NONEXISTENT | v2 uses row objects; carrying v1 tuples verbatim produces inert or crashing config. |
| `contact` omitted | REJECTED | The validator requires `contact.inboundNumbers`. |
