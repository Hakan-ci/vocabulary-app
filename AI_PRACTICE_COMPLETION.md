# Independent AI Practice and voice — local completion report

## Delivered behavior

- Daily Test and AI Practice are independent desktop/mobile navigation choices; mobile Progress moved to More. Optional quiz follow-up remains.
- AI Practice starts from 1–8 deterministic automatic targets or searchable manual choices. Selection uses existing review/difficulty/history/evidence signals, preserves direction and frozen matching snapshots, and never alters mastery.
- Modes: Use the Word, Conversation — Text, separately gated Conversation — Voice, and renamed Translation Check (typed). Historical `voiceAnswer` remains compatible and makes zero model calls.
- GPT-Live 1 / WebRTC voice uses server-mediated SDP, native Deno sideband control, locked browser event permissions, explicit microphone permission, ordinary browser echo/noise controls, native interruption handling, mute/push-to-talk and pronunciation exclusion.
- Heard text stays transient. End Practice stops media and opens transcript review. Only selected learner segments go to the existing structured text evaluator. No realtime utterance directly changes learning state. Failed evaluation is retryable without duplicating learner turns.
- Version-2 compact provenance is backward-compatible; independent sourceQuizId is null. The existing durable completion, explicit Add Selected to Review, observed-request resolution and reset boundaries remain authoritative.
- Migration 008 adds operational records/RPCs with no browser grants, shared text/voice budget locking, rate/concurrency limits, a 120-second deadline, server shutdown and fail-closed cleanup health.

## Verification

| Command/check | Result |
| --- | --- |
| Node 24 `npm test` (unit/database/sync) | Passed: 26 test files, including PGlite database and sync regressions. |
| `npm run lint` | Passed, no warnings. |
| `npm run build` | Passed TypeScript and production/PWA build. |
| Node 24 `npm run db:types` | Passed; generated types include migration 008 tables. |
| Deno `check --config supabase/functions/ai-practice/deno.json supabase/functions/ai-practice/index.ts` | Passed using Deno 2.9.6. |
| `PLAYWRIGHT_CHANNEL=chromium npx playwright test` | Passed: all 18 production browser tests. |
| `PLAYWRIGHT_CHANNEL=chromium npx playwright test --config=playwright.ai.config.ts` | Passed: 11 tests. |
| Focused independent production browser suite | Passed: 2 tests, including 320/390px layouts and accessibility. |
| `git diff --check` | Passed. |

Test output lives in `/tmp/voice-unit.log`, `/tmp/voice-build.log`, `/tmp/voice-production-browser.log`, and `/tmp/voice-ai-browser.log`. New tests use mocked media/transport/provider responses. They do not substitute for live acoustic or billing validation.

## Deployment requirements and limitations

Apply migrations through **008** before the client; 006/007 were not edited. Keep learning state 7, cache format 6, and protocol 5. Update older clients to understand new evidence metadata. Operator instructions and current official model/API sources are in [AI_PRACTICE.md](AI_PRACTICE.md); scheduler setup is [scripts/configure-voice-cleanup.sql](scripts/configure-voice-cleanup.sql).

Voice defaults off and is account-allowlisted. It requires a deployed runtime supporting native authenticated WebSockets and `EdgeRuntime.waitUntil`, healthy authenticated minute cleanup, and validated deadline hangup. A lost provider creation response with no provider ID fails closed and requires operator investigation; no automatic paid retry or exactly-once billing guarantee. Budget reservations are conservative estimates, not hard invoice guarantees during external outages.

Live provides transcript fragments, not guaranteed final conversational turns. Application grouping and learner exclusions help, but recognition/contextual judgments can still be wrong. Activity indicators are approximate browser audio-level observations. Reconnection starts a new billed connection with bounded local text history; refresh discards transcripts. Browser autoplay/microphone/device behavior and real barge-in quality require opt-in device testing.

**No real audio was sent to OpenAI. No paid provider evaluation, live deployment, migration, secret upload, allowlist expansion, or global feature enablement was performed.** The pilot remains disabled. Follow [VOICE_EVALUATION.md](VOICE_EVALUATION.md) for the separately authorized, bounded live release checks; do not record audio/transcripts.

## Exact file inventory

### Created

- `AI_PRACTICE_COMPLETION.md`
- `VOICE_EVALUATION.md`
- `scripts/configure-voice-cleanup.sql`
- `src/aiPractice/VoicePractice.tsx`
- `src/aiPractice/voiceSession.ts`
- `src/aiPractice/voiceTransport.ts`
- `supabase/functions/ai-practice/supervisor.ts`
- `supabase/functions/ai-practice/voice.ts`
- `supabase/migrations/008_independent_ai_voice.sql`
- `tests/ai-browser/voice.spec.ts`
- `tests/independentAI.test.mjs`
- `tests/pwa/independentAI.spec.ts`
- `tests/voiceBackend.test.mjs`
- `tests/voiceSql.test.mjs`
- `tests/voiceTransport.test.mjs`

### Modified

- `AI_PRACTICE.md`
- `README.md`
- `scripts/generate-db-types.mjs`
- `src/App.css`
- `src/App.tsx`
- `src/MobileNavigation.tsx`
- `src/Pronunciation.tsx`
- `src/aiPractice/AIPractice.tsx`
- `src/aiPractice/contextBuilder.ts`
- `src/aiPractice/learningEvidence.ts`
- `src/aiPractice/practiceModel.ts`
- `src/aiPractice/practiceService.ts`
- `src/aiPractice/targetWordSelector.ts`
- `src/data/database.types.ts`
- `src/pronunciationContext.ts`
- `supabase/functions/ai-practice/contract.ts`
- `supabase/functions/ai-practice/deno.json`
- `supabase/functions/ai-practice/handler.ts`
- `supabase/functions/ai-practice/index.ts`
- `tests/browser/aiPractice.tsx`
- `tests/dbHarness.mjs`
- `tests/pwa/app.spec.ts`
