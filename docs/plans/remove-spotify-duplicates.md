# Implementation Plan: Remove Duplicate Spotify Liked Songs

**Status:** Ready to implement
**Branch:** `claude/remove-duplicates-maki-spotify-6HsnY`
**Created:** 2026-03-18

---

## Problem

Mako-Sync already detects and resolves duplicate **local files** via `DuplicateDetectionService` and `DuplicateTracksManager`. However, there is no equivalent for **Spotify liked songs**.

A user can have semantically duplicate Spotify tracks — the same song liked in multiple versions (e.g., two different album pressings, a remaster, a compilation reissue). Each version has a **different `spotify_id`** so the existing `UNIQUE(user_id, spotify_id)` database constraint does not catch them. They share the same **normalized title + artist** and are functionally the same song.

**Goal:** Detect these semantic duplicates, let the user pick which version to keep, then:
1. Call Spotify's API to **unlike** the discarded tracks (so the user's Spotify library is cleaned up)
2. Delete those records from the `spotify_liked` Supabase table

---

## Files to Change

| File | Action | Notes |
|------|--------|-------|
| `src/services/duplicateDetection.service.ts` | **Extend** | Add `findSpotifyDuplicates()` and `resolveSpotifyDuplicate()` |
| `src/components/DuplicateTracksManager.tsx` | **Extend** | Add a "Spotify Duplicates" tab alongside the existing "Local Files" view |

No new files need to be created.

---

## Step 1 — Extend `duplicateDetection.service.ts`

**File:** `src/services/duplicateDetection.service.ts`

### New types (add above the class)

```ts
export interface SpotifyDuplicateTrack {
  id: string;           // DB row id (uuid)
  spotify_id: string;   // Spotify track ID
  title: string | null;
  artist: string | null;
  album: string | null;
  normalized_title: string | null;
  normalized_artist: string | null;
  added_at: string | null;  // ISO timestamp — newest = preferred default
}

export interface SpotifyDuplicateGroup {
  normalized_title: string;
  normalized_artist: string;
  /** Tracks ordered by added_at DESC (most recently liked first) */
  tracks: SpotifyDuplicateTrack[];
}

export interface SpotifyResolveResult {
  removed: number;
  errors: string[];
}
```

### New method 1: `findSpotifyDuplicates(userId: string)`

Add as a static method on `DuplicateDetectionService`.

**Logic:**
1. Query `spotify_liked` for all rows belonging to `userId` where `normalized_title` and `normalized_artist` are not null
2. Order by `normalized_artist ASC`, `normalized_title ASC`, `added_at DESC`
3. Group client-side by `normalized_artist + '\0' + normalized_title`
4. Return only groups with more than one track

**Imports needed** (already in file):
- `supabase` from `@/integrations/supabase/client`

**Add import:**
```ts
import { withTimeout } from '@/utils/promiseUtils';
```

**Code to add:**

```ts
static async findSpotifyDuplicates(userId: string): Promise<SpotifyDuplicateGroup[]> {
  const { data, error } = await withTimeout(
    supabase
      .from('spotify_liked')
      .select('id, spotify_id, title, artist, album, normalized_title, normalized_artist, added_at')
      .eq('user_id', userId)
      .not('normalized_title', 'is', null)
      .not('normalized_artist', 'is', null)
      .order('normalized_artist', { ascending: true })
      .order('normalized_title', { ascending: true })
      .order('added_at', { ascending: false, nullsFirst: false })
      .then(r => r),
    45000,
    'Spotify duplicate query timed out'
  );

  if (error) {
    console.error('Error fetching Spotify tracks for duplicate detection:', error);
    throw error;
  }

  const rows = (data || []) as SpotifyDuplicateTrack[];

  const groupMap = new Map<string, SpotifyDuplicateTrack[]>();
  for (const row of rows) {
    const key = `${row.normalized_artist}\0${row.normalized_title}`;
    const group = groupMap.get(key);
    if (group) {
      group.push(row);
    } else {
      groupMap.set(key, [row]);
    }
  }

  const duplicates: SpotifyDuplicateGroup[] = [];
  for (const [, tracks] of groupMap) {
    if (tracks.length > 1) {
      duplicates.push({
        normalized_title: tracks[0].normalized_title!,
        normalized_artist: tracks[0].normalized_artist!,
        tracks,
      });
    }
  }

  return duplicates;
}
```

