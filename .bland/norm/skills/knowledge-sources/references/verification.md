# Verifying retrieval

How to prove a source answers what it should, what each test leaves behind,
and how to name the cause when a call missed. Routes and bodies are in the
[API reference](api.md).

## What each test writes

No retrieval test is free. Tell the user what the test will leave behind
before running it.

| Test | Query Logs row | Questions entry | Over OAuth |
|---|---|---|---|
| `POST /v1/knowledge/answer` with `skip_gap_evaluation: true` | Yes, source API | No | Refused |
| `POST /v1/knowledge/answer` without it | Yes, source API | Possible, from a background check | Refused |
| `POST /v1/knowledge/chat` | Yes, source API (Playground with `source: "playground"`) | Yes, whenever the check finds a miss | Refused |
| Source testing tab in the dashboard | Yes, source API | Yes, on a miss | The user runs it |
| Test chat or simulation against the agent | Yes for knowledge-step lookups, attributed to the agent. Agent-wide sources may not be consulted there | Possible | Depends on the host |

A deliberately absent question is a designed miss. Through `/chat`, the
Source testing tab or a test chat it can open a Questions entry. Dismiss that
entry afterwards (`POST /v1/knowledge/gaps/<id>/dismiss`) and say so.

## Verify after ingest

Only after `GET /v1/knowledge/<id>` reads `COMPLETED`. Never test a
PROCESSING or FAILED source: a FAILED source answers nothing.

1. Write two questions in the caller's words:
   - **answerable**: a fact that is in the source text;
   - **absent**: a plausible question the source does not cover.
2. Run each through `POST /v1/knowledge/answer` with `top_k: 5`,
   `disable_cache: true` and `skip_gap_evaluation: true`.
3. Judge the chunks yourself. Retrieval always returns the nearest chunks,
   so a non-empty `results` is not a pass.
   - Answerable passes when a returned chunk states the fact.
   - Absent passes when no returned chunk states an answer. A chunk that
     answers it anyway means the source says more than the user expected;
     show the chunk.
4. Report both questions, the top chunk text (trimmed) and its `score`, and
   the verdict. Say the test wrote two Query Logs rows.

This proves the source can answer. It does not prove the agent will look it
up. When the user needs that, run one test-chat turn or simulation per
[v2-testing](../../v2-testing/SKILL.md) on the version that carries the
attachment, then read that call's Query Logs rows. A test chat proves a
`knowledge` step's lookup; agent-wide sources may not be consulted in a test
chat, an inbound phone call or a simulation
([channels](how-it-works.md#agent-wide-sources)), so say which one you
proved.

## Source testing

The Source testing page is a chat over chosen sources:
`/dashboard/knowledge-base/testing` for any source, or
`/dashboard/agent/<agentId>/knowledge-bases/testing` for the agent-wide
sources (`knowledge.kbIds`) of the environment shown (`?env=`, dev when
absent; `?branch=` for a branch), as loaded in the builder. That page does
not add a `knowledge` step's sources. It sends `POST /v1/knowledge/chat`, so
every question there writes a Query Logs row (source API) and a miss opens a
Questions entry.

To run the same test from here:

1. **Ids.** On the agent page, read the version for that environment
   (`/v2/agents/<agentId>/versions/latest`, with `?branch=` for a branch, or
   the pinned semver) and collect `knowledge.kbIds`, which is what the page
   tests. Add a `knowledge` step's `kbIds` when the user asks about that
   step, and say you did. On the org page, use the source the user names
   (`GET /v1/knowledge/sources?search=`).
2. **Questions.** Use the user's first. Otherwise draft pairs:
   - **answerable**: a fact the source states. `GET
     /v1/knowledge/<id>/suggestions?page=1&limit=20` lists suggested
     questions for a source (may be empty), or use text the user supplied.
     Never draft an "answerable" question from a fact you have not seen in
     the source;
   - **absent**: plausible for this agent's callers, not covered.
   Label drafted questions as drafted.
3. **Run** each through `POST /v1/knowledge/answer` with the ids in
   `knowledge_base_ids`, `top_k: 5`, `disable_cache: true` and
   `skip_gap_evaluation: true`. Not `/chat`: it opens a Questions entry for
   every designed miss.
4. **Judge** as in [verify after ingest](#verify-after-ingest). Report a
   table: question, kind (answerable or absent, yours or drafted), top chunk
   trimmed, score, verdict.
5. **A failed answerable question**: name the cause from the
   [cause map](#cause-map) (content gap or ranking) and offer to update the
   source ([update by type](api.md#update-by-type)).

## Over OAuth

`/answer` and `/chat` return `oauth_path_not_allowed` on an OAuth-connected
host. Do not retry through another route and do not script around it.

- Ask the user to run both questions on Source testing:
  `/dashboard/agent/<agentId>/knowledge-bases/testing` for an agent, or
  `/dashboard/knowledge-base/testing` for the org. Ask them to paste the
  answer and the chunks shown.
- Or run a test-chat probe, if the host supports one, and read the call's
  Query Logs rows (`GET /v1/knowledge/queries` is allowed over OAuth).
- Until one of those comes back, report "ingested and attached, retrieval
  not verified". Never say verified.

## Cause map

Start from `GET /v1/knowledge/queries?call_id=<call id>` with a window
around the call, then each row's detail. Take the version the call ran from
[call analysis](../../call-analysis/SKILL.md); the dev head may differ.

| What the evidence shows | Cause | Fix |
|---|---|---|
| No row for the call, and the version that ran lists no source | Not attached on that version, or attached on dev but not promoted | Attach and save; promote per [v2-lifecycle](../../v2-lifecycle/SKILL.md) |
| No row, and an agent-wide source is attached | The agent never chose to look up. Agent-wide knowledge reaches the model as a lookup it decides to use, named and described by the source. On an inbound phone call, a test chat or a simulation, agent-wide sources may not be consulted at all ([channels](how-it-works.md#agent-wide-sources)) | Rename and describe the source by what it answers (`PUT /v1/knowledge/<id>`); or scope it to a `knowledge` step for that phase |
| No row, the call reached the `knowledge` step | That turn held no question (the caller only answered something), so no search was written | Normal; check the turns where the caller asked |
| No row, and only a `knowledge` step lists the source | The call never reached that step | A routing question; see [v2-runtime](../../v2-runtime/SKILL.md) |
| Row exists; the source read FAILED or PROCESSING at the time | Not indexed | Fix ingestion, then re-test |
| Row exists, `state` `ANSWERED`, no chunks | The lookup failed or timed out; "Answered" only means no miss was flagged | Re-test the question; report the row if it repeats |
| Row exists; `state` is `QUESTION_OPEN`; no chunk holds the answer, and the source text does not contain it | Content gap | The open-questions workflow: resolve, or edit the source |
| Row exists; the source text holds the answer, but no returned chunk does | Ranking | Compare `query_text` with the source wording. If the miss opened a question, resolve it with an answer in the caller's words; otherwise reword the source. On a step, raise `retrievalTopK` or tune `queryExtractionPrompt` ([node catalog](../../v2-snapshot/references/node-catalog.md)) |
| A returned chunk holds the right answer and the agent said something else | Not retrieval | Generation or prompt; see [call analysis](../../call-analysis/SKILL.md) |
| A returned chunk holds an outdated answer | Stale source | Edit the content, `replace_urls`, or re-sync a web or integration source |

Name one cause per miss with the row as evidence. When two fit, say which
evidence would separate them.
