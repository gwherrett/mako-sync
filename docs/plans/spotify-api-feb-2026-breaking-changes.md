# Spotify Web API February 2026 Changes — Impact Analysis for Mako-Sync

> **Source:** [Spotify Web API Changes — February 2026](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)
> **Date documented:** 2026-02-27

## Context

Spotify announced breaking changes to the Web API effective February 2026. This document reviews which changes affect Mako-Sync, which create improvement opportunities, and which have no impact. The goal is to understand required fixes before they cause production failures.

---

## Breaking Changes

These changes directly affect code that is currently in production use.

### 1. `GET /v1/artists` (Batch) — ENDPOINT REMOVED

**Impact: CRITICAL**

- **File:** [supabase/functions/spotify-sync-liked/artist-genres.ts](../../supabase/functions/spotify-sync-liked/artist-genres.ts)
- Mako-Sync's entire genre-detection strategy is built on fetching `artist.genres[]` via `GET /v1/artists?ids={ids}` in batches of 50.
- This endpoint has been removed in the February 2026 changes.
- **Result:** Every sync will fail to populate genre data. The `artist_genres` table will no longer be populated. Super-genre mapping will break entirely.

**Genre source assessment (as of 2026-02-27):**

| Endpoint | Genre available? | Notes |
|----------|-----------------|-------|
| `GET /v1/artists/{id}` (single artist) | **Yes — but deprecated** | `genres[]` is still returned but marked deprecated; no removal date announced |
| `GET /v1/albums/{id}` (single album) | To be confirmed | Batch removed; single endpoint likely still exists |
| `GET /v1/tracks/{id}` (single track) | **No** | Track objects contain only simplified artist/album — no genre field at any level |
| `GET /me/tracks` (liked songs) | **No** | Same simplified objects; no genre field |

- **`GET /v1/tracks/{id}` cannot be used as a genre source** — genre is absent from track, simplified album, and simplified artist objects at every level in the response.
- The only remaining Spotify source for genre is `GET /v1/artists/{id}` (single), which still returns `genres[]` (deprecated).
- **Required fix:** Refactor `artist-genres.ts` to call `GET /v1/artists/{id}` individually per artist ID with a concurrency cap (~5 in-flight). Treat `genres` as deprecated but use it until Spotify removes it. Track this as a future risk.

### 2. `GET /v1/albums` (Batch) — ENDPOINT REMOVED

**Impact: HIGH**

- **File:** [supabase/functions/spotify-sync-liked/album-genres.ts](../../supabase/functions/spotify-sync-liked/album-genres.ts)
- Album genres are the fallback/secondary genre source fetched via `GET /v1/albums?ids={ids}` in batches of 20.
- This endpoint has been removed.
- **Result:** Fallback genre enrichment via album genres will stop working.
- **Required fix:** Migrate to individual `GET /v1/albums/{id}` calls with a concurrency cap. Note that `album.genres` has historically been empty for most albums on Spotify (Spotify has not reliably populated it); this fallback may have limited real-world value and could be disabled if the single-endpoint also returns empty arrays.

### 3. `User.email` and other User fields — REMOVED from `/v1/me`

**Impact: LOW**

- **Files:** [supabase/functions/spotify-auth/index.ts](../../supabase/functions/spotify-auth/index.ts) (~line 200), [supabase/functions/spotify-sync-liked/index.ts](../../supabase/functions/spotify-sync-liked/index.ts) (line 127)
- Mako-Sync reads `email` from the `/v1/me` response and stores it in the user profile.
- Removed fields: `email`, `country`, `product`, `followers`, `explicit_content`
- **Result:** `profileData.email` will silently return `undefined`, potentially writing `null` to the DB or crashing on strict access.
- **Required fix:** Remove reads of `email` from `/v1/me`. Substitute the Supabase auth user's email (available from JWT claims). Remove the now-vestigial `user-read-email` OAuth scope.

### 4. `GET /v1/tracks` (Batch) — ENDPOINT REMOVED

**Impact: LOW–MEDIUM**

- **File:** [supabase/functions/spotify-resync-tracks/index.ts](../../supabase/functions/spotify-resync-tracks/index.ts) (line 125)
- The resync function uses `GET /v1/tracks/{id}` (single-track). The *batch* variant `GET /v1/tracks?ids=` is what was removed.
- **Required fix:** Verify the function only uses the single-track path (likely no change needed). Add a comment confirming the batch endpoint is gone.

### 5. `Track`, `Album`, `Artist` field removals — no current code impact

**Impact: NONE (currently)**

- Removed fields: `Track.popularity`, `Track.available_markets`, `Track.external_ids`, `Track.linked_from`, `Album.popularity`, `Album.label`, `Album.available_markets`, `Artist.popularity`, `Artist.followers`
- Mako-Sync does not read any of these fields. Documented for awareness only.

---

## Opportunities to Improve

These changes signal shifts in the API that could prompt improvements.

### 1. Genre Data Strategy — Cache-First Approach + Deprecation Risk (Secondary Priority)