### New method 2: `resolveSpotifyDuplicate(keepId, deleteIds, userId, accessToken)`

**Logic:**
1. Safety check: `keepId` must not appear in `deleteIds`
2. Look up the `spotify_id` values for each row in `deleteIds` (needed for the Spotify API call)
3. Batch the Spotify API `DELETE /v1/me/tracks` calls in groups of 50 (Spotify's limit)
4. For each batch: if the API call fails, record the error but continue (partial success is acceptable)
5. Delete successfully unliked rows from `spotify_liked` in Supabase

**Code to add:**

```ts
static async resolveSpotifyDuplicate(
  keepId: string,
  deleteIds: string[],
  userId: string,
  accessToken: string
): Promise<SpotifyResolveResult> {
  if (deleteIds.includes(keepId)) {
    throw new Error('keepId must not appear in deleteIds');
  }
  if (deleteIds.length === 0) return { removed: 0, errors: [] };

  // Fetch the spotify_id values for the rows we want to delete
  const { data: rows, error: fetchError } = await supabase
    .from('spotify_liked')
    .select('id, spotify_id')
    .in('id', deleteIds)
    .eq('user_id', userId);

  if (fetchError) throw fetchError;

  const spotifyIds = (rows || []).map(r => r.spotify_id as string).filter(Boolean);
  const errors: string[] = [];
  const successfulSpotifyIds: string[] = [];

  // Batch DELETE calls to Spotify API (max 50 per request)
  const BATCH_SIZE = 50;
  for (let i = 0; i < spotifyIds.length; i += BATCH_SIZE) {
    const batch = spotifyIds.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch('https://api.spotify.com/v1/me/tracks', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: batch }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        errors.push(`Spotify API error (${res.status}): ${text}`);
      } else {
        successfulSpotifyIds.push(...batch);
      }
    } catch (err: any) {
      errors.push(`Spotify API request failed: ${err.message}`);
    }
  }

  // Remove successfully unliked tracks from Supabase
  if (successfulSpotifyIds.length > 0) {
    const idsToDelete = (rows || [])
      .filter(r => successfulSpotifyIds.includes(r.spotify_id as string))
      .map(r => r.id as string);

    const { error: deleteError } = await supabase
      .from('spotify_liked')
      .delete()
      .in('id', idsToDelete)
      .eq('user_id', userId);

    if (deleteError) {
      errors.push(`DB delete error: ${deleteError.message}`);
    }
  }

  return { removed: successfulSpotifyIds.length, errors };
}
```

---

## Step 2 — Extend `DuplicateTracksManager.tsx`

**File:** `src/components/DuplicateTracksManager.tsx`

### Summary of changes

- Wrap the existing content in a `Tabs` component with two tabs:
  - **"Local Files"** — existing duplicate groups UI (unchanged)
  - **"Spotify Library"** — new Spotify duplicate groups UI
- Add state for Spotify tab: `spotifyGroups`, `spotifyKeepSelections`, `spotifyResolvedKeys`, `isSpotifyLoading`, `spotifyError`, `accessToken`
- Load Spotify duplicates on mount (alongside local file duplicates)
- Obtain the Spotify access token from `SpotifyAuthManager.getInstance().getState().connection?.access_token`
- If no access token, show a "Spotify not connected" notice on the Spotify tab

### New imports to add

```ts
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SpotifyAuthManager } from '@/services/spotifyAuthManager.service';
import type { SpotifyDuplicateGroup } from '@/services/duplicateDetection.service';
```

Also add to the existing `DuplicateDetectionService` import:
```ts
import {
  DuplicateDetectionService,
  DuplicateGroup,
  SpotifyDuplicateGroup,  // add this
} from '@/services/duplicateDetection.service';
```

### New state variables (add alongside existing state)

```ts
const [spotifyGroups, setSpotifyGroups] = useState<SpotifyDuplicateGroup[]>([]);
const [spotifyKeepSelections, setSpotifyKeepSelections] = useState<Record<string, string>>({});
const [spotifyResolvedKeys, setSpotifyResolvedKeys] = useState<Set<string>>(new Set());
const [isSpotifyLoading, setIsSpotifyLoading] = useState(true);
const [isSpotifyResolving, setIsSpotifyResolving] = useState(false);
const [spotifyError, setSpotifyError] = useState<string | null>(null);
const [accessToken, setAccessToken] = useState<string | null>(null);
```

### Access token retrieval (add inside the component, after state declarations)

```ts
useEffect(() => {
  const token = SpotifyAuthManager.getInstance().getState().connection?.access_token ?? null;
  setAccessToken(token);
}, []);
```

> **Note:** `access_token` on the connection object may be the vault placeholder string `'***ENCRYPTED_IN_VAULT***'`. Check the actual auth flow — if access tokens are not surfaced client-side, this needs to be fetched via the `sessionCache` or a dedicated Edge Function. Verify by inspecting `connection.access_token` at runtime. If it's the placeholder, a small Edge Function or a Supabase vault read will be needed (out of scope for this PR — add a TODO comment).

### Spotify duplicate loader (add a `loadSpotifyDuplicates` callback)

```ts
const loadSpotifyDuplicates = useCallback(async () => {
  if (!user) return;
  setIsSpotifyLoading(true);
  setSpotifyError(null);
  try {
    const found = await DuplicateDetectionService.findSpotifyDuplicates(user.id);
    setSpotifyGroups(found);
    const defaults: Record<string, string> = {};
    for (const g of found) {
      defaults[spotifyGroupKey(g)] = g.tracks[0].id;
    }
    setSpotifyKeepSelections(defaults);
    setSpotifyResolvedKeys(new Set());
  } catch (err) {
    console.error('Failed to load Spotify duplicates:', err);
    setSpotifyError('Failed to load Spotify duplicates. Please try again.');
  } finally {
    setIsSpotifyLoading(false);
  }
}, [user]);
```

Add a key helper (alongside the existing `groupKey`):
```ts
const spotifyGroupKey = (g: SpotifyDuplicateGroup) =>
  `${g.normalized_artist}\0${g.normalized_title}`;
```

Call it in the existing `useEffect`:
```ts
useEffect(() => {
  if (initialDataReady) {
    loadDuplicates();
    loadSpotifyDuplicates();  // add this
  }
}, [initialDataReady, loadDuplicates, loadSpotifyDuplicates]);
```

### Spotify resolve handler

```ts
const handleResolveSpotifyGroup = async (group: SpotifyDuplicateGroup) => {
  if (!accessToken || !user) return;
  const key = spotifyGroupKey(group);
  const keepId = spotifyKeepSelections[key];
  const deleteIds = group.tracks.map(t => t.id).filter(id => id !== keepId);

  setIsSpotifyResolving(true);
  try {
    const result = await DuplicateDetectionService.resolveSpotifyDuplicate(
      keepId,
      deleteIds,
      user.id,
      accessToken
    );
    setSpotifyResolvedKeys(prev => new Set([...prev, key]));
    toast({
      title: 'Spotify duplicates resolved',
      description: `Removed ${result.removed} track${result.removed !== 1 ? 's' : ''} from your Spotify library${result.errors.length > 0 ? ` (${result.errors.length} error${result.errors.length !== 1 ? 's' : ''})` : ''}.`,
      variant: result.errors.length > 0 ? 'destructive' : 'default',
    });
  } catch (err) {
    console.error('Failed to resolve Spotify duplicates:', err);
    toast({
      title: 'Error',
      description: 'Failed to resolve Spotify duplicates. Please try again.',
      variant: 'destructive',
    });
  } finally {
    setIsSpotifyResolving(false);
  }
};
```

### JSX structure change

Wrap the existing return JSX in `<Tabs defaultValue="local">` with two `<TabsContent>` sections:

```tsx
return (
  <div className="min-h-screen bg-background">
    <div className="container mx-auto px-4 py-8 space-y-6">

      {/* Header — keep as-is */}
      ...

      {/* Tabs */}
      <Tabs defaultValue="local">
        <TabsList>
          <TabsTrigger value="local">Local Files</TabsTrigger>
          <TabsTrigger value="spotify">Spotify Library</TabsTrigger>
        </TabsList>

        {/* ── Local Files tab (existing content, unchanged) ── */}
        <TabsContent value="local" className="space-y-6">
          {/* existing summary cards, groups, etc. */}
        </TabsContent>

        {/* ── Spotify Library tab (new) ── */}
        <TabsContent value="spotify" className="space-y-6">
          {!accessToken && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Spotify is not connected. Connect Spotify to detect duplicate liked songs.
              </AlertDescription>
            </Alert>
          )}

          {accessToken && isSpotifyLoading && (
            <p className="text-muted-foreground">Loading Spotify duplicates...</p>
          )}

          {accessToken && spotifyError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{spotifyError}</AlertDescription>
            </Alert>
          )}

          {accessToken && !isSpotifyLoading && !spotifyError && (
            <>
              {/* Summary cards */}
              {/* Pending spotify groups list — same Card/Table/RadioGroup pattern as local */}
              {/* Each group shows: title, artist, album, added_at */}
              {/* Resolve button calls handleResolveSpotifyGroup */}
            </>
          )}
        </TabsContent>
      </Tabs>

    </div>
  </div>
);
```

The Spotify group cards follow the **exact same pattern** as the existing local file group cards — `Card > CardHeader > CardTitle` with a Resolve button, `RadioGroup > Table` with one row per track. Columns for Spotify tab: **Keep**, **Title**, **Artist**, **Album**, **Added**.

---

## Data Flow (end-to-end)

```
User opens /duplicate-tracks → "Spotify Library" tab
  ↓
findSpotifyDuplicates(userId)
  → SELECT ... FROM spotify_liked WHERE user_id = ?
      GROUP BY normalized_title, normalized_artist HAVING count > 1
  → Returns SpotifyDuplicateGroup[]

User reviews groups, picks which version to keep
User clicks "Resolve"
  ↓
resolveSpotifyDuplicate(keepId, deleteIds, userId, accessToken)
  → SELECT id, spotify_id FROM spotify_liked WHERE id IN (deleteIds)
  → DELETE https://api.spotify.com/v1/me/tracks  { ids: [spotifyId1, ...] }
  → DELETE FROM spotify_liked WHERE id IN (successfullyRemovedIds)
  → Returns { removed: N, errors: [] }

UI marks group as resolved, refreshes counts
```

---

## Known Constraints / Watch-outs

| Issue | Detail |
|-------|--------|
| Access token availability | `SpotifyAuthManager.getState().connection.access_token` may return the vault placeholder `'***ENCRYPTED_IN_VAULT***'` if tokens are stored in Supabase Vault rather than in the row directly. Verify at runtime. If so, a small Edge Function to proxy the DELETE call is needed. |
| Spotify API scope | The Spotify OAuth scopes in `connectSpotify()` currently include only `user-read-private` and `user-library-read`. The `user-library-modify` scope is required to unlike tracks. **This scope must be added** to the auth URL in `spotifyAuthManager.service.ts` line ~323 and users will need to re-authenticate. |
| Spotify API rate limits | Spotify limits to 50 track IDs per DELETE call — handled by the `BATCH_SIZE = 50` loop. |
| Partial failures | If the Spotify API call succeeds but the Supabase delete fails, the track is unliked on Spotify but still appears in the DB. On next sync it will be re-added. This is acceptable for v1 — log the error and surface it in the toast. |

---

## Verification Checklist

- [ ] `npx vitest run src/services/__tests__/` — all existing tests pass
- [ ] `npm run lint` — no new lint errors
- [ ] `npm run agents:validate` — no agent violations
- [ ] Manual: open Duplicate Tracks page, Spotify tab loads without errors
- [ ] Manual: a group with 2+ semantically identical liked songs appears when present
- [ ] Manual: clicking Resolve calls `DELETE /v1/me/tracks` (verify in DevTools Network tab)
- [ ] Manual: the unliked track disappears from the Spotify mobile/desktop app
- [ ] Manual: the row is removed from `spotify_liked` in Supabase
- [ ] Manual: if Spotify is not connected, a clear notice is shown on the Spotify tab
- [ ] Manual: partial Spotify API failure surfaces correctly in the error toast
