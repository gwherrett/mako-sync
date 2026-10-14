# Manual Match Review: Architecture + UI Plan

**Status:** Backlog. Phase 0 done ([MAK-151](https://linear.app/mako-sync/issue/MAK-151)). Phase 1 is blocked on the full-sync fix ([MAK-152](https://linear.app/mako-sync/issue/MAK-152)).
**Linear project:** [Manual Match Review](https://linear.app/mako-sync/project/manual-match-review-67092b2d3c1b)

---

## Context

Mako-Sync's original design was to filter the Spotify-vs-local collection by super-genre/genre and then match automatically within that subset. In practice, metadata variation across sources (MediaMonkey tags, Spotify API data, mix/version naming, feat.-artist formatting, etc.) makes fully automatic matching unreliable enough that trusting it blindly isn't viable.

The new direction keeps the genre/super-genre filter as a way to narrow a working subset, but replaces "trust the algorithm" with a **human-in-the-loop review step**: within a filtered subset, the user confirms, rejects, or manually pairs candidate matches. Confirmed exact matches are auto-accepted to keep workload sane; everything else (core-title matches, fuzzy matches, no-match tracks) goes through explicit human review. A bonus goal is that every human decision (confirm, reject, or manual pick) becomes durable, structured data — first for immediate use (skip already-decided pairs on future syncs), and eventually as training/reference data for building systematic automated-matching rules.

This document covers two approved plans, in sequence: (1) the backend/data-model architecture, (2) the UI that consumes it.

---

## Part 1 — Backend/Data-Model Architecture

### Current State (verified)

- **`src/services/trackMatchingEngine.ts`** — stateless 3-tier matcher (Tier 1 exact, Tier 2/2b core-title, Tier 3 fuzzy ≥85% Levenshtein, same-artist only at every tier — no cross-artist fuzzy candidates). Bug: Tier 1/2 branches of `matchTrack()` (lines ~228-238) return a match without attaching `matchedLocalTrack` (only Tier 2b/3 do) — needs fixing since persisting a confirmed match requires the local track id.
- **`src/services/trackMatching.service.ts`** — `findMissingTracks()` re-implements the tier logic inline (duplicates, doesn't call, the engine) and **discards matched tracks**, returning only misses. Genre filtering (`applySuperGenreFilter` → genre → artist cascade) applies only to the Spotify side; local files are always fetched unfiltered. Nothing is ever persisted — every "Analyze" click recomputes from scratch.
- **`track_matches` table** — already exists in Supabase (`mp3_id`, `spotify_track_id`, `match_method`, `match_confidence`, `is_confirmed`, `matched_at`), RLS scoped to `auth.uid()`, but **no `CREATE TABLE` migration exists in `supabase/migrations/`** (only RLS-policy migrations reference it) and **no application code reads or writes it today**. It was likely hand-created via the Supabase dashboard. The live schema was inspected in Phase 0; see the findings there. Note that `spotify_track_id` is a uuid FK to `spotify_liked.id`, not Spotify's own track id (`spotify_liked.spotify_id`).
- **Genre taxonomy asymmetry** — `spotify_liked.super_genre` is a proper enum driven by `spotify_genre_map_base`/`spotify_genre_map_overrides`. `local_mp3s.super_genre` is raw, unmapped ID3 "Grouping" text with no reconciliation to the same enum/mapping tables. (Per the decision below, v1 sidesteps this rather than fixing it.)
- **Precedent UI pattern** — `src/components/NoGenreTracks/` (`NoGenreTracksProcessor.tsx` + `ArtistGroupedProcessor.tsx`/`TrackLevelProcessor.tsx`) already implements a batched, human-in-the-loop approve/reject/manual-pick flow for genre suggestions. This is the structural template the "Review Matches" UI follows (see Part 2).
- **Eval pipeline** — `src/services/__tests__/trackMatchingEval.test.ts` + `eval-cases.json` (339 cases) is a separate, offline, spreadsheet-based version of essentially the same "human labels candidate match/no-match" workflow (`scripts/export-eval-cases.sql` → CSV → review → merge back). This pipeline was run once and the eval landscape has moved on since; it is explicitly **not** being touched, unified, or replaced by this change. Treat any eval-infrastructure refactor as its own separate, phased project to take up after this implementation ships — this plan only keeps the new `failure_category` column's vocabulary loosely compatible in case that future project wants to draw on `track_matches` data, without committing to any specific merge design now.

### Decisions (confirmed)

1. **Tier 1 (exact) auto-confirms without review.** Tier 2 (core-title), Tier 3 (fuzzy), and no-match tracks always require explicit human confirm/reject. This is validation-of-suggestions where the engine has signal, not blind manual pairing for every track — keeps review workload scoped to genuinely ambiguous cases.
2. **Local-side genre filtering for v1 = artist-overlap only.** `local_mp3s.super_genre` (raw ID3 Grouping text) is not reconciled with the Spotify-side mapping tables in this change. Local candidates are scoped by artist overlap with the genre-filtered Spotify subset instead (the engine already requires exact-artist match at every tier, so this doesn't lose real matching power — it just means a "Genre: House" review session won't surface a local file whose own Grouping tag disagrees). Reconciling local genre tags is a separate, later project.

### Implementation Plan

#### Phase 0 — Verify live schema (done, [MAK-151](https://linear.app/mako-sync/issue/MAK-151))
The live `track_matches` table was inspected directly in Supabase on 2026-10-13, because no `CREATE TABLE` migration exists to rely on.

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `id` | uuid | NOT NULL | `gen_random_uuid()` |
| `spotify_track_id` | uuid | NOT NULL | none |
| `mp3_id` | uuid | NOT NULL | none |
| `match_confidence` | numeric | yes | none |
| `matched_at` | timestamptz | yes | `now()` |
| `match_method` | text | yes | `'auto'` |
| `is_confirmed` | boolean | yes | `false` |

- **Keys and indexes:** only the primary key `track_matches_pkey` on `(id)`. There are no other unique constraints or indexes.
- **Foreign keys:** `mp3_id → local_mp3s(id)` and `spotify_track_id → spotify_liked(id)`, both **ON DELETE CASCADE**.
- **RLS** (enabled; permissive, `public` role): SELECT, UPDATE and DELETE are allowed when the Spotify track **or** the MP3 belongs to `auth.uid()`. INSERT `WITH CHECK` requires the Spotify track **and** the MP3 to belong to `auth.uid()`. UPDATE has no `WITH CHECK`, so Postgres reuses its `USING` (OR) expression as the check.
- **Data:** 0 rows, so neither planned partial unique index has a conflict.

**What this changed in the plan:**

- Two existing defaults conflict with the planned row semantics. Phase 1 now drops both.
- The RLS changes in Phase 1 are now spelled out exactly.
- The cascade on `spotify_track_id` led to a blocker: a full Spotify sync would delete every review decision. See "Phase 0.5" below.

#### Phase 0.5 — Make full Spotify sync non-destructive ([MAK-152](https://linear.app/mako-sync/issue/MAK-152), blocks Phase 1)
**Problem:** a full sync (`spotify-sync-liked/index.ts`, ~line 382) deletes all of a user's `spotify_liked` rows, then re-inserts them with new ids. Because `track_matches.spotify_track_id` cascades on delete, this would wipe every confirmed match, rejection and confirmed-missing row, which defeats the goal of keeping decisions durable. Incremental syncs are fine: they upsert on `(user_id, spotify_id)`, which keeps row ids. Unliking a track also cascades, which is the behaviour we want.

**Decision (approved 2026-10-13): Option A, make full sync non-destructive.**

- **Remove the upfront delete-all.** The batch upsert already keys on `(user_id, spotify_id)`, so existing rows keep their ids. Full sync already ends with a pass that deletes tracks no longer liked on Spotify (~line 794).
- **Fix the end-of-sync deletion pass for resumed runs.** A sync pauses when it hits the 120s budget or a 429, then resumes in a new invocation. `allSpotifyIds` lives in memory and starts empty on every invocation, so on a resumed full sync the pass deletes every track synced before the pause. This is an existing bug, and the pass becomes the only cleanup path once the delete-all is gone. Suggested fix: stamp each upserted row with the current sync id and, at the end, delete the user's rows that weren't stamped by this sync. The alternatives are listed in MAK-152.
- **Delete the unused `clearAndInsertSongs`** in `database.ts`. It has no callers and does the same delete-all.
- **Out of scope:** the `manualGenreMap` cache that restores manual genre overrides after the wipe (NFR-9). It does no harm without the wipe; removing it is a separate cleanup.

**Rejected: Option B,** keying `track_matches` on `(user_id, spotify_id)` with no FK to `spotify_liked`. Decisions would survive any resync, but unliking would no longer clean up rows on its own, every join would go through the natural key, and Phase 1 would become a bigger rewrite of the table.

#### Phase 1 — Schema migration ([MAK-153](https://linear.app/mako-sync/issue/MAK-153))
One new migration, `supabase/migrations/<timestamp>_extend_track_matches_for_manual_review.sql`. The key columns and FKs stay as they are, per the Phase 0.5 decision.
- `ALTER COLUMN mp3_id DROP NOT NULL` — allows a row to mean "confirmed: no local match exists" (`mp3_id = NULL`, `is_confirmed = true`).
- `ALTER COLUMN is_confirmed DROP DEFAULT` — the live default is `false`. Under the tri-state semantics below, an insert that leaves the column out would otherwise be saved as a rejection.
- `ALTER COLUMN match_method DROP DEFAULT` — the live default `'auto'` isn't one of the planned values. The service must always set it.
- `ADD COLUMN reviewed_at timestamptz NULL` — when a human acted (`matched_at` stays "row created at").
- `ADD COLUMN failure_category text NULL` — reuse the same vocabulary as `FailureCategory` in `src/services/__tests__/fixtures/eval-types.ts` (keeps a future eval-pipeline merge cheap).
- `ADD COLUMN notes text NULL`.
- `ADD COLUMN source text NOT NULL DEFAULT 'engine'` — `'engine' | 'human'`.
- Partial unique index on `(spotify_track_id) WHERE is_confirmed = true` — at most one confirmed outcome per Spotify track.
- Partial unique index on `(spotify_track_id, mp3_id) WHERE mp3_id IS NOT NULL` — prevents duplicate candidate rows across repeated review sessions. (The predicate matches every row today because `mp3_id` is NOT NULL. It only starts to filter once the `DROP NOT NULL` above runs.)
- Index on `(mp3_id)` — Postgres doesn't index FK columns automatically, and every `local_mp3s` delete cascades into this table.
- Replace the INSERT RLS `WITH CHECK` (which currently requires both the Spotify track and the MP3 to belong to the user, so it rejects `mp3_id IS NULL`) with: the Spotify track belongs to `auth.uid()` AND (`mp3_id IS NULL` OR the MP3 belongs to `auth.uid()`).
- Add a `WITH CHECK` to the UPDATE policy with the same expression. Today the UPDATE policy has none, so Postgres reuses its `USING` expression ("Spotify track **or** MP3 belongs to the user"). That lets an update point `mp3_id` at an MP3 owned by another user.

**Row semantics** (tri-state on `is_confirmed`, no new status enum needed):
- `true` — confirmed match (or confirmed true-missing if `mp3_id IS NULL`).
- `false` — explicitly rejected candidate (a "no" is training signal, not deleted).
- `null` — engine-suggested, not yet reviewed.

`match_method` stays free text; convention `'tier1_exact' | 'tier2_core' | 'tier3_fuzzy' | 'manual'`.

#### Phase 2 — Engine fix
Fix `trackMatchingEngine.ts` so Tier 1 and Tier 2 (non-2b) branches of `matchTrack()` attach `matchedLocalTrack` (via a reverse lookup map alongside the existing `exactSet`/`coreSet`, built once in `buildLocalIndex`). Outcomes (match/tier) are unchanged, so this is safe against the eval suite's `falsePositives === 0` assertion — add/extend a unit test asserting `matchedLocalTrack` is present at every tier.

#### Phase 3 — Service layer
- **`src/services/trackMatching.service.ts`**: add `getMatchCandidates(userId, filters)` — fetches genre-filtered Spotify tracks + artist-overlap-scoped local tracks, calls the shared engine's `findMissingTracksPure()` (fixing today's duplicated inline tier logic), returns full `MatchResult[]` (matched + unmatched). Keep `findMissingTracks()` working as today by delegating: `getMatchCandidates(...).filter(r => !r.matched)` — zero changes required in `MissingTracksAnalyzer.tsx` during the transition.
- **New `src/services/manualMatch.service.ts`**:
  - `getCandidatesForReview(userId, filters)` — runs `getMatchCandidates`, merges in existing `track_matches` rows for those Spotify track ids so already-decided pairs aren't re-shown.
  - `bulkAutoConfirmTier1(userId, filters)` — batch-upserts Tier-1 candidates as confirmed rows, using the existing `DB_BATCH_SIZE = 100` batching convention from CLAUDE.md.
  - `confirmMatch(spotifyTrackId, mp3Id, { method, confidence, source })` — upserts a confirmed row; marks any other unreviewed suggested rows for the same Spotify track as rejected (`is_confirmed = false`), so "shown but not chosen" is captured even without an explicit reject click.
  - `rejectCandidate(spotifyTrackId, mp3Id, { failureCategory?, notes? })`.
  - `confirmTrueMissing(spotifyTrackId, { failureCategory?, notes? })` — inserts `mp3_id = NULL, is_confirmed = true`.
  - Throughout, `spotifyTrackId` means `spotify_liked.id` (the uuid the FK points at), not Spotify's `spotify_id`. Engine-suggested rows must set `is_confirmed = null` explicitly until the Phase 1 migration drops the `false` default.
- New tests: `src/services/__tests__/manualMatch.service.test.ts`, plus engine test coverage for the Phase 2 fix.

### Risks / Notes Carried Forward (not addressed in this change)
- `super_genre_manual_override` propagation in `supabase/functions/spotify-sync-liked/index.ts`: a concurrent sync could shift the genre-filtered subset mid-review session. Unrelated pre-existing issue, flagged for awareness only.
- **Tag writes orphan confirmed matches (found in Phase 0).** `local_mp3s.hash` is a SHA-256 of the whole file, and the scanner upserts on `hash`. Writing a SuperGenre tag changes the file's bytes, so the next scan inserts a new `local_mp3s` row, and any confirmed match still points at the old row. Not addressed in v1. Options include re-pointing matches by `file_path` on rescan, or deleting superseded rows.
- `SuperGenre` TS union vs. DB enum drift (`Soul-Jazz` missing from the TS union; `Reggae/Dancehall` vs `Reggae-Dancehall` duplicate) — pre-existing, worth cleaning up before it's load-bearing for genre-filtered UI, but not part of this change.
- **Eval infrastructure refactor is explicitly out of scope and deferred to its own later phased project**, to start only after this implementation is complete. The offline `eval-cases.json`/CSV pipeline (used once, and stale relative to how eval tooling has evolved since) stays untouched here — this plan does not redesign, unify, or migrate it. The `failure_category` column added to `track_matches` (Phase 1) is kept loosely vocabulary-compatible only so that future project has the option to draw on real review data; no merge mechanism is being built now.

### Verification (Part 1)
- `npx vitest run src/services/__tests__/trackMatchingEngine*.test.ts` and `npx vitest run src/services/__tests__/trackMatchingEval.test.ts` — confirm the Phase 2 fix doesn't change match outcomes or regress `MAX_FALSE_NEGATIVE_RATE`/false-positive count.
- `npx vitest run src/services/__tests__/manualMatch.service.test.ts` (new) and any new `trackMatching.service.test.ts` coverage for `getMatchCandidates`.
- Manual Supabase check: after Phase 1 migration, confirm `track_matches` accepts `mp3_id = NULL` inserts and the partial unique indexes reject duplicate confirmed rows, via the SQL editor or a scratch script — before wiring the UI in Part 2.
- Confirm an insert that leaves `is_confirmed` out stores `null`, not `false`, and that an UPDATE pointing `mp3_id` at another user's MP3 is rejected by RLS.
- Confirm review decisions survive a sync. With some `track_matches` rows in place, run a full Spotify sync that pauses and resumes at least once (requires MAK-152), and check that the row count is unchanged and the rows still point at the same `spotify_liked` rows.
- `npm run lint` and full `npx vitest run --coverage` (60% threshold) before considering Part 1 complete.

---

## Part 2 — Review Matches UI

### Current State (verified)

- **Dashboard tabs** — `src/pages/Index.tsx`: `Tabs` with 5 `TabsContent` blocks (vinyl/spotify/local/missing/downloads), URL-synced via `useSearchParams` (`?tab=`). The "missing" tab currently renders `MissingTracksAnalyzer`.
- **`MissingTracksAnalyzer.tsx`** (874 lines) — cascading Supergenre→Genre→Artist filter `Select`s, single "Analyze Missing Tracks" button, results grouped artist→album as nested `div`s (not a `Table`), each artist card `Checkbox`-selectable, per-track hover `DropdownMenu` with "Edit SuperGenre" and "Unlike on Spotify." Bulk actions: CSV export, "Push to slskd" (search/download integration). Source toggle (spotify/vinyl/both) renders `VinylGapsView` as an alternate section. None of this is being thrown away — it needs to be preserved inside/alongside the new review flow, since it's downstream tooling for tracks that end up confirmed-missing.
- **Closest reusable precedent** — `src/components/NoGenreTracks/TrackLevelProcessor.tsx` (the only one of three NoGenreTracks processors actually wired into the app, via `GenreTools.tsx`). Key reusable piece: `GenreCombobox` — a `Popover` + `Command`/`CommandInput`/`CommandList`/`CommandGroup`/`CommandItem` searchable picker, opens on reject-click, commits immediately on select. All three NoGenreTracks variants commit per-item immediately (approve/reject call the service directly in the click handler) — there is no "submit batch" pattern anywhere in the app today, and no shared hook encapsulates this state machine (each processor duplicates it locally).
- **Confidence display** — existing `getConfidenceColor` tiering helper in `NoGenreTracksProcessor.tsx` is dead code (computed, never applied to the badge's className) — a bug to avoid repeating, not a pattern to copy.
- **Routing/nav** — no new route needed since this replaces the existing "missing" tab in place; no `App.tsx` or `LibraryHeader.tsx` nav changes required.
- **Data fetching convention** — TanStack Query (`useQuery`/`useMutation`) is the established pattern for new hooks (`usePhysicalMedia.ts`, `useDiscogsSync.ts` as reference), with `queryClient.invalidateQueries` on mutation success and `useToast()` for feedback. `MissingTracksAnalyzer` itself predates this (manual `useState`/`useEffect`) — the new screen should use TanStack Query going forward rather than copying the older pattern.
- **Component toolkit already available** (no new shadcn primitives needed): `Table`, `Card`, `Badge`, `Select`, `Popover`+`Command` (combobox), `Progress`, `Checkbox`, `DropdownMenu`, `Tabs`, `ScrollArea`, `Skeleton`. `Dialog`/`AlertDialog` are available but unused by any existing review flow — only needed if a confirmation step is wanted.

### Decisions (confirmed)

1. **Placement**: Replace the "Missing Tracks" tab in `Index.tsx` with "Review Matches," same tab slot (rename, not a 6th tab). No new route/nav entry.
2. **Tier 1 visibility**: Auto-confirmed exact matches are not silently hidden. Show a single collapsed summary line (e.g. "✓ 42 exact matches auto-confirmed") that expands into a read-only list on demand — transparency without adding review burden.
3. **Existing `MissingTracksAnalyzer` functionality is preserved**, not dropped: CSV export, "Push to slskd," "Unlike on Spotify," "Edit SuperGenre," and the spotify/vinyl/both source toggle all carry forward, scoped to tracks that end up in the "confirmed missing" state.

### Screen Design

#### Layout (replaces `MissingTracksAnalyzer` inside the "Review Matches" tab)

```
Card: Filters
  Cascading Supergenre -> Genre -> Artist Select (reused from MissingTracksAnalyzer, unchanged)
  Source toggle: Spotify / Vinyl / Both (reused, unchanged)
  "Load Review Queue" button (replaces "Analyze Missing Tracks" — same trigger point,
     now calls ManualMatchService.getCandidatesForReview instead of findMissingTracks)

Collapsible summary row: "✓ N exact matches auto-confirmed" (chevron toggle)
  -> expands to a read-only Table (title / artist / local file path), no actions

Card: Review Queue  (only Tier 2, Tier 3, and no-match candidates land here)
  Table, one row per Spotify track needing a decision:
    columns: Track (title + artist), Tier badge (Core Title / Fuzzy XX% / No Match),
             Candidate local file (title/artist/album/file_path preview), Actions
    Actions cell:
      - Tier 2/3 rows: "Confirm" button (accept the suggested candidate) +
        "Reject" button (X icon) -> opens the search-and-pick combobox inline
        (reuse GenreCombobox's Popover+Command shell, repurposed to search local_mp3s
        by title/artist instead of a static genre list) + a "Confirm Missing" text
        action for "there's genuinely no local copy"
      - No-match rows: same combobox directly (no suggested candidate to confirm/reject
        first), plus "Confirm Missing"
    Each action commits immediately via ManualMatchService (confirmMatch / rejectCandidate /
    confirmTrueMissing), matching the app's existing per-item-immediate-commit convention —
    no "submit batch" step, row updates optimistically then reconciles via query invalidation.

Card: Confirmed Missing (tracks with is_confirmed=true, mp3_id=null)
  This is functionally the old MissingTracksAnalyzer results view (artist->album grouped
  cards, Checkbox multi-select, CSV export, "Push to slskd", "Unlike on Spotify",
  "Edit SuperGenre" dropdown) — reused close to as-is, just fed from confirmed-missing
  track_matches rows instead of a fresh findMissingTracks() call every time.

Vinyl gaps section (source=vinyl|both): VinylGapsView, unchanged, sits below as today.
```

#### Confidence/tier display
Fix the dead-code bug rather than repeat it: apply real Tailwind classes to the tier badge based on tier (Tier 2 = neutral, Tier 3 = amber-tinted with the similarity % shown, e.g. "Fuzzy 87%"), so confidence is visually meaningful, not just numeric text.

#### State/data flow
- New hook `src/hooks/useMatchReview.ts` (TanStack Query): `useQuery` wrapping `ManualMatchService.getCandidatesForReview(userId, filters)` (query key includes the filter values), plus `useMutation`s for `confirmMatch`/`rejectCandidate`/`confirmTrueMissing`/`bulkAutoConfirmTier1`, each invalidating the review-queue query key on success and firing a `useToast()` on error — matches the `usePhysicalMedia.ts` convention.
- On "Load Review Queue": first call `bulkAutoConfirmTier1` (silent, no toast spam — a single summary toast like "42 exact matches confirmed"), then load the remaining queue.
- Search-and-pick combobox: client-side filter over the artist-overlap-scoped local track list already fetched for the session (same data `getMatchCandidates` pulled), no new async search needed — mirrors `GenreCombobox`'s existing client-side `CommandInput` filtering approach.

#### States
- Loading: `Skeleton` rows in the review-queue table (not the spinner-div or plain-text patterns used elsewhere — `Skeleton` exists in the toolkit and isn't used by this pattern family yet, but is a small, low-risk upgrade over copying the weaker existing states).
- Empty queue (everything resolved): reuse `MissingTracksAnalyzer`'s existing empty-state card style (`Music` icon, heading, CTA) with copy adjusted to "Nothing left to review."
- Error: inline `text-destructive` card at the top of the Review Queue card (matches `GenreTools.tsx`'s page-level error pattern), plus a toast.

### Files to Add/Modify
- **Modify** `src/pages/Index.tsx` — rename "missing" tab label/content to render the new component; no structural tab changes.
- **New** `src/components/ReviewMatches/ReviewMatches.tsx` — top-level container (filters + trigger + collapsed Tier-1 summary + review queue + confirmed-missing section), replaces `MissingTracksAnalyzer` as the tab's root component.
- **New** `src/components/ReviewMatches/ReviewQueueTable.tsx` — the Table + per-row actions + inline search-pick combobox.
- **New** `src/components/ReviewMatches/LocalTrackCombobox.tsx` — the reusable search-and-pick combobox, generalized from `GenreCombobox`'s Popover+Command shell.
- **Reused largely as-is, relocated or wrapped**: the confirmed-missing display logic currently in `MissingTracksAnalyzer.tsx` (artist/album grouping, CSV export, slskd push, unlike, edit-supergenre) — carry the JSX/handlers over into a `ConfirmedMissingSection.tsx` under the same directory, fed by confirmed `track_matches` rows instead of live `findMissingTracks()` results.
- **New** `src/hooks/useMatchReview.ts` — TanStack Query hook per "State/data flow" above.
- `MissingTracksAnalyzer.tsx` itself: once `ReviewMatches` fully replaces its tab usage, it becomes dead code — remove it (and `VinylGapsView`'s import site moves to the new component) rather than leaving an orphaned duplicate, once the new screen is verified working.

### Verification (Part 2)
- `npm run dev`, navigate to the dashboard's "Review Matches" tab, exercise the full flow against real data: apply a genre filter, load the queue, confirm a Tier-2/3 suggestion, reject one and pick an alternate via the combobox, confirm one as missing, and check the "confirmed missing" section shows it with working CSV export / slskd push / unlike / edit-supergenre actions.
- Confirm the collapsed Tier-1 summary count matches what `bulkAutoConfirmTier1` reports, and that expanding it lists the right tracks.
- `npm run lint` and `npx vitest run --coverage` after implementation.
