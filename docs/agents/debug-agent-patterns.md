# Debug Agent — Pattern Knowledge Base

This document is the authoritative source for the Debug Agent's known problem patterns in Mako-Sync. Each entry includes the rule, how to detect it in code, correct and incorrect examples drawn from this codebase, and the files most at risk.

---

## Pattern 1 — Supabase 1000-row pagination limit

**Rule:** Any `supabase.from(...).select(...)` call that may return more than 1000 rows must use `.range(start, end)` in a pagination loop — Supabase silently truncates at 1000 with no error.

**Detection signal:**
- `.from(` + `.select(` in the same query chain
- No `.range(` or `.limit(` anywhere in the same chained call
- The table involved is `local_mp3s`, `spotify_liked`, or any user-scoped table that grows unboundedly

**Correct example** (`src/services/trackMatching.service.ts:39`):
```typescript
// Pages through results — handles collections > 1000 tracks
const { data, error } = await supabase
  .from('local_mp3s')
  .select('id, title, artist, primary_artist, album, genre, file_path')
  .eq('user_id', userId)
  .range(offset, offset + PAGE_SIZE - 1);
```

**Incorrect example:**
```typescript
// Silent truncation — returns at most 1000 rows, no error
const { data, error } = await supabase
  .from('local_mp3s')
  .select('id, title, artist')
  .eq('user_id', userId);
```

**Files most at risk:**
- `src/services/trackMatching.service.ts` — fetches full local library for matching
- `src/hooks/useLocalScanner.ts` — loads existing hashes on rescan
- `src/components/LocalTracksTable.tsx` — table display query
- `src/components/StatsOverview.tsx` — counts/aggregates across full library
- `src/components/MissingTracksAnalyzer.tsx` — loads both Spotify and local sets

---

## Pattern 2 — `withTimeout` requirement for DB and edge function calls

**Rule:** All database operations and edge function calls must be wrapped with `withTimeout` from `src/utils/promiseUtils.ts`. `PostgrestFilterBuilder` is not a native `Promise` — convert it via `.then(r => r)` before passing to `withTimeout`, otherwise the timeout is silently bypassed.

**Detection signal:**
- `supabase.from(...)` or `supabase.functions.invoke(...)` call that is `await`ed directly without `withTimeout`
- `withTimeout(supabase.from(...).select(...), ...)` missing the `.then(r => r)` conversion
- Edge function invocations without a timeout ≥ 120s (cold starts can take up to that)

**Correct example** (`src/hooks/useLocalScanner.ts`):
```typescript
import { withTimeout } from '@/utils/promiseUtils';

const result = await withTimeout(
  supabase
    .from('local_mp3s')
    .upsert(batch)
    .then(r => r),  // converts PostgrestFilterBuilder to a real Promise
  DB_UPSERT_TIMEOUT_MS,
  'batch upsert timed out'
);
```

**Incorrect examples:**
```typescript
// Missing withTimeout — hangs indefinitely on network stall
const { data, error } = await supabase.from('local_mp3s').select('*');

// Missing .then(r => r) — withTimeout receives a non-Promise, never fires
const result = await withTimeout(
  supabase.from('local_mp3s').select('*'),
  60000,
  'timed out'
);
```

**Files most at risk:**
- `src/services/genreMapping.service.ts:9` — `supabase.functions.invoke('genre-mapping', ...)` currently unprotected (no `withTimeout`)
- `src/services/trackMatching.service.ts` — large fetch on slow connections
- `src/services/auth.service.ts` — auth operations that can hang
- Any new service that adds a `supabase.functions.invoke()` call

---

## Pattern 3 — Auth event settle window

**Rule:** A tab visibility change triggers `TOKEN_REFRESHED` then `SIGNED_IN` in sequence. The Supabase client's internal `setSession` lock (up to 1000ms) may still be held after `TOKEN_REFRESHED` fires. Any DB write issued before both events have settled for 1500ms will race the lock and fail with a stale/missing token.

