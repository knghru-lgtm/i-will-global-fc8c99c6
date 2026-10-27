# V2 node catalog and authoring boundaries

This is a data-shape and behavior reference, not a replacement for the current
snapshot schema. Preserve supported fields when editing, including ones this
page does not list. A node type existing in a schema does not guarantee every
channel, account, or older deployment can execute it. See
[runtime mapping](../../v2-runtime/references/builder-runtime-map.md) for
generated routes and [execution](../../v2-runtime/references/execution-order.md).
Settings and tool fields are in the [field guide](knobs.md).

## Contents

- [Shorthand and tags](#shorthand-and-tags)
- [Root nodes](#root-nodes)
- [Steps inside a flow](#steps-inside-a-flow)
- [Per-channel variants](#per-channel-variants)
- [Auth zones](#auth-zones)
- [Identity questions and scheduling](#identity-questions-and-scheduling)
- [Variable rows: two different contracts](#variable-rows-two-different-contracts)

## Shorthand and tags

Every node is `{id, type, position: {x, y}, data, parentId?}`. Every `data`
may carry `channelConfig` (see [per-channel variants](#per-channel-variants)).

- **P** = the prompt fields: `name`, `prompt`, `useStaticText`, `loopWhile`,
  `variables`, `useAudioExtraction`, `ignorePreviousExtractions`,
  `extractionPrompt?`.
- **S** = `settings` (step settings: `global`, `advanced`, `tag`, `media`,
  examples, guard rails). `settings.tag` is `{name, color}` or `null`.
- **rp** = step response pathways `{id, label, variable, operator, value, targetNodeId}`.
- **kv** = `{id, key, value}` rows.

Tags:

| Tag | Meaning |
|---|---|
| `ext` | Has a real external effect when it runs: dials, texts, sends HTTP, books, redirects. |
| `msg` | The builder offers it only to orgs with messaging access. |
| `auth` | The builder offers it only inside an auth zone's flow. |
| `import` | Not offered for new steps; kept so imported nodes still compile. |
| `voice` | Does something only on a phone or web voice call. |
| `term` | Terminal: its outgoing edges never run. |

## Root nodes

| `type` | `data` shape | Notes |
|---|---|---|
| `inbound` | `number` | Start anchor. Its edge target is Start's slot. |
| `agent` (hub) | `prompt`, `loopWhile`, `variables`, `useAudioExtraction?`, `ignorePreviousExtractions?`, `extractionPrompt?`, `tools?`, `mentions?`, S?, `entryScenarioId?`, `entryScenarioSource?` | Exactly one. `mentions[] {kind: tool or knowledge, refId, slug}` changes together with the `@slug` text in `prompt`. `entryScenarioSource` is `user`, `auto` or `import`. |
| `scenario` | `name`, `rule` (the prompt), `target {kind, label}` (cosmetic; `dialogue`, `tool`, `knowledge`), `entry`, `loopWhile`, `variables`, extraction flags, `extractionPrompt?`, `tools?`, `mentions?`, S? | Simple scenario: one prompt, no nested flow. |
| `complex-scenario` | `name`, `rule`, `target`, `entry`, `flow {nodes, edges}`, `exitPlacements?` | Nested flow. The Start pill's edge selects entry. `exitPlacements` is layout only. |
| `auth-zone` | `name`, `mode` (`simple` or `complex`), `method`, `detail`, `flow?`, `entry`, `exitPlacements?` | Gated scenarios set `parentId` to the zone id. |
| `end-call` | P, S, `entry`, `tools?`, `messagingEnd?` | `term`. Says its line, then hangs up. |
| `auth`, `complex-auth` | `name`, `entry`, then `detail` or `flow` | Legacy inline verification. Preserve; do not create. |
| `start`, `end` | `{}` | Flow pills. End is a component exit, not a hang-up. |

On hub and scenario cards the compiler drops `settings.tag` and the per-turn
flow controls; see the [field guide](knobs.md#step-settingsadvanced).

## Steps inside a flow

These are the 25 step kinds a `complex-scenario` or `auth-zone` flow can hold.

| `type` | `data` shape | Tags | Verify |
|---|---|---|---|
| `prompt` | P, S, `tools?`, `loopConditionType?` (`prompt` or `tool_response`), `toolResponseLoopCondition?` | | Generated vs static speech; loop release. |
| `waitForResponse` | Same as `prompt` | | Waiting for input is intended, not a stuck route. |
| `knowledge` | P, S, `tools?`, `knowledgeText`, `kbIds?`, `queryExtractionPrompt?`, `retrievalTopK?`, `retrievalAlpha?` | | Non-empty `kbIds` switches to retrieval and ignores `knowledgeText`. |
| `tool` | `name`, `toolId`, `isStaging`, `overrides` (kv, dot-paths), `responsePathways` (rp), S, `embeddedTool?` | `ext` | Runs the library tool's latest version unless an imported `embeddedTool` is present. |
| `webhook` | `name`, `url`, `method`, `headers` (kv), `body`, `auth?`, `timeoutSeconds?`, `maxRetries?`, `responseData?`, `responsePathways?` (rp), `prompt?`, `useStaticText?`, `variables?`, S | `ext` | Transport result vs business success. |
| `customCode` | `name`, `code`, `snippetId`, `snippetVersion`, `variables?` (kv inputs), `timeoutMs?`, S | `ext` | No `snippetId` = inert. The pin runs, never `code`. |
| `route` | `name`, `rules [{id, targetNodeId, conditions [{id, field, operator, value}]}]`, `fallbackNodeId`, S | | First matching rule; no match and no fallback fails. |
| `channel` | `name`, `rules [{id, channels, targetNodeId}]`, `fallbackNodeId`, S | | Empty `channels` is a draft and is dropped. |
| `sms` | `name`, `fromNumber`, `message` | `ext` `msg` | No settings. Sends a real text. |
| `transfer` | P, S, `tools?`, `transferType` (`phone` or `twilio-app`), `transferNumber`, `transferExtension`, `warmTransfer`, `twilioAppSid?`, `twilioAppParams?` (kv), `enableSipRefer?`, `transferTargetType?` (`phone` or `did`), `messagingTransfer?` | `ext` | Dial, answer and merge; see [handoffs](../../v2-runtime/references/tools-and-handoffs.md). |
| `transferPathway` | `name`, `pathwayId`, `version`, `startNodeId`, `liveAgentWebhookUrl?`, S | `import` | Hands off to a v1 pathway, not a v2 agent or a number. |
| `transferChat` | P, S, `notifyNumber`, `handoffReason`, `handoffWebhook` | `ext` `msg` | The thread enters human handoff; the agent stops replying. |
| `retryTransfer` | `name`, `prompt`, `useStaticText`, `variables?`, extraction flags, S | `term` | Redials only inside a warm-transfer proxy flow that allows retry. |
| `addToConference` | `name`, `prompt`, `useStaticText`, `loopWhile`, `conference {number, pin?, label?, callerId?}`, S | `ext` `voice` | Dials once per destination per call. |
| `playAudio` | `name`, `audioUrl`, S | `voice` | Asset reachable and audible. |
| `pressButton` | `name`, `mode` (`digit`, `sequence`, `agent`), `digit`, `sequence`, `digitPrompt`, `afterPress?` (`goToNode` or `continue`), S | `voice` | Sends DTMF; `goToNode` follows the first outgoing edge. |
| `ivr` | P, S, `survey?` | `voice` | Menu interaction mode. `survey` is editor state. |
| `scheduling` | P, S, `includeGlobalPrompt`, `url`, `method`, `headers`, `body`, `auth`, `timeoutSeconds`, `responseData`, `responsePathways` (rp), `errorFallbackNodeId`, `slotLocking {enabled, method, url, headers, body, lockedField}` | `ext` | Availability is not a booking. |
| `scheduleMeeting` | `name`, `prompt`, `meetingLink`, `selectedTimezone`, `assumeTimezone?`, S | `ext` `import` | Books the confirmed slot. |
| `twilioFlowRedirect` | `name`, `flowSid`, `flowName` (display), `redirectVariables` (kv), S | `ext` `voice` `term` | Hands the call to the flow. |
| `amazonConnect` | `name`, `prompt`, `useStaticText`, `webhookUrl` | `ext` `voice` | No settings. Posts collected tones. |
| `resetSttLanguage` | `name`, `language`, `targetNodeId`, S | `voice` | Switches recognition, not prompt language. |
| `smsOtp` | `name`, `prompt`, `codeLength` (4 or 6), `expirySeconds`, `messageTemplate` (with `{{code}}`), `maxAttempts`, `deliveryMethod` (`sms` or `whatsapp`), optional P fields, `tools?`, S? | `ext` `msg` `auth` | Real delivery; never print codes. |
| `identityQuestions` | `name`, `questions [{id, question, expectedAnswer, required}]`, `tools?` | `auth` | No settings, no attempt budget. |
| `orchestrator` | `name`, `prompt` | `import` | Never routes by its own edges. |

Rows the table abbreviates:

- `webhook.auth` is `{type: "Bearer" | "Basic" | null, token, encode}`.
  `timeoutSeconds` defaults to 10; `maxRetries` is 0 to 4.
- `responseData` rows are `{id, name, path, context, sensitive?}`; `path` is a
  JSONPath into the response.
- `customCode.timeoutMs` is clamped to 1000 to 60000; absent means 10 s.
- `warmTransfer` holds `enabled`, `agentPrompt`, `mergePrompt`, `holdMusicUrl`,
  `timeout`, `voicemailMessage`, and optional `agentPromptStatic`,
  `mergePromptStatic`, `dtmfSequence`, `fromNumber`, `optimizeForIVR`,
  `allowMergeControl`, `retry`, `voicemailTargetStepId`, `proxyPathway`,
  `liveTranslation`, `keywords`, `sipRequestData`.
- `messagingTransfer` is `{messageMode?, destination: "inbox" | "webhook", webhook, notifyNumber, message, reason}`.
- Channel values: `voice`, `web_voice`, `sms`, `imessage`, `rcs`,
  `whatsapp`, `web_chat`, `api_chat`.

## Per-channel variants

Any node can hold a different copy of its editable fields per channel:

```json
{"channelConfig": {"shared": false, "mode": "independent", "overrides": {"sms": {"prompt": "<texting version>", "useStaticText": false}}}}
```

- `shared: true` (or no `channelConfig`) means one copy for every channel.
- With `shared: false`, `overrides.<channel>` patches the node for that
  channel. Objects merge by leaf; an array replaces the whole field. With
  `mode: "independent"` the override replaces every editable field.
- These keys always stay shared and are refused inside an override: `id`,
  `type`, `name`, `entry`, `flow`, `target`, `parentId`, `position`,
  `channelConfig`, `entryScenarioId`, `entryScenarioSource`.
- An override value must have the same type as the shared value. An unknown
  channel key is refused.
- Each channel that has an override gets its own compiled graph.

Before editing `prompt` or any other field on a node, read its
`channelConfig`. An edit to the shared value does not reach a channel that has
its own override. An older node may carry `messagingEnd` or
`messagingTransfer` instead; it reads as a messaging override.

## Auth zones

Auth is not just a prompt saying "verify first." Choosing a protected destination
can redirect through its zone's verification flow. Moving a child out of its
zone, changing its parent, or routing around the verification changes protection.
Do not flatten these structures during cosmetic cleanup or to fix a missing arrow.
Test verified and unverified callers and attempted topic changes into protected
content; inspect the executed path. UI presence is not proof of authorization.

A simple zone carries `method` (`sms`, `phone`, `identity`, `tool`, `custom`)
and `detail`. A complex zone carries a `flow` with the verification steps
(`identityQuestions`, `smsOtp`) and a success exit. An entry pathway set with
`entryScenarioId` cannot sit inside a zone.

## Identity questions and scheduling

Identity questions use required answers as the pass condition. They do not
implicitly supply an attempt budget or failure branch. If a caller cannot
answer, design the supported exit/escalation explicitly rather than inventing
`maxAttempts` on this node. Expected answers must come from authorized fixtures
or upstream lookup, not be fabricated from the caller's unverified assertions.

Scheduling's availability request can run on entry and again when more slots
are requested. Its fixed confirmation bar is not replaced by the custom loop.
When slot locking is configured, inspect its result before claiming a booking.
Test empty availability, timeout, rejected lock and retry separately. These are
real integration operations unless the host explicitly supplies a test substitute.

## Variable rows: two different contracts

Extraction rows on conversational steps include type and spelling mode:

```json
{"id":"6c64eae2-9504-4971-83f9-507846989915","key":"reason","value":"The caller's reason for contacting support","type":"string","accurateSpelling":false}
```

`type` is `string`, `number`, `boolean`, or `json`. `accurateSpelling` requests
precision when appropriate; it is not evidence the extracted value is correct.
Optional fields:

- `captureAs` (`name`, `name.first`, `phone`, `email`, `address.street`, `id`,
  `date`, …) turns on capture: the value is read back and confirmed with the
  caller. Not every org has capture.
- `sensitive: true` keeps the value out of prompts, logs and call records; it
  reaches only outbound requests during the call.
- `batchId` groups rows into one extraction call; distinct batches run in
  parallel.
- `guardRailEnabled: false` opts the row out of the step's extraction guard
  rails.

Code-input rows are key/value mappings, not extraction instructions:

```json
{"id":"74da51db-b958-4260-80da-b3184d2d3db0","key":"reason","value":"{{reason}}"}
```

These are row fragments, not complete version-create payloads. Preserve stable
IDs; validate the containing node and snapshot. Do not add extraction-only fields
to strict schemas for a different row type.
