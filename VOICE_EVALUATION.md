# Opt-in voice pilot evaluation

This checklist is deliberately outside `npm test` and Playwright. No real audio was sent during implementation. Automated voice tests use injected transports and fake browser media only.

## Preconditions

An operator must explicitly opt in, have an allowlisted authenticated test account, apply migrations through 008 to the intended test environment, configure the existing text evaluator and voice secrets, deploy the function there, and verify cleanup heartbeat and forced hangup. This repository does not deploy or enable the pilot automatically.

Use only vocabulary and speech suitable for sending to OpenAI. The app does not record audio or retain transcripts; OpenAI has separate retention policies. Disable browser traces, HAR capture, screen/audio recording, console payload logging and analytics. Record only pass/fail observations, sanitized latency/usage figures and qualitative findings without quoting speech.

Set an evaluation ceiling of **$1 total estimated**, including text evaluation. Run at most **two two-minute voice connections**, no automatic reconnects, and at most one final evaluation per connection. Check combined reserved/spent costs before each connection; do not begin if the remaining ceiling cannot cover the voice reservation plus text evaluation. The application still enforces its per-user/global daily budgets. Stop on unexplained usage, absent supervisor, or unconfirmed shutdown.

## Cases

1. Start independent Automatic Practice; confirm AI voice disclosure and intentional microphone permission.
2. Use a normal English sentence with a target, then a short answer. Check natural follow-up and captions.
3. Use Turkish-accented English and a longer sentence; compare heard text without editing it.
4. Interrupt the tutor. Verify coherent continuation, no duplicated learner evidence and no overlapping browser pronunciation.
5. Request a brief Turkish clarification, then return to English.
6. Use a target correctly, a different target incorrectly, and leave another unused. Include a grammar-only mistake with correct vocabulary use.
7. If practical, introduce ordinary room noise. Record recognition quality separately from structural correctness.
8. End Practice. Confirm audio capture stops, review captions, and exclude a misheard segment.
9. Request feedback. Require valid learner evidence references, unused words marked unattempted, and no vocabulary failure/review suggestion caused solely by grammar. Inspect compact evidence for absence of text/audio.
10. Confirm Review remains unchanged until Add Selected to Review. Normal Review assessment remains the mastery boundary.

Use the second connection for deadline/connection tests: warn near expiration, server hangup at the limit, browser closure, and cleanup after abandoning a tab. Do not extend a connection to complete more cases. If a reconnect case is needed, count it as the second paid connection.

## Release gate

Keep `AI_PRACTICE_VOICE_ENABLED=false` until real browser/device checks, server supervision, cleanup, usage reconciliation and contextual-quality checks pass. Test laptop speakers and a phone; headphones are optional. An automated fake transport cannot establish acoustic quality, real barge-in behavior, production Edge runtime compatibility or actual billing.

Record the date, environment, exact model, tested browser/device, cases passed/failed, estimated/reported cost, whether any audio was sent, and unresolved issues. Do not attach recordings or transcripts.
