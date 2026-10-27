# How knowledge works

The path from an uploaded file, page or pasted text to the answer a caller
hears, and how agent memory differs. Routes, bodies and errors are in the
[API reference](api.md). Tests and the miss diagnosis are in
[verification](verification.md).

## Contents

- [What it is](#what-it-is)
- [Objects and how they relate](#objects-and-how-they-relate)
- [Lifecycle and states](#lifecycle-and-states)
- [How it reaches a live call or conversation](#how-it-reaches-a-live-call-or-conversation)
- [On the dashboard](#on-the-dashboard)
- [Rules and limits](#rules-and-limits)
- [When it goes wrong](#when-it-goes-wrong)
- [Questions people ask](#questions-people-ask)
- [Knowledge map](#knowledge-map)
- [Agent memory](#agent-memory)

## What it is

A knowledge source is a document your agents can search: an uploaded file, a
list of web pages, pasted text, or a Notion page or Google Doc from a
connected account. Sources belong to the organization. An agent uses one only
when the agent version it runs lists the source's id.

It is not:

- **The prompt.** A prompt is read on every turn. A source is searched, and
  only the passages that match the question reach the model.
- **A knowledge step's pasted text.** That text is saved inside the agent
  version and given to the model whole, up to 30,000 characters.
- **Memory.** Memory is what one agent learned about one contact in earlier
  conversations. See [Agent memory](#agent-memory).
- **Call notes** (`/v1/notes`) or the legacy `/v1/knowledgebases` routes.

## Objects and how they relate

```text
 ORGANIZATION (live, shared)                 AGENT (versioned)
 +----------------------------------+        +-------------------------------+
 | Source: id, name, description    |<--id---| version snapshot              |
 |   type FILE | WEB_SCRAPE | TEXT  |        |   knowledge.kbIds (agent-wide)|
 |        | INTEGRATION             |        |   knowledge step kbIds        |
 |   status, content versions       |        +---------------+---------------+
 |   Q&A pairs from answered        |                        | pinned per environment
 |   questions                      |                        v
 +----------------+-----------------+            dev / staging / production
                  | searched by a lookup
                  v
   lookup --> Query Logs row --(miss)--> Question --answer--> Q&A pair in one source
```

- **Source content is live.** There is no dev or production copy. Once a new
  content version reads `COMPLETED`, every agent that lists the source
  searches it.
- **Which sources an agent uses is versioned.** Attaching or detaching is a
  version save and reaches callers only through promotion.
- **A Question records the sources that were searched** when it opened. Its
  answer can be written only into one of them.
- **An answered Question becomes a Q&A pair** stored beside the source's
  document. It is searched with the source (Query Logs tags it "Q&A") but does
  not appear in the document text you edit.

## Lifecycle and states

### Source

```text
                    add source
                        |
                        v
 edit content,    +------------+  indexing finished  +-----------+
 replace,  ------>| PROCESSING |-------------------->| COMPLETED |
 reindex,         +------------+                     +-----------+
 restore                |                                  |
   ^   ^                | could not start, conversion      |
   |   |                | failed, or no progress for       |
   |   |                v about a day                      |
   |   |            +--------+                             |
   |   +------------| FAILED |                             |
   |                +--------+                             |
   +-------------------------------------------------------+

 delete (any status) --> DELETED: gone from every list, no undo route
```

- Only one indexing run per source at a time. A write while it reads
  `PROCESSING` is refused with 409 `Source is still indexing. Wait until it
  completes.`
- `FAILED` is not terminal. Edit, replace, reindex or restore starts a new
  run. The source's `error_message` says why it failed.
- While a large file converts, the source shows a progress bar, "pages done
  of total", a time estimate, and "Attempt n of m" after a retry.
- The list shows four labels: **Processing**, **Failed**, **Active**, and
  **Stale**. Stale means an auto-syncing web or integration source whose last
  sync is more than 7 days old. A source that does not auto-sync is never
  Stale.

### Question

```text
   a lookup misses
         |
         v      similar question again: adds an occurrence
     +------+ ------------- dismiss -----------> +-----------+
     | OPEN |                                    | DISMISSED |
     +------+ <------------ reopen ------------- +-----------+
        |   \                                    asked again: counted,
        |    link to an answered question        stays dismissed
        |    (copies its answer)
        v
   +----------+   edit the answer; push it to linked questions
   | RESOLVED |
   +----------+

 delete (any status): hidden; a similar question does not open again
```

- A similar question that misses after its Question was answered opens a
  **new** Question. The earlier answer did not cover it.
- Deleting a resolved Question leaves its answer in the source.
- Linking needs an answered target that shares a source with the open one.

## How it reaches a live call or conversation

The agent version a conversation runs decides which source ids it may search.
An API call uses the version its `agent_version` selector names, else
production. An inbound number runs its production pin. The builder's test
chat runs the latest dev version. The **content** of each source is read live
at every lookup.

### Agent-wide sources

`knowledge.kbIds` (the Attach checkbox on the agent's Sources tab):

```text
 call set-up                      during the call
 each listed source  ---------->  the model sees one lookup per source,
 becomes a lookup                 named and described by the source's
 (name + description              name and description, and decides
  read now, once)                 itself when to search and with what words
```

- The model chooses. Nothing is searched on a turn where it does not choose
  to look up. A vague source name or an empty description makes a lookup less
  likely.
- The name and description are read when the call starts. A rename reaches
  the next call; the content reaches the next lookup.
- **Channels.** Calls placed through the API carry agent-wide sources. In a
  text conversation the agent searches its agent-wide and step sources as
  one set. Inbound phone calls, the builder's test chat and simulations may
  not consult agent-wide sources. Check Query Logs for that channel before
  relying on it. A knowledge step is searched on every channel.
- Tagging a source with `@` in a prompt adds it to `knowledge.kbIds`. The
  mention has no other effect at runtime.

### Knowledge steps

A `knowledge` step with `kbIds` searches on its own; the model does not
choose.

```text
 caller turn while the call is on the step
      |
      v
 write a search from the recent conversation  (queryExtractionPrompt, or the
      |                                         platform default)
      +-- turn holds no question --> no lookup this turn, no Query Logs row
      v
 search the step's sources --> passages handed to the model --> reply
```

- `{{variable}}` ids are filled in at call time. A value that is not a
  source id is dropped without an error.
- **Passages to retrieve** (`retrievalTopK`) and **Keyword vs. meaning**
  (`retrievalAlpha`, 0 = exact words, 1 = meaning) default to the service
  default when empty. When one lookup searches several sources the passage
  count may not apply exactly.
- A lookup that takes too long is abandoned. The reply goes ahead without
  passages, and the Query Logs row has no chunks.
- With `useStaticText` on, the step speaks its prompt word for word, so
  retrieved passages do not change the reply.
- With no `kbIds`, the step's pasted `knowledgeText` is given whole to the
  model on every turn at that step. Any listed source makes the step ignore
  the pasted text.

### After each lookup

```text
 lookup returns passages --> a check asks: do these passages answer it?
 lookup returns nothing  --> counted as a miss
                                 |
             answered <----------+----------> miss
                |                               |
   Query Logs: Answered          Query Logs: Question (Open)
                                 Questions: new entry, or one more occurrence
                                 automation trigger "Knowledge gap detected"
                                 (new Questions only)
```

- The Query Logs row is written after the check, a few seconds after the
  lookup. It holds the search text, the sources searched, each passage with
  its score, and the source of the lookup (Agent, Pathway, Persona, API,
  Norm, Playground).
- **Answered means "not flagged".** A lookup that failed or timed out, a
  repeated question served from recent results, and an `/answer` test with
  `skip_gap_evaluation` all read Answered. Read the chunks before trusting it.
- On inbound phone calls, knowledge-step lookups may not open Questions.
  Query Logs still records them.
- The agent never sees the check's verdict. It answers from whatever passages
  came back.

### How long a change takes

| Change | When callers feel it |
|---|---|
| Edit content, replace, reindex, restore, re-sync | Every agent listing the source, once it reads `COMPLETED`. No promotion. While indexing, answers can come from the old content, and a question asked in that window can keep its old result for a while. |
| Answer a Question | The Q&A pair is searchable at once. A question asked identically just before can return the earlier result for a while. |
| Rename or re-describe | The next call, for agent-wide lookups. |
| Retrieval settings | After the re-index (a re-sync for web sources) the dialog starts. |
| Attach or detach | After a version save and promotion. Calls in progress keep their start-time list. |
| Delete a source | Detach it from every version first. Deleting does not edit any agent's list. |

## On the dashboard

Org pages live under `/dashboard/knowledge-base/`; the agent copies live
under `/dashboard/agent/<agentId>/knowledge-bases/`.

| Page | Shows | Only here, not through the API tools |
|---|---|---|
| Sources | Type, status, Indexed sections, Queries, Share, Hits / misses, Coverage, Resolved coverage, Contexts, all over 30 days. The agent copy adds an Attach checkbox for agent-wide sources; Save makes a dev version. | Add source from a file on the user's machine; picking a Notion page or Google Doc. |
| Source detail | Status card, Queries (30d) card, Context card (agents with their environments, classic agents, pathway nodes), the editor, versions with compare and restore, auto-sync and Re-sync now, a test chat. | Replace file; Retrieval settings; download. |
| Questions | Open, Resolved, Dismissed; source filter; occurrences with links to the call or text conversation. The agent copy lists Questions touching its agent-wide sources. | CSV export of every match. |
| Query Logs | Time, Query, Status, Source, Context, Call; a 7-day default window; detail with the passages and scores. The agent copy lists every lookup attributed to the agent, step lookups included. | |
| Source testing | A chat over chosen sources: the answer written from the passages, the search written, each passage with its score, "Boosted result" when a boosted field matched, and an Answer banner on a miss. Logged as API. The agent copy tests the agent-wide sources of the environment and branch shown, as loaded in the builder, which may be unsaved. | |
| Knowledge map | Sources as hexagons sized by share of lookups and coloured by coverage; open and resolved Questions as circles linked to their sources. See [Knowledge map](#knowledge-map). | The picture itself; `GET /v1/knowledge/map` returns the data. |

Coverage counts the lookups that were not misses when they ran. Resolved
coverage also counts misses whose Question was later answered. Contexts
counts production-pinned agents plus anything that searched the source in
the last 30 days.

After a write through the API the page shows it after a refresh.

## Rules and limits

| Rule | Limit or behavior |
|---|---|
| New sources per org | One add at a time, 10 seconds apart: 423 `KB_UPLOAD_RATE_LIMITED` (`kb_upload_rate_limited` from the upload tool). |
| Sources per org | Capped by plan: 400 `KB_UPLOAD_LIMIT_EXCEEDED`. |
| File | pdf, docx, xlsx, txt, md, csv, json; at most 20 MB; type checked from the content. The dashboard's Replace takes the same extension, under 10 MB. |
| Text | At most 1 MB when added; content edits at most 10 MB. An edit replaces the whole document. |
| Web | At most 100 URLs per source (2,000 on enterprise), all on one domain; subdomains count as the same domain. Discovery returns 1 to 2,000 URLs and saves nothing. |
| Re-sync | Web and integration sources only. A manual web re-sync is refused while the source is processing (409). The dashboard says auto-sync runs daily. |
| Retrieval settings | CSV: boost up to 3 columns, exclude others. JSON: up to 3 boost and 3 ignore paths. Web: boost title and description. Saving starts a re-index, or a re-sync for web. |
| Question answers | At least 10 characters, written into one of the sources the Question searched. |
| Knowledge step | Pasted text at most 30,000 characters; Passages to retrieve at least 1; Keyword vs. meaning 0 to 1. |
| Query Logs | Default window 7 days; a detail read needs the row's `created_at`. |
| Testing over OAuth | `/answer` and `/chat` answer `oauth_path_not_allowed`. |

## When it goes wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| No Query Logs row for the call | Version that ran lists no source; or the agent-wide lookup was never chosen; or the channel does not carry agent-wide sources; or the step was never reached; or the turn held no question | The version from the call; `GET /v1/knowledge/queries?call_id=` with a window | Attach and promote; describe the source by what it answers; move the phase to a knowledge step |
| Row says Answered, no chunks | The lookup failed or timed out | Row detail: "No retrieved chunks recorded for this query." | Re-test the same question; if it repeats, report it with the row |
| Row shows the right passage, wrong spoken answer | Not retrieval | The passage text | Prompt or generation, per call analysis |
| Old answer after an edit | Still indexing, or a recent identical lookup is being reused | `GET /v1/knowledge/<id>` status; the row's time | Wait for `COMPLETED`, re-test with a fresh wording |
| Source stuck Processing | A long conversion, or no progress for about a day | Progress and attempt on the source | Wait; a day without progress turns it Failed, then edit, replace or reindex |
| Questions fill with test questions | Source testing and `/chat` open Questions on a miss | Questions occurrences without a call | Dismiss them; test with `/answer` and `skip_gap_evaluation` |
| A dismissed question keeps coming back | Callers keep asking | "Asked n times since dismissed" on the Question | Answer it, or edit the source |
| Deleted source still listed by agents | Delete does not edit versions | `kb_item_scopes` plus the scan in the API reference | Remove the id and promote |

## Questions people ask

- **Does editing a source need a publish?** No. Content is live for every
  agent that lists it once indexing finishes. Attaching a source does need a
  version save and promotion.
- **Why did the agent not look anything up?** Agent-wide sources are lookups
  the model chooses, named by the source. Improve the name and description,
  or use a knowledge step, which searches on every question turn at that
  step. On an inbound phone call or a test chat, agent-wide sources may not
  be consulted at all.
- **Agent-wide or knowledge step?** Agent-wide for reference any phase may
  need. A step when one phase must always consult the source.
- **What does the score mean?** A relevance score from the search: higher
  matched more closely. Compare scores within one lookup, not across lookups.
- **Why is "Answered" wrong?** It means the check did not flag a miss, or did
  not run. Read the chunks.
- **Where do answered Questions go?** Into the chosen source as a Q&A pair,
  searchable at once, not part of the editable document.
- **Does testing cost anything visible?** Each test writes a Query Logs row,
  and a miss through Source testing or `/chat` opens a Question.
- **Can the agent read a file from my desktop?** No. Add it on Sources, Add
  source. A file at a public https link can go through
  `upload_knowledge_file`.

## Knowledge map

The Knowledge map answers "which sources do callers lean on, how often do
they come up empty, and what are people asking that they miss?" It draws
the last 30 days of lookups against the org's sources, plus the open and
resolved Questions raised against them.

It is not a map of what the documents say. It does not cluster topics or
show how sources relate to each other. Where a shape sits on the canvas
means nothing beyond the lines drawn to it.

Pages: `/dashboard/knowledge-base/map` (the org) and
`/dashboard/agent/<agentId>/knowledge-bases/map` (one agent). Both are
listed as "Knowledge map" in the sidebar.

### What the shapes mean

```text
  hexagon = a source              circle = a Question
    size   = its share of the        pale   = Open
             org's lookups, 30 days  filled = Resolved
    colour = coverage                size   = times asked
      red     under 50%
      amber   50 to 79%            line = the Question was raised
      green   80% or more                 against that source
      grey    no lookups in 30 days
```

- The header reads "<n> sources", "<n> questions" and "<n> queries / 30d".
  "(of first 5,000 returned)" after the questions count means the org has
  more than 5,000 open and resolved Questions and the rest are not drawn.
- Click a hexagon: name, type and status, then **Queries**, **Hits**,
  **Misses** and **Coverage**, and "View source". Click a circle: its status,
  the question, "Asked n times", the date it was resolved, and "View
  question", which opens the Questions list (not that one question).
- Grey sources gather in one cluster. Their lines are not drawn, and a
  Question raised only against grey sources is hidden.
- The Legend button shows or hides the key; the browser remembers the
  choice.

| Label | Counts | Window |
|---|---|---|
| Queries | Lookups that searched this source, from every agent, test and API call in the org. A lookup over three sources counts once for each. | Last 30 days, rolling |
| Hits | Of those, lookups not flagged as a miss when they ran (Answered in Query Logs). | Last 30 days |
| Misses | Lookups flagged as a miss. This is not the number of Questions. | Last 30 days |
| Coverage | Hits divided by Queries; a dash when there were no lookups. The same figure as the Sources Coverage column. Answering a Question later does not raise it; Sources shows that as Resolved coverage. | Last 30 days |
| queries / 30d | Lookups that searched any of the org's sources, each counted once. | Last 30 days |
| Questions | Open and Resolved, of any age. Dismissed and deleted ones are left out. Open ones come first, newest first, up to 5,000. | All time |

A source is drawn whatever its status. One stuck in Processing with no
progress for about a day reads Failed, as on Sources.

### The agent copy

```text
 org map (every source, every Question)
      |
      | keep the sources in this agent's agent-wide list
      | (the environment and branch in the URL, unsaved edits included)
      v
 agent map: those sources + the Questions raised against them
```

- Only agent-wide sources (`knowledge.kbIds`) are on it. A source the agent
  uses only on a `knowledge` step is not drawn.
- The numbers stay org-wide. A shared source's Queries, Hits and Coverage
  include every agent and every test that searched it, and its size is its
  share of the whole org's lookups. For this agent's own lookups, read Query
  Logs with `agent_id`.
- The Questions shown were raised against those sources by anyone.
- "No sources attached" means the version shown lists none. Attach on the
  Sources tab.

### How fresh it is

- Every load computes the map from the lookups and Questions as they are
  now. There is no nightly snapshot.
- A lookup counts once its Query Logs row exists, a few seconds after it
  ran.
- The page reuses what it loaded for a short while and does not redraw
  after a write. A Question answered or a source added since appears after
  a reload.
- A new source stays grey until something searches it.
- "No queries in the last 30 days." replaces the drawing when nothing in
  scope was searched in that window.

### Dashboard and API

The page and `GET /v1/knowledge/map` carry the same data
([fields](api.md#knowledge-map)). The API returns the whole org; to see one
agent, keep the source rows whose `kb_id` the agent's version lists. Unlike
the page, you can include the agent's step sources too. The shapes are
drawn on a canvas the page context does not read, so read the route.
Nothing on the map is edited there: answer Questions on Questions, change
sources on Sources.

### Find the weak spots

When someone asks "what is the agent weakest on?":

1. Read `GET /v1/knowledge/map` and keep the agent's sources, agent-wide and
   step, from the version that runs (production for live traffic).
2. The map's numbers are org-wide: a source shared with other agents
   carries their misses too. Use it to pick candidates only. For this
   agent's own misses, read
   `GET /v1/knowledge/queries?agent_id=<id>&state=QUESTION_OPEN` over 30
   days and count the rows per source.
3. Rank by this agent's misses, then the map's Coverage. Two misses are
   noise; dozens on one source are a real gap. Leave out test traffic
   (`query_source` `API` and `PLAYGROUND` rows come from Source testing and
   `/chat`). If the agent's own count is small but the map is red, say it
   is the shared source's health, driven by other agents.
4. For the weak source, list
   `GET /v1/knowledge/gaps?status=OPEN&kb_id=<id>&sort_by=occurrences_desc`
   and answer or edit the source from the user's facts.
5. A grey source the agent lists was never searched. That is a lookup
   problem, not a content one: see
   [agent-wide sources](#agent-wide-sources).
6. High coverage with unhappy callers: Hits include lookups that failed or
   reused an earlier result. Read the chunks in Query Logs.

### When the map looks wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| A source the agent uses is missing from its map | It is attached on a `knowledge` step only, or the environment shown does not list it | The version's `knowledge.kbIds` and step `kbIds` | Read the org map, or the API with the step ids |
| Coverage is red but the agent answers well | Test misses (Source testing, `/chat`) or another agent sharing the source | Query Logs by `query_source` and `agent_id` | Judge by this agent's rows; test with `/answer` and `skip_gap_evaluation` |
| Coverage is green but callers say it did not know | Failed or reused lookups count as hits; or the right passage was spoken wrongly | Row detail: no chunks, or the passage text | Per [When it goes wrong](#when-it-goes-wrong) |
| An answered Question still looks open | The page has not reloaded | `GET /v1/knowledge/gaps/<id>` reads RESOLVED | Reload the page |
| The Question count says "(of first 5,000 returned)" | More than 5,000 open and resolved Questions | `gaps_truncated: true` | Use Questions with a source filter; dismiss or resolve old ones |
| "No queries in the last 30 days." | Nothing in scope was searched in 30 days | Query Logs for the window | Attach, promote, describe the source by what it answers |
| A Question is on Questions but not on the map | Dismissed; or every source it was raised against is grey or deleted | The Question's status and `kb_ids` | Expected; read Questions |

## Agent memory

### What memory is

**Enable memory** in the agent's Settings makes the agent "remember each
contact across conversations and channels". A contact is the other party's
phone number. Memory is runtime data about people, not configuration: it is
not versioned, and nothing in a snapshot holds it. A conversation with no
contact phone number, such as a web call, may have no memory.

```text
 agent version settings                 contact memory (per agent + phone number)
   enableMemory ----- turns on ------->  summary, facts, entities
   memorySchema ----- shapes --------->  (a trip, an order, a quote ...)
                                         recent messages
 org contact profile (shared by all agents) --> contact_<field>
```

### When memory is read and written

```text
 conversation starts --> read memory --> the agent's instructions get what is known
                                     --> a returning contact can get a greeting
                                         that acknowledges them
                                     --> variables contact_<field> and
                                         memory_<entity>_<field>
 conversation ends   --> post-conversation processing --> summary, facts and
                                                          entities updated
 next conversation   --> reads the update
```

- Memory follows the version the conversation runs. Inbound calls and texts
  use production's setting; turning it on in dev changes nothing there until
  promotion.
- The memory variables never overwrite a variable of the same name that the
  caller or request supplied. For each entity type they describe the most
  recently discussed open one.
- A text conversation also adds each message to the recent-messages window as
  it happens.
- The update is written after the conversation ends. A contact who calls back
  before processing finishes may not be recognized yet.

### The schema

`settings.memorySchema` lists entity types. Each has a name, a description,
an identifying field and fields. A field has a name, a description, a type
(`string`, `number`, `boolean`, `enum` with allowed values, `date`, `array`,
`address`, `time`, `datetime`), an optional required flag, and an optional
**Filled from** variable: when the conversation extracted that variable, its
value is stored as is.

- No schema saved: one is generated from the agent the first time it is
  needed and reused for that version. A saved list, even an empty one, is
  used exactly.
- **Generate from agent** proposes a schema and saves nothing. It replaces
  every entity in the editor; memory already stored is kept. Six per minute
  per agent.
- The Contact profile fields are shared by every agent and edited in
  Contacts.

### Memory on the dashboard

- Settings, Memory: the toggle, the schema editor and the Contact profile.
- A conversation's Memory section: **Initial context** (what the agent knew at
  the start) and the changes this conversation made, or "No memory recorded
  for this conversation."
- The Contacts tab on Conversations shows each contact's memory per agent
  ([contacts](../../call-analysis/references/how-it-works.md#contacts)); the
  [memory routes](../../v2-lifecycle/references/api.md#memory-records) read it
  through the API.

### When memory goes wrong

| Symptom | Likely cause | Evidence | Fix |
|---|---|---|---|
| Agent does not remember a caller | Memory off in the version that ran; no contact phone number; the last conversation still processing | `GET /v1/memory/changes?call_id=` answers 404 "no memory data available" | Turn it on, save, promote; wait for processing |
| A field is never filled | Not in the schema, or the bound variable was never extracted | The conversation's Memory section | Add the field or fix the extraction |
| Wrong fact recalled | A bad extraction | The contact's facts | Correct it with a facts or summary write (confirm first) |
| Generate refuses | Six per minute per agent, or an OAuth connection | The error | Wait a minute; use the dashboard |

Correcting or deleting memory is a data change. A summary or facts write
overwrites what the agent recalls next time. `POST /v1/memory/reset`
deletes a contact's memory for good. Both need an admin, owner or operator
role. `POST /v1/memory/enable` is for v1 pathways and personas only.
