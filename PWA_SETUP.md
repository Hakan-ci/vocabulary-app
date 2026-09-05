# Kelime PWA and offline operation

Kelime is a React/TypeScript web app with optional installation. Nothing in this change deploys a site or configures a live Supabase project.

## Run and verify

```sh
npm install
npm test
npm run lint
npm run build
npm run preview -- --host 127.0.0.1 --port 4187
# In another terminal (uses installed Microsoft Edge):
npm run test:browser
```

`npm run dev` remains the normal development command. Service workers are **disabled in development**. Test offline behavior against the production build and preview, not the Vite development server. The Playwright configuration can also start preview automatically. Set its browser channel to a locally installed browser, or install Playwright Chromium and remove the `channel: 'msedge'` setting when running on Linux CI. Browser tooling, PGlite, fake-indexeddb and Sharp are development dependencies only.

## Installation and updates

- Serve over HTTPS; localhost is also permitted by browsers.
- On a supported desktop/Android browser use **Install Kelime** in Account or mobile More. It invokes the browser prompt only after a click.
- On iOS use Safari → Share → Add to Home Screen. Kelime displays these instructions when a browser prompt is unavailable.
- Installation controls disappear in standalone mode. There are no automatic installation popups.
- Updates use the Vite PWA prompt workflow. **Save and update** waits for local account transactions; editor activity or failed writes defer it. **Later** dismisses the notice. An update accepted in another tab does not force this tab to reload; this tab must explicitly accept its own refresh.
- Drafts and feedback are saved as you work. Reopening practice presents Continue and a confirmed restart. Restart archives assessed results without awarding a completion or resetting history.

## What is cached

Workbox precaches the HTML shell, CSS, icons, and every application JavaScript chunk, including Account, Progress, editing/importing, Daily Test and Review. Previously unopened screens work offline after one successful production visit. Only build assets are cached. Supabase requests, authentication responses, credentials, account records and mutations have **no service-worker cache route**. There is no background-sync queue in the service worker.

English pronunciation is generated on the device through the browser Web Speech API. It creates no downloaded audio asset, Cache Storage entry, or service-worker request. Installed iOS and Android browsers can differ in voice availability and autoplay policy; verify automatic prompt/reveal playback and manual replay on each physical target device.

Application repositories store guest data in the existing localStorage keys. Account data and its outbox live in IndexedDB. Local browser data remains private to the browser profile but is not an encrypted vault; sign out before sharing a device. Browser storage eviction/clearing can remove unsynchronized data; cloud synchronization requires the application to be open, online and authenticated.

## IndexedDB migration and account isolation

`kelime-accounts` / `accounts` stores a version-2 cache per Supabase project and user. Each record includes the acknowledged server projection, identity map, pending operation UUIDs, session selections and conflict backups. Each action serializes this cache and its operation in a single read/write transaction. Network dispatch waits for the persistence attempt; failures keep optimistic state and an explicit refresh-loss warning.

On first use, an existing `kelime-account:<project>:<user>:v1` localStorage record is validated and copied transactionally. The committed IndexedDB record is the migration receipt. The original localStorage record remains untouched as recovery material and is never automatically reimported after a successful copy. Do not remove these backups during rollout. Failed migrations can be retried; malformed caches are not silently erased.

An acknowledged account cache opens before authentication refresh finishes. Cached access is not authorization to upload: the same account must have a valid Supabase session. Account scope, guest scope and pending operations remain separate. Explicit sign-out clears the remembered account choice and restores guest data. A browser Web Lock keeps a single account writer per browser profile; other devices can synchronize concurrently.

## Synchronization protocol and SQL rollout

Apply migrations in order to a test project before shipping the client:

1. `supabase/migrations/001_kelime.sql` for new projects only; do not rerun it on an existing installation.
2. `supabase/migrations/002_events.sql` adds the event ledger, session archive field and protocol-2 RPCs. It does not rewrite migration 001.
3. Apply `003_vocabulary_deletion.sql` for vocabulary deletion and reset commands.
4. Apply `004_pronunciation.sql` for the synchronized pronunciation preference and protocol-4 RPCs.
5. Run the two-account/device verification below, then roll out the client.

The first accepted v2 mutation upgrades that account. The legacy writer is locked out after upgrade; it cannot replace event-based progress. Keep queued legacy data until the updated client migrates it. Recoverable pending single assessments retain their operation identity; ambiguous changes become visible conflicts instead of guessed counter increments.

Assessment events carry an event UUID, session UUID/question index, direction, frozen typed correctness, self-assessment, recorded time and local date. The transactional RPC applies distinct-session events in server acceptance order. It increments aggregate and directional counters, uses the monotonic timestamp guard, updates activity and advances the session atomically. Existing aggregate/activity data is the baseline, not replayed as new events. An operation receipt handles lost responses; a unique session/question prevents duplicate answers. Divergent answers stay in the device conflict backup and do not increment counters.