- With the batch artist/album endpoints gone, the volume of individual API calls during a sync will increase.
- **Opportunity:** Lean more heavily on the existing `artist_genres` and `album_genres` database caches. Never re-fetch genres from Spotify for an artist/album already cached. This limits API call volume when moving from batch to individual calls.
- **Deprecation risk:** `artist.genres` on `GET /v1/artists/{id}` is now marked deprecated by Spotify. No removal date has been announced, but this should be monitored. If it is eventually removed, the only fallback would be an AI-assisted genre classification (the `ai-track-genre-suggest` edge function already exists for this purpose) or a third-party genre database. Consider adding a health-check that alerts if the `genres` array is consistently empty across a sync, which would signal silent removal.

### 2. Library Management Unification — Future Feature Groundwork

- Spotify has replaced type-specific save/remove endpoints with unified `PUT /me/library` and `DELETE /me/library`.
- Mako-Sync currently only *reads* the library. If a future feature allows liking/unliking from the app, the new unified endpoints are the correct implementation target.

### 3. Remove Unused OAuth Scopes

- Current scopes: `user-read-private`, `user-read-email`, `user-library-read`, `playlist-read-private`, `playlist-read-collaborative`, `user-top-read`
- **Scopes to remove:** `user-read-email` (email gone from API), `playlist-read-private`, `playlist-read-collaborative`, `user-top-read` (none of these endpoints are used)
- **Scopes to keep:** `user-read-private` (for user ID), `user-library-read` (for liked songs)
- Trimming scopes reduces the permissions surface shown to users on the OAuth consent screen.

### 4. Playlist `tracks` → `items` rename

- Spotify renamed the `tracks` field to `items` in playlist objects, and playlist CRUD now uses `/playlists/{id}/items`.
- Mako-Sync does not use playlists. If playlist features are ever added, use the new path from the start.

---

## No Impact

These changes do not affect Mako-Sync because the removed/changed functionality is not used.

| Change | Why No Impact |
|--------|--------------|
| `GET /users/{id}` removed | Mako-Sync never fetches other users' profiles |
| `GET /users/{id}/playlists` removed | Not used |
| `POST /users/{user_id}/playlists` removed | No playlist creation |
| Follow/Unfollow artists, users, playlists removed | Not used |
| `GET /me/albums/contains` and type-specific check endpoints removed | Mako-Sync doesn't check saved status |
| `GET /browse/new-releases`, `GET /browse/categories` removed | Not used |
| `GET /markets` removed | Not used |
| `GET /artists/{id}/top-tracks` removed | Not used |
| `Artist.popularity`, `Artist.followers` removed | Not read from API responses |
| `Track.popularity`, `Track.available_markets`, `Track.linked_from`, `Track.external_ids` removed | Not read from API responses |
| `Album.popularity`, `Album.label`, `Album.external_ids`, `Album.available_markets` removed | Not read from API responses |
| Search rate limit change (limit max 50→10, default 20→5) | Search endpoint not used |
| Audiobook/Show/Chapter field removals | Not used |
| Playlist `tracks` → `items` rename | Playlist endpoints not used |

---

## Implementation Plan

### Branch

```bash
git checkout -b fix/spotify-api-feb-2026-breaking-changes
```

All changes land on this branch. A PR is opened against `main` only after all tests pass and verification steps are confirmed.

---

### Step 1 — Fix Genre Enrichment (CRITICAL)

**Files:** [artist-genres.ts](../../supabase/functions/spotify-sync-liked/artist-genres.ts), [album-genres.ts](../../supabase/functions/spotify-sync-liked/album-genres.ts)

**Fix — artist-genres.ts:**
1. `GET /v1/artists/{id}` (single) **still returns `genres[]`** — confirmed, though the field is marked deprecated. Use it.
2. Replace the batch call with a concurrent queue: call `GET /v1/artists/{id}` per artist ID in groups of ~5 using `Promise.allSettled`.
3. Cache-first: only call Spotify for artist IDs **not** already present in the `artist_genres` table. This limits API volume now that batching is gone.
4. Note in code comments that `genres` is deprecated — monitor Spotify changelog for a removal date.
5. `GET /v1/tracks/{id}` **cannot** substitute as a genre source — track responses contain only simplified artist/album objects with no genre field at any level.

**Fix — album-genres.ts:**
1. Replace batch `GET /v1/albums?ids=` with individual `GET /v1/albums/{id}` calls, concurrency cap ~5.
2. Note: `album.genres` is historically empty for most Spotify albums; if the single endpoint consistently returns empty arrays, consider disabling album genre enrichment to reduce API calls, with a logged warning rather than a crash.

**New tests** (`src/services/__tests__/`):
- `artistGenresFallback.test.ts` — mock single-artist endpoint; assert genres map is correctly built
- `albumGenresFallback.test.ts` — mock single-album endpoint; assert fallback genres populate
- `genreEnrichmentCachePriority.test.ts` — assert cached artists are never re-fetched

---

### Step 2 — Fix `/v1/me` Email Field Removal (HIGH)

