# Kelime

## Vocabulary selection and data management

Vocabulary has a transient **Select** mode. Selections survive search, filter, and sort changes until you cancel or leave the page. A mixed batch permanently removes personal entries and hides built-in entries. Any unfinished practice containing an affected word is archived first, while assessed answers and historical activity remain intact.

Commands affecting at most 20 words have a durable 10-second Undo period. Account synchronization does not transmit that command until the period expires. Hidden built-ins, including their previous progress and Favorite/Learned state, can be restored from **Account → Data Management**.

Data Management provides three cleanup levels: personal words only, current vocabulary and progress, or all vocabulary-learning data. The last option requires typing `DELETE`; it preserves authentication, the Supabase account, PWA caches, identity high-water marks, and synchronization receipts.

A responsive English–Turkish vocabulary app built with React, TypeScript, and Vite. It works locally by default, with optional Supabase email/password accounts and safe cloud synchronization. No flashcards are included.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. For the built-in test runner, use Node.js 22.18+ or 24+.

## Optional account synchronization

See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for environment variables, executable SQL/RLS migrations, email confirmation settings, and the live verification checklist. Account data uses separate caches and a durable offline queue. Guest data is retained, and migration requires explicit choices. Supabase credentials are never hardcoded.

`npm test` includes embedded PostgreSQL security and transaction tests. `npm run db:types` regenerates database row types from the schema. Live authentication and multi-device tests require a configured test project.

## Features

- 150 built-in English–Turkish entries with curated meanings, parts of speech, and example sentences
- Multiple accepted Turkish meanings and optional explicit English alternatives
- Add Word, editing, and Bulk Add with removable previews, explicit merges, and locally saved vocabulary
- Combined search, status/difficulty/Favorites/part-of-speech/tag filters, eight sorting options, and vocabulary totals
- Editable multiple tags, safe personal-word deletion, Favorites, and a removable Learned collection
- Overall and directional difficulty: New, Easy, Medium, Hard, or Very Hard
- Separate Needs Review indicators for missed or overdue directions
- Adaptive 10-word tests in English → Turkish, Turkish → English, or Mixed mode
- Saved direction preferences, drafts, feedback, progress, and completed summaries
- A separate Review queue with due-word counts, upcoming schedules, and resumable spaced-repetition sessions
- Typed-answer score and accuracy, accuracy per direction, newly learned words, review needs, and the three hardest word-direction pairs

## Add your own words

Choose **Add Word** or **Bulk Add** beside the Vocabulary heading. Single entries require English and Turkish; part of speech, examples, English alternatives, and multiple tags are optional. Bulk Add accepts one entry per line:

```text
discover - keşfetmek
good evening - iyi akşamlar - phrase
well-known - tanınmış - adjective
journey yolculuk
commute - işe gidip gelmek - verb - Work, Travel
```

Actual tab-separated columns also work, including optional third part-of-speech and fourth comma-separated tag columns. Leave the third column blank when supplying tags without part of speech. Multiword phrases require tabs or spaced hyphens; hyphens within words are preserved. Blank lines are ignored. Invalid nonblank lines remain visible with an explanation.

Use semicolons in the Turkish column for multiple meanings: `remember - hatırlamak; anımsamak - verb`. Phrases remain intact. Select **Preview** to see Ready, Merge, Duplicate, Needs resolution, and Invalid rows. Compatible existing words receive append-only meaning and tag merge proposals; existing primary meanings, other metadata, creation dates, and history remain unchanged. Tag-only additions count as merges. Conflicting parts of speech or multiple possible targets require choosing a target or creating a separate entry. Remove rows to recalculate the preview. **Save valid changes** rechecks the current catalog, consolidates repeated batch entries, and reports added and updated counts separately.

**Edit** works for built-in and personal entries. Category/tags use removable chips with suggestions and custom input; part of speech offers suggestions while retaining legacy and custom values. Add, remove, reorder, or make a Turkish meaning primary; optionally supply English alternatives, part of speech, and an example. At least one meaning is required. English-name conflicts require explicit confirmation of a separate entry. Cards show the primary meaning and a keyboard-accessible disclosure for additional meanings. Search includes all meanings, explicit alternatives, examples, and tags.

Personal words use the tags you choose and immediately work in search, Favorites, Learned, and all test directions. They start New with no attempts or memberships. Existing tests remain unchanged; imported words become candidates for the next test. Missing examples and parts of speech are simply omitted.

