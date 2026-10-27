# An agent's voice and language

How voice and language work on a v2 agent, and how to choose, set and
verify them. The fields live in the version snapshot, so a change ships
through the normal [pipeline](lifecycle.md#the-ship-pipeline). Which version
a call runs is explained in
[how environments work](../../agent-environments/references/how-it-works.md).
Field semantics are in the [field guide](../../v2-snapshot/references/knobs.md).

Do not write fetch scripts and do not search the docs for these routes.

## Contents

- [How voice and language work](#how-voice-and-language-work)
- [Fields](#fields)
- [Workflow: set the voice and language](#workflow-set-the-voice-and-language)
- [Discovery routes](#discovery-routes)
- [Dashboard only](#dashboard-only)
- [When it goes wrong](#when-it-goes-wrong)
- [Questions people ask](#questions-people-ask)
- [Rails](#rails)

## How voice and language work

### What a voice is

A voice is an org-level object in the voice library: a name, a description,
tags, a model label (V1, V2 or V3, as the library shows it) and the voice's
own sound settings. The agent does not own the voice. It stores the voice's
id, so one voice can serve many agents, and a change to the voice itself is
heard by all of them.

The language is the agent's: which language it listens for and speaks, or a
multilingual mode that lets the caller switch languages mid-call.

```text
 voice library (org-scoped, live)          agent version (versioned)
 ┌───────────────────────────────┐         ┌────────────────────────────┐
 │ voice: id, name, tags,        │◄─ id ───│ settings.voice             │
 │ model label (V1 / V2 / V3),   │◄─ ids ──│ settings.voicePool (opt.)  │
 │ sound settings, live / draft  │         │ settings.languages[0]      │
 └───────────────────────────────┘         └────────────────────────────┘
        ▲ edit or delete here:                      ▲ edit here: a new
        every agent using it changes                version, then ship it
```

Voice model labels and languages (from `GET /v1/models`):

| Label | Languages it speaks | Notes |
|---|---|---|
| V3 | English | The recommended, current generation. Curated voices and new agents' default picks are V3. |
| V2 | 17 languages, including English, Spanish, French, German, Portuguese, Italian, Japanese, Korean, Chinese, Hindi, Arabic | The choice for a non-English agent. |
| V1 | English | Older generation. |

Nothing checks that the voice can speak the agent's language: not the
builder, not the save, not the call. Pick a voice whose model lists the
language.

### How a call picks its voice

```text
 call starts ─► which version? (production pin, experiment arm, staging pin,
               or the version a test or selector named)
           │
           ├─ outbound call body has `voice`? ─── yes ─► that voice, no rotation
           │
           ├─ version has a pool of 2+ usable voices? ─► one at random
           │       (deleted, inaccessible and draft voices are skipped)
           │
           ├─ version has `settings.voice`? ──────────► that voice
           │
           └─ empty ──────────────────────────────────► the platform default voice
```

- The voice is read from the version at call start. It never changes
  mid-call.
- A voice change on a saved version reaches callers only when that version
  is promoted. Test chat and the builder's test channels hear it at once.
- An outbound call's own `voice` (or `language`) field overrides the
  agent's for that call only.
- Inbound calls use the resolved version's voice and pool as well. If the
  voice cannot be found there, the call still connects, with a fallback
  voice, rather than failing.

### How a call picks its language

- Only `languages[0]` counts. Later entries are saved and ignored.
- A single language (`en`, `en-GB`, `es`, or a single Babel language such
  as `babel-es`) holds one language for the whole call.
- Multilingual modes switch language during the call: `fluent`, `babel`,
  `auto` and `auto-v2`. The builder lists them first.
- On inbound calls, **a language set on the phone number beats the agent's**
  for calls to that number.
- An unrecognized value sets no language, and the call runs in English.
- A Reset STT Language step can change the listening language mid-call; it
  says nothing and does not change the voice.

### What the user can change

| Change | Where | Felt by |
|---|---|---|
| The agent's voice, pool or language | Builder Settings tab, or a version save | Only the version that holds it, once shipped |
| A voice's sound settings, name, or deletion | The voice library | Every agent and number using that voice, at once |
| A number's language | The number's settings | Inbound calls on that number, every agent |
| One call's voice or language | The outbound call request | That call only |

There is no per-step voice, no per-language voice, and no agent-level speed,
pitch or stability. Interruption, backchannel and background sound are
agent settings in the [field guide](../../v2-snapshot/references/knobs.md),
not voice settings.

### Preview vs live

| Where | What plays |
|---|---|
| The play button in the voice picker or library | A fixed sample line in the voice's own settings. No agent settings, no language. |
| Builder test, Voice channel (in the browser) | The tested version's single `voice`. **The pool is ignored**, and an unusable voice is silently replaced by a default. |
| Builder test, Phone call channel | A real call: the pool, draft and access rules apply. |
| Live inbound and outbound | The production version (or an experiment arm), as in the diagram above. |

So a browser voice test cannot prove rotation or catch a draft voice. Place
a phone test call for that.

## Fields

| Field | Rule |
|---|---|
| `settings.voice` | A voice id (UUID). `""` means the platform default. The save does not check it: a deleted, inaccessible or draft trained voice saves cleanly, then fails outbound calls ("Voice not found", "Voice does not belong to the user.", or a 403 for a draft) and may play a fallback voice on inbound. |
| `settings.voicePool` | Optional rotation: up to 20 ids, one usable voice picked at random per call. Blank and repeated ids are dropped; fewer than two usable means `voice` is used. Keep `voice` equal to `voicePool[0]`, as the builder does. More than 20 is refused at save: "settings.voicePool: at most 20 voices can rotate". |
| `settings.languages` | Keys from `GET /v1/languages`: a language code (`en`, `en-GB`, `es`, `babel-es`) or a multilingual mode (`fluent`, `babel`, `auto`, `auto-v2`). Put the target language first: **only `languages[0]` reaches calls**. Older friendly ids such as `english` are still read; write the canonical key. |

Always store the id, never a voice name.

## Workflow: set the voice and language

Call budget: one snapshot read, one or two discovery reads, one verify read per
chosen id, one models read, one version save, one read-back.

1. Read `GET /v2/agents/:agentId/versions/latest` and note
   `settings.voice`, `settings.voicePool` and `settings.languages`. During any
   unrelated edit, keep them as they are.
2. Find candidates. Start with the `list_voices` tool: curated V3 voices,
   English only. For other languages or the org's own voices use
   `GET /v1/voices` (what the builder's picker lists) or
   `GET /v1/voices/shared` with `search`, `tag` or `gender`.
3. Check the language. `GET /v1/models` lists each model's `model_id`,
   `display_name` (V1, V2, V3) and `languages`; a voice's `service` equals
   the `model_id` of its model. For a non-English target, pick a voice whose
   model lists that language. A voice whose `service` matches no `model_id`
   has no published language list: treat its language as unverified.
4. Verify each chosen id with `GET /v1/voices/:id`. It must return `{voice}`
   (400 `VOICE_NOT_FOUND` means this org cannot use it). If `is_live` is
   `false` it is a draft trained voice: stop, say it would fail calls and that
   making it live spends a professional clone slot, and hand off to the
   [dashboard](#dashboard-only).
5. Write `settings.voice`, the optional `settings.voicePool` (with
   `voice === voicePool[0]`) and `settings.languages` (target first) into the
   snapshot from step 1. Save with `POST /v2/agents/:agentId/versions`
   (`{snapshot, name, parent_version_id, parent_revision}`).
6. Read the version back and confirm the three fields. Say which callers hear
   it: test chat runs the dev head now; outbound and inbound calls run the
   production pin, so they change only after publish and promote. If the
   agent's numbers set their own language, say that it wins on inbound.
   Offer the [pipeline](lifecycle.md#the-ship-pipeline); do not promote
   unasked.

## Discovery routes

All reads, all reachable over an OAuth connection.

| Route | Returns | Notes |
|---|---|---|
| `list_voices` (tool) | curated voices with `id`, `name`, `description`, `tags`, `service` | V3, English. Match the user's brief against description and tags. |
| `GET /v1/voices` | `{voices}` at the root (no `data` envelope) | Catalog plus the org's own and saved voices. |
| `GET /v1/voices/shared` | public catalog page | Query: `search`, `sort`, `tag`, `gender`, `page`, `page_size`. |
| `GET /v1/voices/library` | the org's own and saved voices | |
| `GET /v1/voices/:id` | `{voice}` with `service`, `finetuned`, `is_live`, `tags` | 400 `VOICE_NOT_FOUND` when not accessible. `is_live` is false only for a draft trained voice. |
| `GET /v1/models` | `{models}`: `model_id`, `display_name`, `languages`, `is_recommended` | Language support per voice model. |
| `GET /v1/languages` | `{languages: [{language, name}]}` | Valid keys for `settings.languages`. |

## Dashboard only

The API connection carries JSON only. Audio responses and file uploads cannot
pass through it. Name the dashboard path instead.

| The user wants to | Dashboard path |
|---|---|
| Hear a voice before choosing | `/dashboard/voices`, or the play button in the builder's voice picker |
| Clone a voice from a short recording (instant clone) | `/dashboard/voices`, Create new voice |
| Train a studio voice, or make a draft voice live | `/dashboard/voices`, the training pages and Promote to live |
| Generate speech in the studio | `/dashboard/tts` |
| Buy a speech plan or credits | `/dashboard/tts/settings` |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| Calls still use the old voice | Saved, not promoted | Production version's `settings.voice` | Publish and promote |
| Outbound call refused "Voice not found" or 403 draft | Voice deleted, private to another org, or a draft | `GET /v1/voices/:id` | Choose a usable voice, or make the draft live on the dashboard |
| Inbound plays an unexpected voice | The agent's voice is unusable and a fallback played, or the version is not the one you edited | Production version and `GET /v1/voices/:id` | Fix the voice, then promote |
| One outbound call ignores the agent's voice | The request carried its own `voice` | The call's request | Drop `voice` from the request |
| Rotation never happens | Fewer than two usable pool voices, or the test used the browser Voice channel | Pool ids against `GET /v1/voices/:id` | Fix the pool; test with a phone call |
| Agent speaks English after choosing Spanish | Voice model is English-only, or Spanish is not first, or the number sets its own language | `GET /v1/models`, `languages[0]`, the number's language | V2 voice, target first, fix the number |
| Second language in the list does nothing | Only the first entry counts | `languages` | Use a multilingual mode first |

## Questions people ask

**Can different steps use different voices?** No. One voice (or one rotation
pool) per version.

**Can I make the voice faster or calmer from the agent?** No. Sound settings
belong to the voice and change every agent using it.

**Why does the preview sound different from the call?** The preview is a
fixed line in the voice's own settings; the call adds the agent's language,
interruptions and the phone line.

**Does changing the voice need a promote?** Yes, for callers. The voice is
part of the version.

**Does deleting a voice in the library affect agents?** Yes, immediately,
for every agent and number that uses it. Outbound calls fail until the agent
is moved to another voice.

**Which language wins on inbound, the agent's or the number's?** The
number's, when it sets one.

## Rails

- Never call synthesis routes (`/v2/tts`, `/v1/speak` and its variants,
  `/v1/voices/:id/sample`, `/v2/audio/speech`). They return audio the
  connection cannot carry, and some bill before the error comes back.
- Never accept terms or attest consent for the user (`tos_accepted`), and never
  subscribe, pay, mint stream tokens, create share links, publish a voice to
  the community, or duplicate a voice into another org.
- Before `DELETE /v1/voices/:id`, a voice settings write
  (`POST /v1/voices/:id/settings`) or demoting a trained voice: list the org's
  agents whose dev head or production version uses the id in `voice` or
  `voicePool`, name them, and get explicit confirmation. Read the agent list
  once with `GET /v2/agents` and no `limit` (a `limit` caps the list), then
  each agent's versions. If any read fails or the list looks cut off, stop
  and say which agents could not be checked; never report "no agents use it"
  from a partial scan. These change every agent and number that uses the
  voice. Deletion cannot be undone.
