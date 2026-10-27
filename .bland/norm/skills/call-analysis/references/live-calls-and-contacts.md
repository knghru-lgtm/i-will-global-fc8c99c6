# Live calls and contacts: routes and workflows

The routes behind the Conversations page's **Active calls** and **Contacts**
tabs, and the workflows that end in a step that cannot be undone. What the
tabs show and why is in [how it works](how-it-works.md#active-calls).

Do not write fetch scripts and do not search the docs for these routes. Read
with `bland_api_get`; write with `call_bland_api` (`method`, `path`, `body`)
or the named tool.

## Contents

- [Active call routes](#active-call-routes)
- [Contact routes](#contact-routes)
- [Stop a live call](#stop-a-live-call)
- [Transfer a live call](#transfer-a-live-call)
- [Look up everything about a caller](#look-up-everything-about-a-caller)
- [Merge two contacts](#merge-two-contacts)

## Active call routes

| Route | Body or query | Answer and notes | Gate |
| -- | -- | -- | -- |
| `GET /v1/calls/active` | none | Array of live calls: `call_id`, `status` (`QUEUED`, `IN_PROGRESS`, `TRANSFERRED`), `from`, `to`, `objective` (first 20 characters), `agent_id`, `inbound`, `started_at`, `start_time` (scheduled calls), `transferred_to`. Org-wide, no agent filter | read |
| `GET /user/logs?includeActive=true` | `take`, optional `scopeFilters` with the agent | The first page adds `data.activeCalls`: live rows with `status` (`queued`, `in_progress`, `transferred`), `agent_id`, `started_at`, `call_length` in minutes so far. Other filters allowed with it: `is_simulation`, `agent_experiment_id`, `batch_id`, `c_id`, operator `equals`; anything else is 400 `INVALID_FILTER`. Not with `cohort` | read |
| `GET /v1/calls/<call id>` | none | The call record. `completed: false` while it runs | read |
| `stop_call` `{ "id": "<call id>" }`, or `POST /v1/calls/<call id>/stop` | none | Hangs up, or cancels a queued call. Repeating it on an ended call changes nothing. 404 "Call not found." or "SID not found for the given c_id." | **confirm** |
| `POST /v1/calls/active/transfer` | `{ "call_id": "<call id>", "transfer_number": "<E.164>" }` | Connects the caller to that number; the agent leaves. 400 `VALIDATION_ERROR`, 400 `NOT_FOUND` (ended or never started), 403 (international limit, phone-plan destination, onboarding demo) | **confirm** |
| `POST /v1/calls/active/stop` | none | Ends every live call in the organisation | **never** |
| `POST /v1/calls/<call id>/listen` | none | A short-lived audio stream for a browser. Norm cannot play or hear it | dashboard only |
| `GET /v1/calls/active/stream`, `GET /v1/calls/<call id>/transcript/stream` | none | Live streams that feed the dashboard | do not call |

An OAuth-connected host can read `GET /v1/calls/active` and the call record,
and can stop one call with `stop_call`. It cannot reach the transfer, listen,
stream or `/user/logs` routes. On `oauth_path_not_allowed` say "this
connection cannot reach <route>; do it on /dashboard/conversations?tab=active"
and stop.

## Contact routes

Base `/v1/contacts`. Org-scoped: another organisation's contact reads as 404
"Contact not found".

| Route | Body or query | Answer and notes | Gate |
| -- | -- | -- | -- |
| `GET /v1/contacts` | `limit` (default 50, max 200), `offset`, optional `agent_id` (a uuid, else 400 `INVALID_AGENT_ID`) | `data`: contacts newest first, each with `identifiers`, `memories` (with `entities`) and `crm_syncs`. `pagination` `{ total, limit, offset, has_more }` sits beside `data` | read |
| `GET /v1/contacts/<contact id>` | none | One contact with identifiers, memories and CRM status | read |
| `POST /v1/contacts/find` | one of `phone_number`, `email`, `external_id` | The contact, or `data: null` when nothing matches exactly. The identifier rides in the body on purpose; never put it in a query string | read |
| `GET /v1/contacts/<contact id>/conversations` | none | `{ conversations[], omitted }`: the 25 most recent calls and threads, oldest first. Each has `kind`, `channel`, `agent_id`, `started_at`, `summary`, `disposition`, up to 300 `messages` (`truncated` when cut), and `memory.learned` | read |
| `POST /v1/contacts/resolve` | an identifier, optional `name`, `metadata` | Finds or creates. 201 with `created: true`, or 200 with the existing contact (name filled only if empty, metadata merged, identifier added) | confirm |
| `PATCH /v1/contacts/<contact id>` | any of `name`, `email`, `external_id`, `metadata` | Name replaces. Email and external id are added beside the old ones. Metadata merges by key. 400 `INVALID_PROFILE_FIELD` with a `fields` map when a value misses its profile pattern or exceeds 256 characters | confirm |
| `POST /v1/contacts/merge` | `{ "primary_contact_id": "<id>", "duplicate_contact_id": "<id>" }` | Moves everything to the primary and deletes the duplicate | **REQUIRED confirm** |
| `GET /v1/contacts/schema` | none | The org's profile fields (defaults when none saved) and presets | read |
| `PUT /v1/contacts/schema` | `{ "fields": [...] }` in display order | Replaces the profile fields for every contact. Owner, admin or operator. 400 `INVALID_PROFILE_SCHEMA` | confirm |
| `GET /v1/contacts/<contact id>/crm-sync` | none | Per-CRM sync status | read |
| `POST /v1/contacts/<contact id>/crm-sync`, `POST /v1/contacts/crm-sync/backfill` | none | Sends one contact, or every contact, to the connected CRM. Not over OAuth | confirm |

There is no route that deletes a contact. Memory routes (what an agent
remembers, and deleting it) are in
[memory records](../../v2-lifecycle/references/api.md#memory-records). The
do-not-call list is in
[phone numbers](../../phone-numbers/references/endpoints.md#outbound-do-not-call-list).

## Stop a live call

Call budget: at most one list read, one stop, one check.

1. Find the call. Take a call id the user gave or that the page shows. Else
   `bland_api_get` `/v1/calls/active` and match by number, agent or status.
   More than one match: list them (number, agent, status, duration) and ask
   which.
2. Confirm, every time:

   ```text
   About to end call <call id> (<from> to <to>, <status>, running <m:ss>).
   This hangs up on the caller now and cannot be undone.
   Reply "yes" to proceed.
   ```

   For a queued call say "cancels it before it dials" instead.
3. `stop_call` with `{ "id": "<call id>" }`.
4. Read `/v1/calls/<call id>` once and report `completed` and `status`. The
   Active calls tab drops the row by itself.

The user says "stop all calls": never use `POST /v1/calls/active/stop`. It
also ends calls you did not show them. List the live calls with their count,
confirm once naming that count, then stop each by id.

## Transfer a live call

1. Find the call as in [stop a live call](#stop-a-live-call). It must have
   connected; a queued call answers 400 `NOT_FOUND`. Do not transfer a call
   whose status is already `TRANSFERRED`.
2. Put the destination in E.164. Check it against the do-not-call list with
   `POST /v1/org_dnc/search` `{ "phone_number": "<E.164>" }`; a hit means
   stop and tell the user.
3. Confirm:

   ```text
   About to transfer call <call id> to <E.164>. The caller is connected to
   that number and the agent leaves the call. This cannot be undone.
   Reply "yes" to proceed.
   ```

4. `call_bland_api` `POST /v1/calls/active/transfer` with `call_id` and
   `transfer_number`. A 403 names the restriction; report it, do not retry.
   On an OAuth connection, send the user to the live panel's
   **Transfer call** instead.

## Look up everything about a caller

A question, so reads only. Call budget: one find, one conversations read,
optionally one do-not-call search, then single-call reads only if asked.

1. Get the identifier. Normalise a phone number to E.164; ask when the
   country is ambiguous.
2. `call_bland_api` `POST /v1/contacts/find` with that identifier. The answer
   holds identifiers, name, profile, each agent's memory and CRM status.
3. `data: null`: there is no contact. Say why it may be missing (memory off,
   or never reached by that identifier), then read calls by number with
   `/v1/calls` `from_number` or `to_number` ([retrieval](retrieval.md)).
4. `bland_api_get` `/v1/contacts/<contact id>/conversations` for the
   timeline. When `omitted` is above zero, say how many older conversations
   are not shown.
5. If the question is about calling them: `POST /v1/org_dnc/search`.
6. Report: who they are, each conversation (date, channel, agent, outcome,
   summary), what each agent remembers, CRM status, do-not-call status.
   Quote transcript lines only where the answer needs them. For why one call
   went wrong, go to [evidence for one call](retrieval.md#evidence-for-one-call).

## Merge two contacts

1. Read both with `GET /v1/contacts/<id>`. Show each one's identifiers, name,
   which agents remember them and how many conversations each has.
2. Ask which is the primary. Its name and profile values win.
3. Confirm:

   ```text
   About to merge contact <duplicate id> into <primary id>: its identifiers,
   memory, calls and threads move to <primary id>, and <duplicate id> is
   deleted. Where both have a name or profile value, <primary id>'s wins.
   This cannot be undone. Reply "yes" to proceed.
   ```

4. `call_bland_api` `POST /v1/contacts/merge`. Read the primary once and
   report its identifiers. The Contacts tab shows the change after a refresh.