Version 3 of `kelime-user-vocabulary` stores personal entries, local built-in overrides, durable deleted-ID markers, and the permanent next-ID counter (user IDs start at 1,000,000). Legacy Turkish strings and part-of-speech fields migrate automatically. Old topics become tags (including My words), and explicit empty tags stay empty. New entries record their creation time; older entries have no invented timestamp. Original built-in IDs 0–29 and all personal IDs remain stable. When an expanded built-in conflicts with a compatible existing import, the import is preserved and that new built-in is suppressed. The combined catalog loads before Favorites and learning sessions are validated. Editing or importing must save successfully before the catalog changes; failed writes leave the form available for retry. Learning history remains separate and keyed by ID.

## Managing the vocabulary list

Filters combine with search and the current Vocabulary, Favorites, or Learned collection. Status, difficulty, Favorites-only, and part of speech combine with AND; multiple selected tags match any selected tag. Untagged and Unspecified part of speech are available. Clear filters and search resets the query. Tags replace the old topic control; suggestions include Everyday, Travel, Work, Academic, Food, and Technology plus migrated and custom names. Cards show two tags and disclose additional tags.

Catalog-wide totals show Total, Learned, Learning, New, and Needs Review above the results. Learned is membership; Learning is tested but not Learned; New is neither. Needs Review can overlap these groups. The filtered count remains separate. Untested words do not match Easy.

Sorting includes Default order, A–Z, Z–A, difficulty high/low, recently added, most missed, and least recently reviewed. Stable IDs break ties. New words come after assessed words in difficulty sorting. Least recently reviewed uses the last assessment across both practice features and puts never-assessed words first. Recently added sorts known creation dates first, followed by legacy personal IDs descending, then built-ins in stable order.

## Deleting personal words

Only personal entries offer Delete. Finish any Daily Test or Review containing the word before deleting it, including words already answered in that unfinished session. Confirmation names the word and initially focuses Cancel.

Deletion removes the personal entry, Favorites membership, and all its aggregate/directional learning history. Built-ins cannot be deleted. Completed session snapshots, scores, activity totals, goals, and study days remain historical records; removed entries in completed summaries are labeled Deleted. IDs are never reused, and existing built-in suppression choices remain unchanged.

A durable deletion marker is saved first, then Favorites and history are cleaned. A failed initial write leaves the word intact. Interrupted cleanup shows a notice and retries on reload; loaders exclude deleted IDs so old history cannot reappear. No localStorage reset is required.

## Difficulty and reviews

Learning counters follow “I knew this” / “I didn’t know this,” independently of the typed answer. Each assessment updates aggregate history and only the question’s direction. A word marked known joins Learned; a miss retains membership but resets that direction’s streak. Removing a word from Learned preserves its history.

Difficulty is rounded and clamped to 0–100:

`100 × miss rate + recent-miss bonus − consecutive-known discount`

The bonus is up to 15 points after the latest assessment was missed, decaying over seven days. The discount is five points per consecutive known assessment, capped at 25. Untested words and directions show New with an internal score of zero. Scores 0–25 are Easy, 26–50 Medium, 51–75 Hard, and 76–100 Very Hard.

Each direction has an independent review schedule from its last known assessment: streak 1 → 1 day, 2 → 3 days, 3 → 7 days, and 4+ → 14 days. Days are elapsed 24-hour periods; same-day assessments count. An untested direction is New rather than overdue. A miss in one direction remains review-worthy even after success in the other. Review eligibility refreshes on navigation, test start, return to the app, and once per visible minute.

## Adaptive selection

Selection aims for 3 difficult/weak words, 2 previously missed words, 2 directionally new words, 2 learned words due for review, and 1 random word. Categories can overlap, but each word appears only once per test. Shortages fill from weak, missed, new, due, then other candidates.

Sampling favors directional difficulty, prior misses, and due reviews, while reducing the weight of recently tested words. Mixed chooses each candidate’s direction with weighted randomness, favoring weaker or untested directions. An identical repeat of the preceding ten-word set is prevented when another word is available. Once started, a session’s directions and question order remain fixed.

## Answer checking and summaries

New questions accept any one stored Turkish meaning in English→Turkish, and the English word or an explicitly supplied alternative in Turkish→English. Reverse prompts randomly choose one Turkish meaning at session creation. Answers use Unicode NFC, language-aware lowercase, collapsed whitespace, and ignore trailing periods, commas, exclamation marks, question marks, and ellipses. Turkish letters remain significant: `cagirmak` does not match `çağırmak`. Whole phrases work; no fuzzy matching or inferred synonyms are used. Discovery search remains accent tolerant.

