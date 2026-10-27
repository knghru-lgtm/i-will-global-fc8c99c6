# Speech-to-speech: what constitutes evidence

## Choose the test surface deliberately

| Surface | Can establish | Cannot establish alone |
|---|---|---|
| Snapshot/schema checks | Structural validity, references, declared inputs | Conversation quality or audible behavior |
| Text simulation / test chat | Content, routes, tool behavior with fixtures | Real microphone/playback latency or interruption cutoff |
| Browser voice preview | Audio behavior in that browser/device path | Telephone-carrier behavior or every user's device |
| Authorized phone call | Behavior on the actual call path, on the version the number resolves | The dev head, untested channels, or concurrent load |

A phone test of inbound voice runs whatever the number resolves: the
production pin, or the staging pin when the number is staging-attached. It
never runs the dev head, so promote (or stage) the version first and record
which version answered. Place it with `create_call` to the agent's bound
number, `from` a number on the account; see
[real phone call](probes.md#real-phone-call).

Use a synthetic agent/fixture with no unapproved external actions. Transfers,
messages, bookings, and live integrations can have real effects even during
testing. Existing permissions and the user's authorized scope still apply.

## Use available voice primitives, not invented tools

Inspect the connected voice-test tools and their schemas. When the host offers
a test-program primitive, let it prepare caller audio and execute event-driven
steps; request its supported panel binding so the user can observe. Do not
require dashboard clicks to start a program when the voice bridge can bind it.
Do not assume every host ships this bridge. Report missing capabilities clearly.

Keep the timing loop out of the planning conversation. An interruption scheduled
“300 ms after actual agent playback starts” should be triggered by the runner's
playback event, not by waiting for Norm to reason, click, then issue another
tool call. Preparing audio ahead reduces test-driver delay, not necessarily the
voice agent's own response latency.

For adaptive tests, use a caller policy that reacts naturally to the response
and record its decision/audio preparation time separately. Do not compare its
turn latency with pre-rendered deterministic audio as though they were equal.
A bounded test program and an adaptive conversation are complementary.

## Minimum useful test matrix

- Happy path: greet, exchange required information, confirm, finish.
- Interrupt at early/middle/late audible speech; confirm cutoff and recovery.
- Interrupt with a changed intent or corrected value; verify the new value wins.
- Several consecutive interruptions; check stale audio does not replay.
- Brief hesitation versus true end-of-turn; silence, timeout, and recovery.
- Noisy or ambiguous input; short acknowledgment versus substantive answer.
- Long response / multi-turn conversation; verify later turns, not only greeting.
- Tool delay/failure; no overlapping stale response after the tool completes.
- Stop/cancel and reconnect; no unintended speech or duplicate session.

Only claim rows actually exercised. Mark unsupported/unmeasured rows explicitly.

## Capture a timeline with clock provenance

Where supported record: caller audio start/end, detected speech end, first agent
audio received, actual playback start, interruption onset, actual playback stop,
and resumed agent playback. Retain recordings and relevant event IDs.

- Response gap = actual agent playback start minus caller audible speech end.
- Interruption cutoff = actual agent playback stop minus interruption onset.
- Record test-driver preparation time independently from response gap.
- Use a shared monotonic clock or a measured synchronization offset. Browser,
  server, and recording timestamps are not interchangeable by default.
- Report the observed sample count, individual outliers, and distribution;
  define the requested latency budget before claiming success.

**A transcript and an empty SDK playback queue do not prove the agent stopped
audibly.** Queue drain can precede buffered device output. Require actual
playback instrumentation and/or aligned recorded audio. Likewise, generated
text or received audio bytes do not prove the user heard them.

Listen to authorized recordings when the toolchain permits, especially overlap
and recovery segments. Automated audio analysis can supplement, but not invent,
that evidence. If listening/playback measurements are unavailable, state that
the audible claim is unverified. Never promise “zero latency.”

## Diagnose delay by stage

Separate caller decision/audio preparation, upload, speech detection, response
generation, synthesis, transport, buffering, and playback where measurements
exist. A slow overall turn is not proof that model reasoning caused it. Change
one factor at a time and repeat the same fixture/version/channel.

Report: agent version and channel, test program/policy, completed scenarios,
recording/evidence locations, clock basis, timing results, content/routing
outcome, failures, and untested paths. Avoid internal model/provider names.
