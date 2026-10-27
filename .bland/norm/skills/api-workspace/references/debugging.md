# Debugging loop

**Observe → reproduce → isolate → patch → verify → report.** Begin with one
specific expected behavior and the evidence contradicting it, not a general
rewrite of the agent.

## Collect the smallest sufficient evidence set

- Read the actual call/test run through the API, its target version, and relevant
  configuration. Preserve IDs and timestamps in workspace files.
- Read the transcript and routing/tool evidence together. For simulation traces
  see [testing](../../v2-testing/SKILL.md); for real calls see
  [retrieval](../../call-analysis/references/retrieval.md).
- If the issue concerns the visible page, compare fresh page context and unsaved
  draft with API state using [workspace reconciliation](workspace.md).
- If it concerns sound, retrieve an authorized recording and use
  [voice evidence](../../v2-testing/references/voice.md). Transcript text alone
  is insufficient for timing, overlapping speech, or pronunciation.
- For what ran inside one call (tool logs, knowledge retrievals, memory
  changes, the SIP ladder, platform scores) read
  [evidence for one call](../../call-analysis/references/retrieval.md#evidence-for-one-call).

| Symptom | First discriminating check | Avoid |
|---|---|---|
| Wrong scenario / loop | Actual version, entry edge, current variables, routing priority | Rewriting every prompt |
| Tool did not fire | Was the intended node reached? Does it carry the expected tool/pin? | Assuming a tool failure from absent transcript text |
| Tool failed | Tool log row for the call: none plus "HTTP 0" means a demoted definition; `status: "error"` means upstream | Retrying an external write blindly |
| Missing variable | Initial request data → extraction → tool mapping timeline | Treating final variables as a historical trace |
| Eval failed | Execution error versus a valid non-passing verdict | Calling platform failure a bad agent response |
| Test passed but live call differs | Version/environment/channel and integration differences | Claiming text-test parity with real voice |
| UI shows old content | Fresh resource ID, draft revision, accepted saved state | Resaving blindly or reusing stale element IDs |
| Slow spoken response | Capture timeline by stage and clock | Attributing all delay to reasoning without evidence |

## Account-state evidence

Some failures are not the agent. They are the account. Check these with reads
only, before you change any agent.

| Symptom | Read | What to look for | Where the user fixes it |
|---|---|---|---|
| Calls refused for lack of credits | `GET /orgs/<org id>/billing` | Balance and plan | `/settings/billing` |
| 429 responses, calls or texts throttled | `GET /user/rateLimits` | The limit the caller hit | `/settings/billing` |
| Webhook not arriving | `GET /user/getCurrentWebhook`, then `GET /orgs/<org id>` | The configured URL; `preferences.webhook_excluded_fields` strips fields from the payload | `/settings/organization` |
| Recording or transcript missing | `GET /v1/orgs/<org id>/data-retention` | A retention window shorter than the call's age | `/settings/organization` |
| "Who changed this?" | `GET /v1/audit/logs` (enterprise) | `event_type`, `actor_id`, `created_after`, `created_before`, `page`, `page_size` | none (read only) |

Take the org id from the connection's identity, or from
`GET /orgs/self/memberships` when it is not known.

Rail: **reads only.** For a fix, name the settings page and leave the write
to the user. Never call these, even when asked to "just fix it":

- `/user/newWebhookSecret` (breaks every receiver that verifies signatures)
- `/keys/*` (mints or revokes org credentials)
- `/orgs/<org id>/members*` (access control; invites send email or texts)
- `/recharge/*`, `/pay/*` and billing writes (move money)
- `/v1/releases/*` writes, `/v1/signatures/*` writes, `/sso/*` (platform
  build, token signing, login)

An OAuth-connected host cannot reach these read routes either. On
`oauth_path_not_allowed` name the settings page and stop.

## Patch and regression check

- Preserve an untouched baseline and a reproducible fixture.
- Demonstrate the failure before the change when feasible; otherwise label it
  an unverified hypothesis and explain the missing evidence.
- Use code to make a minimal JSON change. Validate structure and routing, not
  just JSON syntax. Save only within the requested scope, then read back.
- Run the failing case plus neighboring branches and previously passing cases
  on the same saved version. Repeat nondeterministic probes and report counts.
- Treat customer integrations as real unless their sandbox is verified. Keep
  fixtures synthetic and disclose untested side-effecting branches.

## Report

State: cause supported by evidence; changed fields; saved version; run/call IDs;
passed / failed / inconclusive / not-run checks; safe artifact locations; and
remaining uncertainty. A reconnect or error is a visible incomplete outcome,
not a reason to silently declare success.