Each question snapshots its prompt, accepted answers, and matching rule. Submitted correctness is stored, so later edits cannot change active questions, feedback, completed scores, or activity. Restored older sessions retain their original single accepted answer and legacy accent tolerance, identified by a practice hint. Feedback lists all accepted answers.

Score and Accuracy measure typed answers. Known and Didn’t know reflect self-assessments. An unused direction shows “—” for accuracy. Review words were previously tested or learned at session start. Review needs and the three hardest word-direction pairs are captured at completion, so later practice does not rewrite old summaries. Difficulty ties use question order.

The direction selector appears before starting and on the completed summary. It changes the next test only. Refresh opens Vocabulary; selecting Daily Test resumes the saved session. Starting another test replaces the previous summary. Tests can be repeated anytime.

## Review queue

Review is separate from the ten-word Daily Test. Its sidebar count is the number of unique words currently due. The queue groups unresolved misses and migrated eligibility under **Needs Review**, elapsed deadlines before the local calendar day under **Overdue**, and deadlines already reached today under **Due today**. **Next scheduled reviews** lists words not yet due, including reviews scheduled later today. Dates use the browser’s locale; intervals remain elapsed 24-hour days.

**Start Review** includes every currently due word once, without a ten-word limit. Only due directions are eligible: unresolved misses take precedence, then higher directional difficulty, older deadlines, and English→Turkish as the final tie-breaker. Questions prioritize misses, migrated eligibility, and oldest deadlines. Untested directions stay outside Review; migrated Learned membership retains its existing English→Turkish eligibility. Removing Learned membership does not erase a tested word’s schedule.

Review uses the same typed-answer feedback and self-assessment rules as Daily Test. Known extends that direction’s streak and next deadline. Missed resets it and makes the word eligible immediately for the next session, without repeating within the active session. The question set stays fixed even when more words become due or Daily Test updates their history.

Use **Back to queue** and **Resume Review**, or navigate away and return. Drafts and feedback survive refresh independently of Daily Test. Completed summaries show reviewed pairs, Known, Missed, typed Accuracy, and tested words still needing review in either direction. Completion snapshots remain unchanged alongside the queue until the next Review starts. There is no review-history archive.

## Progress dashboard

Progress shows vocabulary membership totals, learning percentages, Daily Test scores, directional performance, the ten hardest tested words, and words needing attention. Learned matches its collection; Needs Review overlaps Learned or Learning, so those percentages are not a partition. Scheduled today includes unique words with deadlines on the local date, even later today. Older overdue words appear in Needs Attention.

Daily Test statistics cover recorded assessed questions, completed tests, typed accuracy, and average/best completed scores out of ten. Directional lifetime counts use existing history, while typed accuracy uses available saved results and newly tracked answers. Directional difficulty is the current mean across tested words only. The weaker direction combines `(100 − accuracy)` and average difficulty with equal weights, using unrounded values. Missing data shows **—** or **Not enough data**.

Activity is recorded only when self-assessment advances a question. Its typed correctness is independent of Known/Missed. Daily Test and Review both contribute to the seven-day activity table, lightweight native charts, and daily goal. Choose 5, 10, 15, 20, 25, or 30 questions; the default is ten. Progress can exceed the goal, while the progress bar stops at 100%.

A study day requires completion of at least one Daily Test or Review. Multiple completions on the same date count once. Current streak remains active if the last study day was today or yesterday; otherwise it resets to zero. Best streak and last study date use recorded completion dates, with calendar-day arithmetic rather than elapsed-hour assumptions.

Migration recovers the latest saved sessions’ assessed answers and available completed scores into an undated bucket once. Overwritten tests cannot be reconstructed. Undated activity contributes to recorded accuracy and test totals, but not charts, goals, or streaks. Migrated unfinished sessions count only their future answers toward dated activity; their full score counts when they finish. Days before tracking starts show unavailable activity, and the first tracking day may be partial. Local date keys remain fixed after a timezone change.

Each assessment saves history, session advancement, and activity in one write. Dated aggregates are retained for lifetime totals and streaks; no raw-answer archive is added. Vocabulary and session data survive independent recovery of malformed activity fields.

## Storage and compatibility

