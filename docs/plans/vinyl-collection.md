# Vinyl Collection Feature Plan

**Status:** Backlog
**Linear Project:** [Vinyl Collection](https://linear.app/mako-sync/project/vinyl-collection-dc4dae31e33b)
**Issues:** MAK-51 through MAK-63

---

## Overview

Adds physical media (vinyl record) tracking to Mako Sync. The vinyl table drives digital file acquisition — owning a record on wax is the trigger for sourcing the digital copy.

### Core Workflow
1. Photograph a record sleeve → Claude Vision (claude-sonnet-4-6) extracts artist/title/label/cat no/year
2. User confirms/corrects: country, pressing (original/reissue/remaster), condition (VG+/NM etc.), format (LP/7"/12"), label & catalogue number
3. Discogs API (full OAuth 1.0a) searches for and confirms the exact release + returns tracklist
4. Record saved to `physical_media` Supabase table
5. Tracklist cross-referenced against `local_mp3s` to find missing digital tracks
6. Missing tracks pushed to slskd wishlist for automated download

---

## Issues

| Issue | Linear | Title | Phase |
|-------|--------|-------|-------|
| VIN-1 | [MAK-51](https://linear.app/mako-sync/issue/MAK-51) | Create `physical_media` and `discogs_connections` tables | 1 |
| VIN-2 | [MAK-52](https://linear.app/mako-sync/issue/MAK-52) | `discogs-auth` Edge Function (OAuth 1.0a) | 2 |
| VIN-3 | [MAK-53](https://linear.app/mako-sync/issue/MAK-53) | `useDiscogsAuth` hook + `/discogs-callback` route | 2 |
| VIN-4 | [MAK-54](https://linear.app/mako-sync/issue/MAK-54) | `vinyl-image-identify` Edge Function (Claude Vision) | 4 |
| VIN-5 | [MAK-55](https://linear.app/mako-sync/issue/MAK-55) | `CameraCapture` component | 4 |
| VIN-6 | [MAK-56](https://linear.app/mako-sync/issue/MAK-56) | `discogs-search` Edge Function | 3 |
| VIN-7 | [MAK-57](https://linear.app/mako-sync/issue/MAK-57) | `DiscogsReleaseSelector` component | 5 |
| VIN-8 | [MAK-58](https://linear.app/mako-sync/issue/MAK-58) | `AddVinylDialog` multi-step wizard | 5 |
| VIN-9 | [MAK-59](https://linear.app/mako-sync/issue/MAK-59) | `usePhysicalMedia` TanStack Query hook | 3 |
| VIN-10 | [MAK-60](https://linear.app/mako-sync/issue/MAK-60) | `useVinylMissingTracks` + `TrackMatchingService` extension | 6 |
| VIN-11 | [MAK-61](https://linear.app/mako-sync/issue/MAK-61) | Push vinyl missing tracks to slskd | 6 |
| VIN-12 | [MAK-62](https://linear.app/mako-sync/issue/MAK-62) | `/vinyl` route and collection page | 7 |
| VIN-13 | [MAK-63](https://linear.app/mako-sync/issue/MAK-63) | Discogs token row on Security page | 2 |

---

## Phased Implementation Order

### Phase 1 — Database (no UI risk)
- **VIN-1**: Create tables + RLS + triggers; regenerate `src/integrations/supabase/types.ts`

### Phase 2 — Discogs Auth (unblocks all Discogs API calls)
- **VIN-2**: `discogs-auth` edge function (OAuth 1.0a HMAC-SHA1)
- **VIN-3**: `useDiscogsAuth` hook + `/discogs-callback` route + `DiscogsCallback` component
- **VIN-13**: Discogs row on Security page (trivial once hook exists)

### Phase 3 — Data Layer (pure logic, no UI)
- **VIN-9**: `usePhysicalMedia` CRUD hook
- **VIN-6**: `discogs-search` edge function

### Phase 4 — Vision & Identification (independent path)
- **VIN-4**: `vinyl-image-identify` edge function
- **VIN-5**: `CameraCapture` component

### Phase 5 — Add Flow (assembles Phases 3 + 4)
- **VIN-7**: `DiscogsReleaseSelector` component
- **VIN-8**: `AddVinylDialog` 4-step wizard

### Phase 6 — Cross-Reference & slskd
- **VIN-10**: `useVinylMissingTracks` + `TrackMatchingService.matchTracklistAgainstLocal()`
- **VIN-11**: "Push missing to slskd" in `VinylDetailPanel`

### Phase 7 — Collection UI (final assembly)
- **VIN-12**: `src/pages/Vinyl.tsx`, `VinylCard`, `VinylDetailPanel`, `/vinyl` route

---

## New Files

### Edge Functions (Deno)
- `supabase/functions/discogs-auth/index.ts`
- `supabase/functions/discogs-search/index.ts`
- `supabase/functions/vinyl-image-identify/index.ts`

### Services & Types
- `src/services/discogsAuthManager.service.ts`
- `src/types/discogs.ts`

### Hooks
- `src/hooks/useDiscogsAuth.ts`
- `src/hooks/usePhysicalMedia.ts`
- `src/hooks/useVinylMissingTracks.ts`

### Components
- `src/components/vinyl/CameraCapture.tsx`
- `src/components/vinyl/DiscogsReleaseSelector.tsx`
- `src/components/vinyl/AddVinylDialog.tsx`
- `src/components/vinyl/VinylCard.tsx`
- `src/components/vinyl/VinylDetailPanel.tsx`
- `src/components/discogs/DiscogsCallback.tsx`

### Pages
- `src/pages/Vinyl.tsx`

## Modified Files
- `src/App.tsx` — add `/vinyl` (protected) and `/discogs-callback` (public) routes
- `src/pages/Security.tsx` — add Discogs row to Token Status table
- `src/services/trackMatching.service.ts` — add `matchTracklistAgainstLocal()` static method
- `src/integrations/supabase/types.ts` — regenerate after migration

---

## Key Reuse Points

| Existing Asset | Reused In |
|---|---|
| `spotify-auth/index.ts` vault pattern | `discogs-auth` — copy vault section verbatim |
| `SpotifyAuthManager` singleton | `DiscogsAuthManager` — mirror class structure |
| `useUnifiedSpotifyAuth` state machine | `useDiscogsAuth` — near-identical structure |
| `UnifiedSpotifyCallback.tsx` | `DiscogsCallback.tsx` — same retry/step logic |
| `slskdClient.formatAlbumSearchQuery()` | VIN-11 — call directly, zero new slskd code |
| `useSlskdSync.syncToSlskd()` | VIN-11 — call with `SlskdTrackToSync[]` from vinyl record |
| `TrackMatchingEngine` 3-tier matching | VIN-10 — no new matching logic |
| `NormalizationService.normalize()` | VIN-10 — normalize both sides before matching |
| `withTimeout` from `@/utils/promiseUtils` | All DB ops in VIN-9 and VIN-8 |

---

## Critical Gotchas

**OAuth 1.0a HMAC-SHA1 in Deno**: No `crypto.createHmac`. Use:
```typescript
await crypto.subtle.sign(
  { name: 'HMAC', hash: 'SHA-1' },
  await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']),
  msgBytes
)
```

**Two Vault secrets per Discogs user**: Unlike Spotify (access + refresh), Discogs OAuth 1.0a stores `access_token` + `access_token_secret` permanently (no refresh token). Both go to Vault.

**Image compression before base64**: Compress to JPEG 80% client-side via `canvas.toBlob('image/jpeg', 0.8)` if image > 2MB before sending to edge function.

**Discogs track title annotations**: Titles like "(12\" Mix)" are already stripped by the existing `extractCoreTitle()` in `trackMatchingEngine.ts` — no extra handling needed.

---

## Required Supabase Secrets
- `DISCOGS_CONSUMER_KEY`
- `DISCOGS_CONSUMER_SECRET`
- `ANTHROPIC_API_KEY` (may already exist)

---

## Verification Steps
1. Apply migration; confirm both tables in Supabase dashboard; verify RLS blocks cross-user access
2. Complete Discogs OAuth round-trip; confirm `discogs_connections` row with vault IDs
3. `curl` `vinyl-image-identify` with a known sleeve JPEG; confirm structured JSON returned
4. Add a record via `AddVinylDialog`; confirm row in `physical_media`
5. Open `VinylDetailPanel`; confirm tracklist cross-reference shows matched/missing correctly
6. Click "Push missing to slskd"; confirm `SlskdSyncProgress` modal and wishlist entries
7. `npx vitest run` — no regressions
