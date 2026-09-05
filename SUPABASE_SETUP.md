# Supabase setup for Kelime

The app works without Supabase configuration. Guest data stays in its existing localStorage keys. Cloud setup is optional; this repository does not create or configure a live project.

## Create a test project

1. Create a project in the Supabase dashboard and retain the database password securely.
2. Open SQL Editor and execute `supabase/migrations/001_kelime.sql`, `002_events.sql`, `003_vocabulary_deletion.sql`, and `004_pronunciation.sql` in numeric order. Apply each migration once; do not delete production tables to reapply it.
3. Enable the Email provider with email/password sign-in. Keep email confirmation enabled. Set Authentication → URL Configuration → Site URL to your app origin, for example `http://localhost:5173`. Add the exact development and production URLs to the Redirect URLs allowlist. Signup uses the current origin and pathname; confirmation redirects are handled by the Supabase client.
4. Copy the project URL and a **public anon or publishable key** from the project connection/API settings. Never put a secret/service-role key or database password in Vite variables.
5. Copy `.env.example` to `.env.local`, fill these values, and restart Vite:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
```

```sh
npm install
npm run dev
```

Open the URL printed by Vite, then Account. Sign up, confirm the email, and sign in. Missing/invalid configuration leaves local mode available. For production email delivery, configure your SMTP provider and check the provider's limits in Supabase.

Official references: [password authentication](https://supabase.com/docs/guides/auth/passwords), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Database contract and security

The migration creates `profiles`, `user_vocabulary`, `learning_progress`, `test_sessions`, and `test_answers`. Supporting tables are `account_records`, `builtin_overrides`, `migration_receipts`, and `operation_receipts`.

`account_records` stores fine-grained versioned application records for preferences, activity baselines, current Daily Test/Review sessions, vocabulary, and tombstones. Requested relational tables are projections maintained **in the same transaction**, never independent writes. Historical session and answer rows remain after a new session starts or a personal word is deleted. Unknown legacy timestamps remain null.

Every exposed table has RLS. Anonymous access is denied. Authenticated users can select their own rows; direct mutations are revoked. Only `kelime_apply` may mutate account data, with `kelime_snapshot` creating the caller's profile on first access. These functions use an empty search path and obtain ownership from `auth.uid()`. A queued operation's expected account must match the authenticated user. Personal references and session ownership are validated inside the transaction. Do not grant direct table writes to the frontend: that would bypass atomic progress updates and revision checks.

Built-ins use `b:<stable numeric ID>` references (currently 0–149), and stay shipped with the app. Only local overrides/suppression decisions are uploaded. Personal words use `u:<UUID>` references. A separate persisted map adapts these to permanent numeric application IDs on each device; English spelling never establishes identity. Extend the built-in ID validation in a new SQL migration if the shipped collection later grows.

`kelime_apply` locks the caller's profile row, compares changed records with their expected prior values, projects all affected rows, and records an operation receipt atomically. Replaying an acknowledged operation UUID returns the current account snapshot without applying it again. Stale edits retain their original operation for conflict review. Conflicting assessments keep the accepted account session; rejected device answers are backed up and never counted twice. Concurrent changes to the same activity bucket are deliberately treated as conflicts rather than guessing whether their counters overlap.

Review eligibility remains calculated from directional history and the current time in the app. Database `needs_review` and `next_review_at` fields are mutation-time snapshots, not continuously updated flags.

## Guest migration and offline behavior

On first account entry with meaningful guest data, Account offers **Sync local data to account**, **Keep account data**, or **Cancel**. No upload occurs during preview. Import first saves a versioned device backup and persistent dataset identity. Matching personal words are only suggested candidates; link explicitly or retain separate entries. Conflicting content, whole history records, preferences, sessions, and activity buckets require a device/account choice. Counters with unknown overlap are never added together. Deleted guest IDs cannot delete unrelated account vocabulary.

The approved migration uses an account revision check and a dataset receipt. If the account changes during preview, review the refreshed choices. Interrupted imports retain their operation UUID. Existing activity baselines and available historical answers are imported without recounting them as new activity. Older overwritten sessions cannot be reconstructed and are not invented.

Guest keys remain `kelime-user-vocabulary`, `kelime-learning-state`, and `kelime-favorites`, plus their existing migration keys. A recovery envelope makes new guest writes recoverable across partial failures. Account caches use `kelime-account:<project>:<user>:v1`, including identity maps, pending operations, and conflict backups. Device import backups use `kelime-migration-backup:*`. Signing out restores the guest dataset without copying account data into it. Do not clear browser storage while pending actions or local-only backups are needed.

A browser Web Lock permits one active account tab per browser, preventing competing tabs from overwriting the same local queue. A second tab stays local and asks you to close the first tab and retry. Independent browsers/devices continue to use server revision checks. HTTPS (or localhost) is required for account synchronization.

Actions update the local projection and a durable operation queue. Draft writes are debounced; learning actions queue immediately. Retry happens after reconnect/sign-in/focus, manually, and with exponential backoff capped at 60 seconds. Visible online accounts pull every 30 seconds. Pending or conflicted actions are never labelled Synced. Storage failures show a separate warning: in-memory changes may be lost on refresh until browser storage works again. After a session conflict, continue with the accepted account session; the original device action remains inspectable in Account.

## Checks and generated types

```sh
npm test
npm run lint
npm run build
npm run db:types
```

`npm test` includes local migration/query/practice tests, mocked transport tests, and actual PostgreSQL SQL tests using the development-only PGlite engine. The SQL fixture provisions a minimal Auth identity function/roles in an isolated in-memory database. It checks anonymous denial, cross-user isolation, RPC ownership, transaction rollback, receipts, complete practice flows, and deletion/history retention. It does not test the hosted Auth service, SMTP, or live PostgREST configuration.

`npm run db:types` generates `src/data/database.types.ts` from the executable schema's column metadata. Application models remain separate. When adopting Supabase CLI-generated types for a deployed project, run `supabase gen types typescript --project-id YOUR_PROJECT_ID --schema public` and compare the result with this contract; do not put management tokens in frontend environment variables.

To repeat the security assertions on a disposable Supabase database, apply the migration first, then execute `supabase/tests/security.sql` as its database administrator. The assertions use two test users and roll back all fixtures. Do not run fixture setup against production user accounts.

For browser development checks, open `/tests/browser/account.html` through Vite. This isolated fixture uses a mocked repository/auth flow and `kelime-fixture:*` storage keys, and has simulated offline/online controls. It neither accesses real account credentials nor modifies guest keys. It is not included in the production build.

## Two-account / two-device live verification

These checks require a configured disposable project and remain a deployment gate:

- Register accounts A and B, test confirmation redirects, incorrect passwords, sign-in and sign-out. Confirm B sees none of A's words, progress, answers, or records through both UI and REST requests.
- On device 1, import guest data into A. Exercise duplicate linking/separation and conflicting progress/activity choices. Confirm IDs, Favorites, Learned, overrides and both unfinished sessions survive. Repeat import after a simulated lost response and confirm no duplicate attempts or activity.
- On device 2, sign into A and choose account data. Verify the personal-word UUIDs and learning totals agree, and resume Daily Test and Review from answering and feedback phases.
- Disconnect device 1, favorite/edit/add a word and answer questions, then reload offline. Reconnect and confirm the queue drains once. Repeat with a dropped HTTP response after a successful commit.
- Edit the same word and answer the same session question on both devices. Confirm conflict review retains the rejected action, preserves the first accepted answer, and does not increment progress twice. Check unrelated Favorites changes can still sync.
- Delete a personal word after completing its practice sessions. Confirm device 2 receives the tombstone and cannot resurrect it from an old cache; historical scores and snapshots remain. Attempt deletion during an unfinished remote session and confirm rejection.
- Sign out of A with pending changes and sign into B. Confirm A's actions remain isolated and resume only for A. Guest vocabulary must remain unchanged.
- Check Account, import previews and practice at desktop, 390px and 320px, including keyboard focus, notices and retries. Verify storage-quota failures retain an explicit refresh-loss warning.


## Protocol 2 / PWA rollout

Apply `supabase/migrations/002_events.sql` **after** migration 001; existing installations must not rerun 001. The added RPCs `kelime_snapshot_v2` and `kelime_apply_v2` retain ownership/RLS and transactional receipts, add ordered assessment events, and preserve UUID-addressed sessions and archives. Existing history/activity remains the baseline. The first v2 write upgrades the account and blocks older snapshot writers under the same profile lock. Pending legacy operations remain locally recoverable; ambiguous assessments require conflict review.

Run `npm run db:types` to regenerate TypeScript rows from all executable migrations. `npm test` executes SQL and event scenarios in embedded PostgreSQL without reading `.env.local` or contacting a live project. See [PWA_SETUP.md](PWA_SETUP.md) for IndexedDB migration, acceptance ordering, offline behavior, SQL rollout and the two-device/live authentication checklist. Production offline tests use `npm run build` followed by `npm run test:browser`.
## Protocol 3 vocabulary deletion

Existing projects must apply `003_vocabulary_deletion.sql` after `001_kelime.sql` and `002_events.sql`; never replace the older migrations. Migration 003 adds per-account hidden built-ins, transactional batch deletion/restoration/reset operations, durable receipts, tombstones, a reset epoch, RLS, and an old-client write lock. The frontend continues to use only the anonymous key.

## Protocol 4 pronunciation preference

Apply `004_pronunciation.sql` after migration 003. Protocol 4 adds the validated `setting/auto-pronunciation` account cell and v4 snapshot/apply RPCs. The preference uses the existing IndexedDB outbox, revision checks, receipts, and retry behavior. After an account accepts a protocol-4 write, protocol-3 and older writers are blocked so they cannot erase a setting they do not understand. No audio, voice data, or vocabulary pronunciation field is uploaded.