`kelime-favorites` remains unchanged. Version 6 of `kelime-learning-state` stores history, direction and pronunciation preferences, the version 4 Daily Test session, the independent version 2 Review session, daily goal, and compact activity aggregates together. Existing records migrate without replacing either session or activity totals. Original vocabulary is retained for legacy session migration. Each self-assessment saves history and question advancement in one write.

Older recorded history migrates into English → Turkish statistics, since that was the only original direction. Reverse statistics start at zero. Legacy Learned membership without recorded attempts remains intact and is immediately review-eligible in English → Turkish without inventing counts or dates. Old sessions retain their words, drafts, feedback, results, and newly learned IDs; their directions become English → Turkish. Old summaries show unavailable historical difficulty/review snapshots explicitly.

Legacy `kelime-learned` and `kelime-daily-test` keys are retained but not reimported once the consolidated record exists. Invalid data is recovered safely; storage failures show a notice while practice continues in memory. Browser data is not synchronized across devices.

## Checks and code organization

```sh
npm test
npm run build
npm run lint
```

Vocabulary lives in `src/vocabulary.ts`. Shared direction/statistics types live in `src/learningTypes.ts`; difficulty and review rules in `src/learningHistory.ts`; selection in `src/adaptiveSelection.ts`; sessions and summaries in `src/dailyTestModel.ts`; migrations and atomic assessment transitions in `src/learningState.ts`. Tests cover the three modes, selection, scoring, review schedules, persistence, migration, and malformed data.

`src/wordFields.ts` validates vocabulary and supplies primary-meaning helpers. `src/answerMatching.ts` isolates strict and legacy matching. Multiple-meaning tests cover Turkish spelling, alternatives, phrases, migration, expansion collisions, built-in overrides, merge resolution, stable snapshots, frozen correctness, preserved learning totals, and quality checks for all 150 built-ins.

Import parsing and preview classification live in `src/vocabularyImport.ts`; user catalog validation and write-first persistence in `src/userVocabulary.ts`; both forms in `src/AddVocabulary.tsx`. Import tests cover delimiters, malformed rows, duplicate promotion, stable IDs, failed writes, and imported questions through restoration and summaries in all modes.

Review scheduling, queue ordering, and session validation live in `src/reviewModel.ts`. `src/PracticeQuestion.tsx` shares the answer flow between Daily Test and Review. Review tests cover interval boundaries, queue grouping, variable sizes, directional selection, imported IDs, session independence, migration, duplicate events, retries, and frozen summaries.

Pronunciation uses the browser Web Speech API through one controller and React provider. Speaker controls are available on vocabulary cards and the single-word editor. English→Turkish practice speaks the frozen English prompt; Turkish→English practice reveals and speaks the frozen primary English answer only after submission. Automatic pronunciation defaults on and can be changed in Account or practice setup. It does not alter scoring, history, activity, or vocabulary records. Unsupported browsers hide speaker buttons and show a small availability note in settings.

Progress activity types, validation, and migration live in `src/activity.ts`; pure dashboard calculations in `src/progressModel.ts`; dashboard rendering in `src/Progress.tsx`. Tests cover zero/partial data, memberships, rankings, scoring, both sources, daily goals, calendar boundaries, streaks, one-time migration, malformed data, and persistence failures.

Catalog querying and counts live in `src/catalogQuery.ts`; deletion eligibility, durable commits, and retryable cleanup in `src/vocabularyDeletion.ts`. Management tests cover combined filters, sorting, tags, blank import columns, creation dates, guarded deletion, failed writes, completed snapshots, and unchanged activity totals.


## Installable app and mobile reliability

Kelime now precaches its production app shell and lazy screens, offers optional installation in Account/More, and prompts before applying updates. Below 768px, bottom navigation replaces the sidebar; More contains Favorites, Learned, Account and Install. Practice offers saved-session continuation and confirmed archival/restart.

Account caches/outboxes migrate transactionally to IndexedDB while retaining the original localStorage recovery copies. Guest storage stays unchanged. Protocol-2 SQL merges distinct assessment events exactly once and preserves separate UUID sessions. Apply `002_events.sql` after `001_kelime.sql` before using cloud synchronization with this client; no live project was modified by this implementation.

See [PWA_SETUP.md](PWA_SETUP.md) for installation, offline testing, icon regeneration, hosting headers, SQL rollout, automated verification and physical-device checks. Run `npm run build` then `npm run test:browser` for production-browser verification (`msedge` channel by default). Run `npm run icons` after changing the source SVG.