Simple Favorites, Learned membership and settings use explicit last-server-accepted values. Vocabulary edits, deletion and legacy aggregate imports retain explicit conflict resolution. Historical completion summaries stay frozen. Offline completion summaries are labeled provisional until acknowledgement. Session records are keyed by UUID; the current Daily Test and Review selections are separate. A chooser appears when several unfinished sessions are available. Archival preserves the assessed prefix; deletion checks all unfinished sessions, not just the selected one.

Retries run on reconnect, focus, sign-in and manual Retry, with exponential backoff capped at one minute. Pulling occurs every 30 seconds only while visible and online. Status distinguishes Offline, Syncing, Changes waiting, Sync error and Synced. Closed-app synchronization is **not** promised.

## Icons and hosting

`public/favicon.svg` is the existing Kelime book mark. Run `npm run icons` to regenerate 192px/512px PNGs, the 180px Apple touch icon and the padded 512px maskable icon. Sharp rasterizes local artwork; no remote image generation is involved. The maskable foreground fits the central safe circle. Replace the SVG and regenerate all sizes when changing branding.

The Vite base defaults to `/`. If hosting under a subpath, set Vite's `base` (or build with `--base=/kelime/`) consistently with the hosting rewrite and auth redirect URL. Manifest identity/start/scope and icon URLs are relative to that base; HTML asset links use `%BASE_URL%`.

Recommended hosting behavior:

- `sw.js`, `index.html`, `manifest.webmanifest`: `Cache-Control: no-cache`.
- Fingerprinted `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`.
- Serve `sw.js` as JavaScript and the manifest as `application/manifest+json`; never rewrite missing JS/assets to HTML.
- Rewrite application navigation to the base's `index.html`; leave API/auth endpoints outside app-shell fallback.
- Keep the service worker within the intended base scope. Deploy assets before the HTML/service worker and retain older fingerprinted assets long enough for open clients to finish updating.
- Configure Supabase email confirmation redirects for the actual HTTPS application origin/path. Never put service-role credentials in Vite variables.

## Verification coverage and remaining live checks

Automated tests cover the existing local migrations, IndexedDB copy/recovery, retained UUIDs, failed writes, offline cache restoration without authentication, sign-out isolation, event idempotency, different-session merging, same-question conflicts, archival, RLS/anonymous denial, legacy writer protection and frozen completion totals. Production browser tests cover the manifest/icons, service-worker activation, offline reload, unopened lazy screens, drafts/feedback, restart confirmation, update deferral, browser-process restart, drawer focus/Escape, responsive widths and automated accessibility checks.

These tests use a local production server, mocked authentication/storage or embedded PostgreSQL. They do **not** prove live Supabase configuration or physical-device behavior. Before release, verify:

- Real iPhone Safari installation, standalone launch, rotation, safe areas and on-screen keyboard focus/scrolling.
- Android Chrome installation and keyboard behavior, at 375/390/430 CSS-pixel widths where applicable.
- Hosted HTTPS installability, update delivery, subpath hosting if used, and email-confirmation redirects.
- Two accounts cannot read/write each other's rows or reference another account's personal words/sessions.
- Two devices: start separate sessions offline, assess the same vocabulary entry, reconnect in each order and verify both count once. Divergent answers to one shared question must produce a conflict, not two increments.
- Queue actions, close/reopen the browser offline, reconnect with expired credentials, sign in, then sign out and switch accounts. Guest data and queued account operations must remain isolated.
- Archive a partial session; delete a personal word after unfinished-session guards clear; historical totals and snapshots must remain intact.

### Executed validation for this implementation

- `npm test`: 80 passing tests, including embedded PostgreSQL and IndexedDB migration cases.
- `npm run test:browser`: 7 passing production-browser tests in headless Microsoft Edge, including cross-tab update safety.
- `npm run lint`, `npm run build`, `npm run icons`, and generated database types completed successfully.
- Development and production-preview endpoints returned HTTP 200.
- Automated accessibility scans passed for the main screens; responsive checks covered 375, 390, 430, 768 and 1024 pixels plus landscape. Mobile and desktop screenshots were inspected.
- No deployment, live database migration, real authentication flow, or physical iOS/Android installation was performed.
## Offline deletion guarantees

Vocabulary deletion is committed through the application IndexedDB/local-storage transaction rather than the service worker. Small deletions wait 10 seconds before cloud upload so Undo can survive reload. Offline replay retains the operation’s `notBefore` deadline; reconnecting cannot transmit it early. Built-in exclusions and personal tombstones prevent stale devices from restoring removed live data.
