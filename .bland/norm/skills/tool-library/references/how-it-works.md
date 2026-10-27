# How tools work

The concepts behind the [tool-library skill](../SKILL.md). Routes and field
tables are in the [tool library contract](../../v2-runtime/references/tool-library.md);
step-by-step procedures are in [procedures](workflows.md). This page explains
what happens, so you can predict it and diagnose it.

## Contents

- [What it is](#what-it-is)
- [Objects and how they relate](#objects-and-how-they-relate)
- [Lifecycle and states](#lifecycle-and-states)
- [How it reaches a live call or conversation](#how-it-reaches-a-live-call-or-conversation)
- [On the dashboard](#on-the-dashboard)
- [Rules and limits](#rules-and-limits)
- [When it goes wrong](#when-it-goes-wrong)
- [Questions people ask](#questions-people-ask)

## What it is

A tool lets an agent do something outside the conversation while it is
talking: look up an order, book a slot, post to Slack, write a CRM record, run
a few lines of code, text the caller, transfer the call. The agent decides to
use it, fills in its inputs from what the caller said, waits for the result,
and speaks from it.

It is not a webhook step or a code step (those run whenever the
conversation reaches them; a tool runs when the agent chooses), not a
post-call webhook or automation (those run after the call), and its secrets
are not agent variables marked secret (those belong to one agent).

## Objects and how they relate

```text
ORG SCOPE (live, not versioned)                       AGENT SCOPE (versioned)
-------------------------------                       -----------------------
secret ──referenced by {{secret.id.<id>}}──┐           agent version snapshot
  static value, or refreshing value        │             step
                                           ▼               └─ tools[]
connection (resource) ──resource_id──► library tool row ◄──── byReference: toolId
  third-party sign-in for the org          tool_id  TL-…  ◄──── tool step: toolId
                                           tool          (production definition)
snippet ──snippet_id + snippet_version──►  staging_tool  (optional second definition)
  versioned JavaScript                     agent_id      (whose Tools tab owns it)
  v1, v2, v3 …                             is_active
                                                 │
                                                 └─ copied into ─► embedded copy
                                                     (definition frozen in the version,
                                                      toolId kept only as provenance)
```

- **Library tool:** an org row holding a definition (name, description,
  inputs, what to do, what to keep from the result). `agent_id` only picks
  whose Tools tab lists it; any agent in the org can use it.
- **Definition kind:** `rest_api`, `custom-code` / `run_snippet`, `bland`
  (call control), `bland-sms`, or a connected service such as Slack, HubSpot,
  Salesforce, Notion, Google Calendar, Google Docs, Calendly or Cal.com.
- **Connection:** the org's signed-in account at a third party. Only
  connected-service tools need one.
- **Secret:** a value the definition references instead of containing.
- **Snippet:** saved JavaScript with numbered versions.
- **Attached tool:** what a version holds on a step, either an embedded copy
  or a pointer (`byReference`, or a `tool` step). That choice decides who a
  library edit reaches.

## Lifecycle and states

A library tool row:

```text
           POST /v2/tools
                │
                ▼
        ┌──── active
        │   (runs; edits are live at once)
        │        │
        │        │ its connection is disconnected or deleted,
        │        │ or the third party's sign-in expires
        │        ▼
        │     inactive (is_active: false)
        │     /run answers 404. Agents that point at it still try it on
        │     calls; those calls fail until the connection is back.
        │     Reconnecting does not set is_active back to true.
        │
        └──► deleted (DELETE, hard; every pointer to it breaks; terminal)
```

A connection:

```text
connect link sent ──person finishes sign-in──► connected
   (no row yet)                                   │  ▲
                     disconnect, or the third     │  │ Reconnect
                     party refuses to renew the   ▼  │ (dashboard only)
                     sign-in ──────────────► disconnected
                                                  │
                                    DELETE ──────►┴──► deleted (terminal)
```

- **Refreshing secret:** active (re-fetched each interval) ⇄ paused (by a
  person, or automatically after a long run of failed refreshes); paused
  keeps the last value. A static secret rotates everywhere at once.
- **Snippet:** version 1 on create, one new version per save; old versions
  stay runnable; deleting it breaks everything that names it.
- **Definition slots:** `tool` and an optional `staging_tool`, unrelated to
  the agent's environments
  ([staging and production](#staging-and-production-definitions)).

## How it reaches a live call or conversation

### One tool call, start to finish

```text
caller speaks
   │
   ▼
agent on a step that has the tool attached
   │  reads each tool's name, description and inputs
   │  decides a tool is needed ── no ──► just replies
   ▼ yes
inputs are filled from the conversation so far
   │  a required input it cannot fill ──► the tool does not run; the agent
   │                                      asks the caller for it
   ▼
filler line plays (if set) ─► the tool runs ─► the caller waits
   │                           (interruptions held, unless an aside is on)
   ▼
result comes back
   │  response_data rows ──► call variables
   │  the result (or a short marker) ──► the conversation history
   ▼
agent speaks from the result
   │  behavior feed_context_and_route ──► response routing picks the next step
   ▼
conversation continues (also after a failure)
```

A `tool` step is different: it runs when the conversation reaches the step,
not when the agent chooses, and then routes on its result.

### Which definition runs

| Attach mode | What runs | When a library edit is felt |
|---|---|---|
| Embedded copy | The definition saved inside the agent version | Never, until someone re-copies it and the version is saved and promoted |
| `byReference` pointer | The library row, read the first time the tool is called in a call, with `toolOverrides` applied | On the next call. A call already in progress keeps what it read |
| `tool` step | The library row, read each time the step runs (or the embedded definition an imported step carries) | On the next run of the step |

The version that runs comes from the agent's environment pin, as for every
other part of the agent. A pointer inside that version still reads the
library row live, so an edit to a shared tool reaches production calls with
no version save and no promotion.

### Staging and production definitions

A row can hold two definitions: `tool` and `staging_tool`. Which one runs is
decided by one switch on the attached tool, "Use the staging version of this
tool" (`isStaging`), not by the agent's staging or production environment.
An embedded copy uses its own `stagingDefinition` when the switch is on; a
pointer reads the row's `staging_tool`. If the switch is on and there is no
staging definition, a pointer fails the call to the tool and an embedded copy
falls back to its main definition. `/run?staging=true` tests the staging
definition.

### How the inputs get filled

`input_schema` is what the agent fills: each property becomes
`{{input.<name>}}` inside `body`. Other placeholders:

- `{{<variable>}}`: a call variable (a request variable, an earlier tool's
  `response_data`, an extracted value). If it has no value, the text is sent
  as written.
- `{{secret.id.<secret id>}}` or `{{SECRET.<name>}}`: a secret, read when the
  tool runs and scrubbed from what comes back.
- An optional `{{input.<name>}}` the agent did not fill is dropped from the
  request rather than sent as text.

Inputs listed in `extractVarSettings.audioVariables` are taken from the
caller's audio rather than the transcript, which helps with spelled names
and numbers. Inputs marked sensitive are kept out of logs and records.

### What the caller hears while it runs

| Setting | What the caller hears |
|---|---|
| `wrapperSpeech`, else the definition's `speech` | A filler line as the tool starts. Voice only. |
| `speechMode` / `speechPrompt` | End-call and transfer tools only: the goodbye before the action. |
| `toolAssist.nudges` | Up to 5 timed lines, 0.25 to 55 seconds after the start. |
| `toolAssist.aside` | The agent keeps talking with the caller; no other tool starts meanwhile. |
| `toolAssist.streamUpdates` | Progress the tool streams, read out as it arrives. |
| nothing | Silence until the result. |

The caller cannot interrupt while a tool runs, unless an aside is on.

A tool with no `response_data` is fire-and-forget: the request goes out, the
agent is told it succeeded and moves on at once, and it never sees the
result. The REST builder's fire-and-forget toggle is exactly that. End-call
and transfer tools are the exception.

### Time limits and repeats

- **REST and connected-service tools** stop waiting after 30 seconds. The
  definition's `timeout` does not shorten or extend that.
- **Custom-code tools** use `body.timeout` (seconds, default 10, at most 60),
  or the definition's `timeout` when `body.timeout` is absent.
- **Retries.** A REST or connected-service call is made once per invocation.
  `max_retries` applies only to tools that run down the old HTTP path.
- **`cooldown`** (seconds, default 4): while a run is in progress, for up to
  that long, a second call to the same tool is refused and the agent is told
  so.
- **`maxCalls`** (default 3 per step per call, 0 = unlimited): after that the
  tool is taken off the agent's list for the step; a call past the limit is
  refused with a message to the agent.

### When a call to the tool fails

The conversation always continues.

- **An error status, or no answer** (status 0, or 400 and above): the agent
  is told the call was unsuccessful. Response routing still runs, so a row on
  the status code can route the caller.
- **The tool could not run** (a required input missing, the library row
  deleted, no staging definition): the agent is told to apologise and offer
  another way to help. No response routing runs.

Every call of an attached tool rewrites the call variables `tool_status`
(`success` or `failed`), `tool_error` and `tool_failure_kind`
(`missing_required_input` or empty), so later steps can route on the latest
result. A variable of your own with one of those names is overwritten.

### After the call

Tool runs write a log row (`/v2/tools/logs`): status, error, duration,
sanitised inputs and sizes, not the response body. Runs against a missing or
disconnected connection, the old HTTP path, and webhook and code steps write
none; use the call's trace. Each logged run also emits a tool success or
failure event that automations can listen for.

## On the dashboard

| Page | What it shows and does |
|---|---|
| `/dashboard/tools` | The org's tools: search, Create tool, per-row Duplicate and Delete. |
| `/dashboard/tools/create` | Pick a kind: REST API (with cURL import), Custom code, or a connected service. |
| `/dashboard/tools/<toolId>` | The builder, a JSON view, a test panel that runs the saved tool for real, and the owner (an agent's Tools tab or the org list). In the code editor, saving code makes a new snippet version and "Save changes" points the tool at it. |
| `/dashboard/tools/analytics` | Runs over time, errors by tool and by type, an error-log drawer; `?tool_id=` filters to one tool. |
| `/dashboard/tools/secrets` | Secrets, static or refreshing, with status and a copy-reference button. Edit rotates, changes refresh settings or pauses. Delete exists only here. |
| `/dashboard/tools/connections` | Connections by integration. Add connection and Reconnect (both need the browser sign-in), Delete. |
| `/dashboard/agent/<agentId>/tools` | Tools the agent owns plus library tools its latest version uses. |
| Agent builder, step inspector | Attach Custom tool, Webhook, Custom code or Tool chain, or an existing tool; set behavior, routing, max calls, the staging switch, the spoken line and tool assist. Copies show "Library copy" with "Update from library"; pointers show "Linked tool". |

Three things the pages do that surprise people:

- **The inspector attaches copies.** `byReference` pointers come from
  imports, migrations and API writes.
- **A dashboard save of a tool drops its staging definition.** If a tool
  relies on `staging_tool`, edit it through the API and send `staging_tool`
  each time.
- **The pages do not poll.** After an API write they show the change on
  reload.

## Rules and limits

Save-time errors (required keys, unknown keys, id formats) are in the
[contract](../../v2-runtime/references/tool-library.md#tool-routes). The
limits that shape behavior:

| Rule | Value | Crossing it |
|---|---|---|
| `timeout` (definition) | 1,000 to 60,000 ms | Used by custom code and the old HTTP path. REST and connected-service calls stop at 30 seconds whatever it says |
| `cooldown` | 1 to 30 seconds, default 4 | A second call while a run is in progress is refused |
| `max_retries` | 0 to 4 | Old HTTP path only |
| `maxCalls` (attached tool) | default 3 per step per call; 0 = unlimited | The tool leaves the agent's list for the step |
| `retryLimit` (attached tool) | saved, 0 to 5 | Does not limit calls today; use `maxCalls` |
| Out-of-range number in a definition | | Save refuses it; inside a snapshot it causes the HTTP-0 trap |
| REST methods | `get` and `post` actions; `body.method` carries PUT, PATCH, DELETE | A body on GET or DELETE is dropped |
| Custom-code `body.timeout` | 1 to 60 seconds, default 10 | 400 on save |
| Snippet | JavaScript; name of letters and underscores up to 100; code up to 200,000 characters | `save_code_snippet` refuses it |
| Secret name | letters, digits, underscore; unique ignoring case | "A secret with this key already exists" |
| Refresh interval | 10 to 1,440 minutes | Clamped into range |
| Secret writes | org admin, owner or operator | 401 or 403 |
| Text message | up to 1,600 characters; E.164 numbers | Validation error on the run |

## When it goes wrong

Start from the tool logs for the call (`/v2/tools/logs?call_id=<call id>`),
the call's trace and the definition; the procedure is
[debug a tool run](workflows.md#debug-a-tool-run).

| Symptom | Likely cause | Confirm with | Fix |
|---|---|---|---|
| Every call fails with "HTTP 0" | The definition fails the runtime check and takes the old HTTP path ([the HTTP-0 trap](../../v2-runtime/references/tool-library.md#the-http-0-trap)) | The trace shows the tool firing; no log row | Fix the definition; `/run`, then one test chat |
| The agent never calls it | Vague description, wrong step, or `maxCalls` used up | No call in the trace, or a "reached its maximum" result | Sharpen the description; attach it where needed |
| `error_type: "ZodError"` | Filled inputs did not fit the action | The row's `inputs` against `input_schema` and `body` | Fix placeholder names or the schema |
| "REST API request failed:" with a status and body | The third party refused | The status in `error_message` | 401/403 secret or connection; 404 URL; 400/422 body |
| "REST API request failed:" with no body, about 30 seconds | Timeout or network | `execution_time_ms` | Make the endpoint faster; `timeout` will not extend it |
| Agent says "done", no variables set | No `response_data`: fire-and-forget | The definition | Add `response_data` rows |
| A connected-service tool stopped one day | The connection was disconnected | No rows since; Tools, Connections shows it disconnected | Reconnect |
| One agent took a library edit, another did not | The other holds an embedded copy | `definition` present, no `byReference` | "Update from library", save, promote |
| A code tool changed with no tool edit | `snippet_version` not pinned; the snippet was saved | `body.snippet_version` absent | Pin the version |
| Wrong value spoken after a success | `response_data` path is wrong | `/run` with the same inputs | Fix the JSONPath |
| A secret stopped resolving | Renamed (name references break), deleted, or refresh paused | The reference form; the secret's status | Reference by id; re-create; resume |

## Questions people ask

**Does editing a library tool change my live agent?**
Yes, if the agent points at it (`byReference` or a `tool` step): the next
call uses the edit, in every environment, with no promotion. An embedded copy
changes only when someone re-copies it and saves a version.

**Do staging and production environments pick the staging and production
definitions?**
No. The environment picks the agent version; the "Use the staging version of
this tool" switch on each attached tool picks the definition.

**How do I know which agents use a tool?**
No list exists. Run the [consumer scan](workflows.md#consumer-scan).

**Why does the agent sometimes not call my tool?**
It decides from the name, the description and the step it is on. A vague
description, the wrong step, or `maxCalls` used up are the usual reasons.

**How long will a tool run before it gives up?**
REST and connected-service tools: 30 seconds. Custom code: `body.timeout`,
10 seconds by default, at most 60.

**Is my API key safe in a tool?**
Keep it in a secret and reference it by id: it is filled in at run time and
scrubbed from results, logs and history. A key typed into a header becomes
part of the definition.

**What happens to my tools when I disconnect HubSpot?**
Every tool bound to it is marked inactive and fails on calls until you
reconnect. Reconnecting restores the connection, not the tools' status, so a
test run of those tools still answers not found.

**Can I test a tool without a call?**
Yes: `/run` with synthetic inputs, or the test panel. Both execute for real.