**Files:** [spotify-auth/index.ts](../../supabase/functions/spotify-auth/index.ts), [spotify-sync-liked/index.ts](../../supabase/functions/spotify-sync-liked/index.ts), [spotifyAuthManager.service.ts](../../src/services/spotifyAuthManager.service.ts)

**Fix:**
1. Find and remove all reads of `profileData.email` from both edge functions.
2. If email is needed downstream, source it from the Supabase JWT claims instead.
3. Remove the `user-read-email` scope from the OAuth authorization URL.

**New tests:**
- `spotifyAuthEmailRemoval.test.ts` — mock `/v1/me` without `email`; assert auth completes without error and no `undefined`/`null` email is stored

---

### Step 3 — Verify `/v1/tracks/{id}` (Single) Still Works (LOW)

**File:** [spotify-resync-tracks/index.ts](../../supabase/functions/spotify-resync-tracks/index.ts)

**Fix:**
1. Confirm the function only uses `GET /v1/tracks/{id}` (single), not the removed batch variant.
2. If confirmed unchanged: add a code comment noting the batch endpoint is removed.
3. If batch calls are found: replace with individual calls.

---

### Step 4 — Remove Unused OAuth Scopes (IMPROVEMENT)

**File:** [spotifyAuthManager.service.ts](../../src/services/spotifyAuthManager.service.ts) (line 342)

Remove: `user-read-email`, `playlist-read-private`, `playlist-read-collaborative`, `user-top-read`
Keep: `user-read-private`, `user-library-read`

**New tests:**
- `spotifyAuthScopes.test.ts` — assert generated OAuth URL contains only `user-read-private` and `user-library-read`

---

### Maintaining 60% Coverage Threshold

Each step above adds targeted unit tests. After all changes:

1. Run `npx vitest run --coverage` — confirm ≥60% threshold holds.
2. If below threshold: add error-path tests for the genre refactor (429 rate-limit, empty genres array, cache miss + API failure).

---

## Verification

### Automated

```bash
npx vitest run              # All tests pass
npx vitest run --coverage   # Coverage ≥ 60%
npm run eval:matching       # Track matching eval does not regress
npm run lint                # No type errors from field/scope changes
```

### Manual End-to-End

**A. Genre enrichment pipeline**
1. Truncate (or note current row counts of) `artist_genres` and `album_genres` in Supabase Studio.
2. Trigger a full Spotify sync (Settings → Re-sync).
3. Confirm `artist_genres` table is populated with genre data.
4. Confirm the Genre Mapping page shows genres with super-genre column populated.
5. Check Edge Function logs for `spotify-sync-liked` — no 404s on artist/album endpoints.

**B. Auth flow with email removal**
1. Disconnect Spotify (Settings → Disconnect), then re-connect via OAuth.
2. Confirm consent screen lists only: `user-read-private` and `user-library-read`.
3. Confirm callback completes without error.
4. In Supabase Studio, confirm `spotify_connections` has the record with `spotify_user_id` populated and no unexpected `null` email values.

**C. Track resync**
1. Select 3–5 tracks, trigger metadata resync.
2. Confirm `spotify-resync-tracks` logs show HTTP 200 from `GET /v1/tracks/{id}`.
3. Confirm metadata updates are reflected in `spotify_liked` table.

**D. Scope audit**
1. Check the OAuth authorization URL in browser dev tools (Network tab).
2. Confirm `scope` contains only: `user-read-private user-library-read`.
3. Confirm removed scopes are absent.

**E. Full sync regression**
1. Run a full sync with a Spotify account with 100+ liked songs.
2. Confirm all tracks land in `spotify_liked`.
3. Confirm the Missing Tracks page correctly identifies gaps.
4. No unhandled promise rejections or panics in edge function logs.

### PR Checklist Before Merge

- [ ] All automated tests pass (`npx vitest run`)
- [ ] Coverage ≥ 60% (`npx vitest run --coverage`)
- [ ] Eval suite passes with no regression (`npm run eval:matching`)
- [ ] Lint passes (`npm run lint`)
- [ ] Manual verification steps A–E completed
- [ ] No 404s to removed Spotify endpoints in edge function logs
- [ ] PR description references the Spotify February 2026 change docs

---

## Critical Files to Modify

| File | Change Required | Priority |
|------|----------------|----------|
| [supabase/functions/spotify-sync-liked/artist-genres.ts](../../supabase/functions/spotify-sync-liked/artist-genres.ts) | Refactor away from `GET /v1/artists` batch | CRITICAL |
| [supabase/functions/spotify-sync-liked/album-genres.ts](../../supabase/functions/spotify-sync-liked/album-genres.ts) | Refactor away from `GET /v1/albums` batch | HIGH |
| [supabase/functions/spotify-auth/index.ts](../../supabase/functions/spotify-auth/index.ts) | Remove `email` read from `/v1/me` | HIGH |
| [supabase/functions/spotify-sync-liked/index.ts](../../supabase/functions/spotify-sync-liked/index.ts) | Remove `email` read from `/v1/me` if present | HIGH |
| [src/services/spotifyAuthManager.service.ts](../../src/services/spotifyAuthManager.service.ts) | Remove unused OAuth scopes | IMPROVEMENT |
