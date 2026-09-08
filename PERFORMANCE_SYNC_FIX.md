# Kelime performance and synchronization fix

## Confirmed causes

`PracticeQuestion` sent every character through `App.saveLearning`. That compared and encoded the full learning state, emitted application updates, and enqueued remote drafts. Workspace renders rebuilt the catalog, learned-word list, and review queue. Guest saves rewrote the recovery envelope and every storage domain. Account refreshes decoded the full projection and persisted the cache again, even for status notifications.

The queue only coalesced adjacent drafts while no sync was running. After a lost response, an attempted draft could be rewritten under the same receipt ID. Generic PostgreSQL exceptions and validation failures were labeled conflicts, and dependent actions inherited that label. Background triggers could shorten backoff. The Account screen combined all entries into one count.

The actual reported 118-entry user cache was not accessed. Tests use an explicit 118-entry fixture; no production queue or account was modified.

## Changes

- Answer text belongs to an isolated form. A 400 ms debounce saves only that text under a project/account, source, session, and question key. Navigation/page hiding flush it; submission, advancement, archival, and deletion remove inactive drafts. Submit receives the latest text and checks question identity before evaluating it.
- Drafts remain device-only. Submit saves feedback; assessment saves its existing event and learning state. Existing remote draft chains remain compatible with server session comparisons.
- Guest recovery envelopes contain changed domains only. Status-only sync notifications no longer decode or resave account data. Catalog/review selectors are memoized. Pronunciation action consumers no longer subscribe to speech-status updates.
- StrictMode remains enabled. Deferred automatic playback survives effect replay; voice listeners are installed and removed with the provider lifecycle.
- Operations are durably saved before attempts, with stable IDs and frozen wire payloads. One processor handles initialization and all sync triggers. Successful operations leave the queue; stale snapshots cannot roll back the acknowledged revision.
- Transient failures use exponential backoff from 1 s to 60 s, pausing after eight consecutive failures. Background triggers respect it. Authentication pauses until refreshed; permanent failures require Retry. Requests have a 15 s timeout. Genuine conflicts and dependent waiting actions remain separate.
- Account displays pending, failed, blocked, and conflict counts separately. Retry is disabled while running. Development diagnostics contain operation identifiers and error categories, not answers, vocabulary contents, or account credentials.

## Queue migration and operation semantics

Cache version 5 reads older localStorage and IndexedDB caches. IndexedDB upgrades preserve the original record under `:pre-v5` in the same transaction; legacy localStorage copies remain preserved. Direct localStorage upgrades also save a `:pre-v5` copy before replacement.

Malformed entries are removed from processing and preserved in quarantine. Exact duplicates are removed. Unknown legacy attempt state is treated as potentially sent. Interrupted processing retains its payload and ID. Recognizable old validation errors become failures; dependency labels do not become extra conflicts.

STATE operations: favorite, preference, learned-flag, and vocabulary state changes. Compatible explicitly unsent changes to the same cells coalesce, preserving the earliest comparison values and latest values. Unrelated state fields can be crossed; attempted actions, events, deletion/reset/migration commands, and overlapping dependencies are barriers.

EVENT/transition operations: start, submit, assessment, and archive retain order and identity. Assessment event IDs and database session/question uniqueness remain intact. Deletion/reset/migration commands preserve their atomic semantics and undo deadlines.

Legacy draft compaction is special: the server verifies a contiguous draft-only chain under the account lock, applies the final state, and records receipts for every original ID atomically. Original operations remain in client backups. Already accepted IDs are reconciled first; ambiguous chains fall back to normal processing and remain preserved if they conflict. Draft compaction never removes submitted answers or assessment history.

Before receipt reconciliation, queued draft text is also copied to device-local draft storage. This protects text changed under an already accepted ID by an older release after a lost response. Accepted draft operations remain in backups rather than disappearing without a recoverable copy.

## Database migration and rollout

Apply `supabase/migrations/005_sync_reliability.sql` **before releasing the client**. It keeps protocol-4 RPC names and structured conflict results compatible with older PWA clients, locks before pronunciation conflict/receipt checks, adds account-scoped receipt reconciliation and draft compaction, and separates genuine conflicts from validation failures (`KS422` or PostgreSQL constraint codes). Existing receipts, RLS, event projections, and tombstones remain in place. Database types and the local SQL harness include this migration.

The migration was executed against the local PGlite test database only. Nothing was deployed to Supabase. Do not roll back by clearing caches or receipts; retain the version-5 client and preserved backups when investigating an upgrade.

## Performance evidence and checks

`node scripts/profile-input.mjs` creates temporary isolated copies of HEAD and the working tree, instruments only those copies, and uses a mock account. It tests a 390 × 844 viewport with development StrictMode and saves measurements to `test-results/input-profile.json`.

For 30 typed characters plus 30 deletions in signed-in offline Daily Test:

| Measured work | Before | After |
|---|---:|---:|
| Workspace renders | 240 | 0 |
| Sync enqueue calls | 60 | 0 |
| Account-cache writes | 180 | 0 |
| Account JSON serialized | about 3.8 MB | 0 |
| Local draft writes after pause | 0 | 1 |
| Speech triggered by typing | 0 | 0 |

The same signed-in **online Daily Test and Review** probes report zero workspace renders, enqueue calls, transport writes, account-cache writes, and pronunciation calls during typing/deletion. History remains unchanged and the input retains its identity. The StrictMode initial pronunciation remains active after effect replay. Automation elapsed times are not real-device latency benchmarks.

Validation includes TypeScript, lint, 113 unit/database tests, production build, and 11 Playwright browser scenarios. Added cases cover queue migration, coalescing, lost responses, durability, backoff, authorization, overlapping triggers, initial-snapshot retry, receipt ownership, SQL draft compaction, direct submission, tombstones, and rapid mobile-size input. Real mobile hardware and a live Supabase account have not been tested.

Manual checks after applying SQL and updating the PWA:

1. Open Daily Test and Review; rapidly type/delete, submit immediately, and move to the next question. Check focus and once-per-question English playback.
2. Type an unfinished answer, navigate away or reload, and resume on the same device. Verify only submitted progress travels to another device.
3. Make offline favorite/preference changes and submit assessments. Reconnect; confirm pending work drains to Synced without losing history.
4. Repeat Retry during network failure, sign out/in, and test two devices editing the same session. Failures should back off; real conflicts should remain visible with preserved originals.