**Detection signal:**
- `onAuthStateChange` listener that acts on `TOKEN_REFRESHED` or `SIGNED_IN` without a settle window
- DB writes (`.upsert`, `.insert`, `.update`) inside or immediately after an auth event handler
- Missing `tokenRefreshSettledAt` guard before a batch operation in a long-running function

**Correct example** (`src/hooks/useLocalScanner.ts:51-58`):
```typescript
const TOKEN_REFRESH_SETTLE_MS = 1500;
let tokenRefreshSettledAt = 0;

supabase.auth.onAuthStateChange((event) => {
  if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
    tokenRefreshPending = true;
    tokenRefreshSettledAt = Date.now() + TOKEN_REFRESH_SETTLE_MS;
  }
});

// Before each batch write:
if (tokenRefreshPending && Date.now() < tokenRefreshSettledAt) {
  await new Promise(resolve => setTimeout(resolve, tokenRefreshSettledAt - Date.now()));
  tokenRefreshPending = false;
}
```

**Incorrect example:**
```typescript
// Acts immediately on TOKEN_REFRESHED — setSession lock may still be held
supabase.auth.onAuthStateChange(async (event) => {
  if (event === 'TOKEN_REFRESHED') {
    await supabase.from('local_mp3s').upsert(pendingBatch); // race condition
  }
});
```

**Files most at risk:**
- `src/hooks/useLocalScanner.ts` — long-running scan with mid-scan token refreshes
- `src/services/tokenPersistenceGateway.service.ts` — token verification logic
- Any new feature that does background writes while the user may switch tabs

---

## Pattern 4 — Scan contention

**Rule:** Long-running file scan operations (hash loading, batch upserts) compete with UI table queries on the same Supabase connection pool. When a scan is in progress, UI queries must be suppressed by aborting their `AbortController` and skipping new fetches until the scan completes.

**Detection signal:**
- `FileUploadScanner` or `useLocalScanner` used alongside a data table component (`LocalTracksTable`) without an `isScanInProgress` prop wired through
- A `useQuery` or direct Supabase fetch in a table component that does not check `isScanInProgress` before executing
- Missing `onScanningChange` callback from `FileUploadScanner` to the parent that owns the table

**Correct example** (`src/pages/Index.tsx` → `src/components/LocalTracksTable.tsx`):
```typescript
// In Index.tsx — pass scan state down
<FileUploadScanner onScanningChange={setIsScanInProgress} />
<LocalTracksTable isScanInProgress={isScanInProgress} />

// In LocalTracksTable.tsx — suppress query during scan
const { data } = useQuery({
  queryKey: ['local-tracks'],
  queryFn: fetchLocalTracks,
  enabled: !isScanInProgress,  // key guard
});
```

**Incorrect example:**
```typescript
// Table always fetches — competes with scan for connection pool
<FileUploadScanner />
<LocalTracksTable />  // no isScanInProgress prop, always queries
```

**Files most at risk:**
- `src/pages/Index.tsx` — orchestrates scanner and table together
- `src/components/LocalTracksTable.tsx` — must respect `isScanInProgress`
- `src/components/FileUploadScanner.tsx` — must emit `onScanningChange`
- Any new page that embeds both a scanner and a live data table

---

## Pattern 5 — Buffer global setup

**Rule:** `music-metadata-browser` requires `window.Buffer` to be set before any parse call. Missing setup causes silent parse failures — the library returns empty metadata with no error thrown.

**Detection signal:**
- `import ... from 'music-metadata-browser'` or `parseBlob(` in a file
- No `window.Buffer = Buffer` or `globalThis.Buffer = Buffer` earlier in the same file (or in a guaranteed-earlier module)
- The `import { Buffer } from 'buffer'` import is missing alongside the setup line

**Correct example** (`src/services/downloadProcessor.service.ts:29-31` — use this as the reference to copy):
```typescript
import { parseBlob } from 'music-metadata-browser';
import { Buffer } from 'buffer';

// Must appear before any parseBlob() call
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}
```

**Incorrect example:**
```typescript
import { parseBlob } from 'music-metadata-browser';
// Buffer never set — parseBlob() returns empty tags silently

const metadata = await parseBlob(file);  // fails silently
```

**Files most at risk:**
- `src/services/metadataExtractor.ts` — primary parse entry point
- `src/services/downloadProcessor.service.ts` — already correct, use as reference
- Any new service or component that calls `parseBlob()` directly

---

## Pattern 6 — SpotifyAuthManager singleton

**Rule:** `SpotifyAuthManager` must always be accessed via `SpotifyAuthManager.getInstance()`. Direct instantiation with `new SpotifyAuthManager(...)` creates a second instance with its own state, breaking the singleton contract and causing auth state divergence.

**Detection signal:**
- `new SpotifyAuthManager(` anywhere outside `src/services/spotifyAuthManager.service.ts`
- `SpotifyAuthManager` imported but `.getInstance()` not called

**Correct example:**
```typescript
import { SpotifyAuthManager } from '@/services/spotifyAuthManager.service';

const manager = SpotifyAuthManager.getInstance();
const state = manager.getState();
```

**Incorrect example:**
```typescript
import { SpotifyAuthManager } from '@/services/spotifyAuthManager.service';

// Creates a second instance — state is isolated from the rest of the app
const manager = new SpotifyAuthManager();
```

**Files most at risk:**
- `src/hooks/useUnifiedSpotifyAuth.ts` — primary consumer, must use getInstance()
- `src/components/DuplicateTracksManager.tsx` — uses auth state
- `src/services/tokenPersistenceGateway.service.ts` — interacts with auth state
- Any new hook or component that needs Spotify connection state

---

## Pattern 7 — Session cache direct access

**Rule:** In critical auth flows (auth context, login, OAuth callback), session state must be read via `supabase.auth.getSession()` directly, not through the `sessionCache` wrapper. The cache's 8-second internal timeout can produce a false-negative session result during cold-start or recovery flows, causing the user to appear signed out when they are not.

**Detection signal:**
- `sessionCache.getSession()` called in a file whose path contains `/auth/`, `/contexts/`, `AuthContext`, `Login`, or `Callback`
- The file is not `sessionCache.service.ts` itself
- The file is not a Spotify OAuth callback handler (Spotify callback uses cache correctly)

**Correct example** (`src/contexts/NewAuthContext.tsx`):
```typescript
// Direct call — no timeout wrapper, returns the live session
const { data: { session }, error } = await supabase.auth.getSession();
```

**Incorrect example:**
```typescript
// In NewAuthContext.tsx — the cache timeout masks a valid session during recovery
const { session } = await sessionCache.getSession();
```

**Files most at risk:**
- `src/contexts/NewAuthContext.tsx` — bootstraps auth state for the whole app
- `src/services/startupSessionValidator.service.ts` — validates session on startup
- Any new auth context or login page component

---

## Pattern 8 — Second Supabase client with competing fetch config

**Rule:** Never create a second Supabase client instance with a competing `global.fetch` configuration. The shared client at `src/integrations/supabase/client.ts` is already configured with `fetchWithTimeout` (150s for edge functions, 30s for DB/auth). A second client with its own fetch or AbortController creates conflicting timeout and abort behaviours. Raw `fetch()` calls in non-Supabase services (e.g. `slskdClient.service.ts` calling the slskd REST API) are not a violation of this pattern.

**Detection signal:**
- `createClient(` call outside `src/integrations/supabase/client.ts`
- `global: { fetch: ... }` in a `createClient` config block paired with `AbortController` or `signal:`
- `import { createClient } from '@supabase/supabase-js'` in any file that is not `src/integrations/supabase/client.ts`
- **Not a violation:** raw `fetch(url, options)` calls in services that communicate with non-Supabase APIs (slskd, Discogs, Spotify REST endpoints called directly)

**Correct example** (`src/integrations/supabase/client.ts:60-84`):
```typescript
// Single shared client with a safe fetchWithTimeout wrapper
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: fetchWithTimeout   // defined once, used by all callers
  }
});
```
All other files import this:
```typescript
import { supabase } from '@/integrations/supabase/client';
```

**Incorrect example:**
```typescript
// Creates a second client with its own fetch — conflicts with shared client
import { createClient } from '@supabase/supabase-js';
const controller = new AbortController();
const localSupabase = createClient(url, key, {
  global: { fetch: (u, o) => fetch(u, { ...o, signal: controller.signal }) }
});
```

**Files most at risk:**
- Any new Edge Function utility file that might initialise its own client
- Any test helper or debug utility that creates a standalone Supabase client
- `src/integrations/supabase/client.ts` — the reference implementation; do not duplicate

---

## Pattern 9 — Discogs instance_id vs release_id field confusion

**Rule:** The `discogs_instance_id` column in `physical_media` must store the Discogs **collection instance ID** (`item.id` from the collection API response), not the release ID (`item.basic_information.id`). The dedup loop keys on `discogs_instance_id`; if the wrong field is stored, every item appears "new" on every sync and a duplicate row is inserted alongside the corrupt original.

**Detection signal:**
- `discogs_instance_id` values in the DB equal to `discogs_release_id` values (run: `SELECT count(*) FROM physical_media WHERE discogs_instance_id = discogs_release_id`)
- `discogs_instance_id IS NULL` for synced (non-manually-added) records
- Duplicate rows sharing the same `discogs_release_id` / `discogs_master_id` but with different `discogs_instance_id`

**PostgreSQL NULL behaviour to remember:** `NULL ≠ NULL` in unique index evaluation. Both a full unique index and a partial unique index allow unlimited NULL values per user in the same column. A corrupt row with `discogs_instance_id = NULL` and a correct row with a real instance_id will never conflict on the unique index — they coexist silently.

**Correct example** (`supabase/functions/discogs-pull-sync/index.ts`):
```typescript
// item.id  = Discogs instance_id  (unique per collection entry)
// item.basic_information.id = release_id  (shared across copies of the same release)
discogs_instance_id: item.id,
discogs_release_id:  item.basic_information.id ?? null,
```

**Incorrect example:**
```typescript
// Stores release_id in the instance_id column — dedup will always miss existing rows
discogs_instance_id: item.basic_information.id,
```

**Recovery SQL** (run in Supabase SQL editor, then trigger a fresh sync):
```sql
DELETE FROM public.physical_media
WHERE discogs_instance_id IS NULL
   OR discogs_instance_id = discogs_release_id;
```

**Files most at risk:**
- `supabase/functions/discogs-pull-sync/index.ts` — primary sync writer
- Any future edge function that writes to `physical_media`

---

## Investigation guidance — database-first debugging

When a symptom involves missing, duplicate, or unexpected rows in any table, **ask the user to inspect the Supabase table editor or run SQL queries first** before reading code. Real data resolves hypotheses that code analysis cannot. Useful queries to request early:

```sql
-- Are there actual duplicates by the natural key?
SELECT <key_column>, count(*) FROM <table> GROUP BY <key_column> HAVING count(*) > 1;

-- Does the unique index exist and is it the right shape?
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '<table>';

-- Are there corrupt sentinel values (field storing wrong ID)?
SELECT count(*) FROM <table> WHERE discogs_instance_id = discogs_release_id;
```

**For edge function bugs specifically:** before reading edge function code, ask whether the related **database migration has been applied**. An edge function deployed before its migration runs will operate against the old schema — the bug may be in the deployment order, not the code. The signal is an error like "there is no unique or exclusion constraint matching the ON CONFLICT specification", which means the code references a constraint that doesn't exist yet in the DB.
