# **mako-sync Architecture Document**

**Document Version:** 1.0  
**Last Updated:** November 14, 2026

---

## **1. Overview**

This document defines the architectural requirements and patterns used in building mako-sync. It serves as the technical reference for maintaining consistency across the codebase.

---

## **2. Backend Architecture (Supabase)**

The application uses Supabase as the exclusive backend platform:

| Component | Purpose |
|-----------|---------|
| **Database** | PostgreSQL with Row Level Security (RLS) on all user-data tables |
| **Authentication** | Supabase Auth with email/password only (no OAuth providers for app auth) |
| **Edge Functions** | Deno-based serverless functions for sensitive operations |
| **Vault** | Secure storage for Spotify access/refresh tokens |

### **2.1 Edge Function Responsibilities**

* `spotify-auth` - Initiate Spotify OAuth flow
* `spotify-callback` - Handle OAuth callback, store tokens in Vault
* `spotify-sync-liked` - Sync user's liked songs from Spotify API
* `spotify-resync-tracks` - Re-fetch metadata for specific tracks
* `genre-mapping` - Retrieve/update genre mappings
* `ai-track-genre-suggest` - AI-powered genre suggestions via Anthropic Claude (claude-haiku-4-5-20251001)

### **2.2 Database Design Principles**

* **No direct SQL execution:** Edge functions MUST use Supabase client methods, never raw SQL
* **User isolation:** All user-data tables include `user_id` column with RLS policies
* **No foreign keys to auth.users:** Reference user IDs but don't create FK constraints to Supabase-managed tables
* **Additive schema changes only:** Preserve existing data and user assignments

---

## **3. Security Architecture**

### **3.1 Role Management (Critical)**

**Roles MUST be stored in a separate `user_roles` table, never on profiles or users table.**

This prevents privilege escalation attacks where users could modify their own profile to gain admin access.

```sql
-- Role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Separate roles table
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    UNIQUE (user_id, role)
);

-- Security definer function (bypasses RLS safely)
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
```

### **3.2 Row Level Security (RLS)**

All user-data tables have RLS enabled with these patterns:

| Pattern | Use Case | Example |
|---------|----------|---------|
| `auth.uid() = user_id` | User owns the row | spotify_liked, local_mp3s |
| `has_role(auth.uid(), 'admin')` | Admin access | user_roles (view all) |
| `auth.role() = 'authenticated'` | Any logged-in user | artist_genres cache |

### **3.3 Token Security**

* Spotify tokens stored in **Supabase Vault** (not plain text)
* `spotify_connections` table stores vault secret IDs:
  - `access_token_secret_id` → Vault reference
  - `refresh_token_secret_id` → Vault reference
* Token refresh handled server-side in edge functions only
* Plain text token columns contain `***MIGRATED_TO_VAULT***` marker

### **3.4 Client-Side Security Rules**

* **NEVER** check admin status via localStorage/sessionStorage
* **NEVER** hardcode credentials in frontend code
* All authorization enforced by RLS (server-side)
* Use `supabase.auth.getUser()` for current user, not cached values

---

## **4. Data Flow Patterns**

### **4.1 Spotify Sync Flow**

```
┌─────────┐     ┌─────────────────────┐     ┌─────────────┐
│ Client  │────▶│ spotify-sync-liked  │────▶│ Spotify API │
└─────────┘     │   (Edge Function)   │     └─────────────┘
                └──────────┬──────────┘
                           │
                    ┌──────▼──────┐
                    │    Vault    │ (retrieve tokens)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Database   │ (upsert tracks via service role)
                    └─────────────┘
```

### **4.2 Genre Classification Flow**

```
Track without super_genre
         │
         ▼
┌─────────────────────┐
│ Check artist_genres │──cache miss──▶ Spotify API
│      cache          │
└─────────┬───────────┘
          │ cache hit
          ▼
┌─────────────────────┐
│ Apply base mapping  │ (spotify_genre_map_base)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Check user override │ (spotify_genre_map_overrides)
└─────────┬───────────┘
          │
          ▼
   Assign super_genre
```

### **4.3 Manual Genre Persistence**

User-assigned `super_genre` values must survive sync operations (NFR-9). Neither sync type deletes `spotify_liked` rows before upserting, so overrides stay in the table for the whole sync. The upsert still writes an auto-mapped `super_genre` on every row, so for each batch, full and incremental alike:

1. **Before upsert:** Look up the batch's rows where `super_genre_manual_override = true` (`manual-genres.ts`, `loadManualGenreMap`)
2. **Upsert:** Replace the auto-mapped `super_genre` with the manual value and keep the override flag (`applyManualGenres`)

The lookup reads the live rows, so a genre edited between a pause and a resume is kept. If the lookup fails, the sync stops rather than overwrite overrides.

---

## **5. Frontend Architecture**

### **5.1 Technology Stack**

| Technology | Purpose |
|------------|---------|
| React 18+ | UI framework |
| TypeScript | Type safety |
| Vite | Build tool |
| Tailwind CSS | Styling with semantic tokens |
| TanStack React Query | Server state management |
| React Router v6 | Routing |
| shadcn/ui | UI component library (customized) |

### **5.2 State Management**

* **Server State:** TanStack React Query for all Supabase data
* **Auth State:** React Context (`AuthContext`) for session/user
* **UI State:** Local component state or URL params

### **5.3 Code Organization**

```
src/
├── components/          # React components
│   ├── ui/             # shadcn/ui base components
│   └── [Feature]/      # Feature-specific components
├── contexts/           # React contexts (Auth)
├── hooks/              # Custom hooks
├── pages/              # Route page components
├── services/           # Supabase operations (*.service.ts)
├── types/              # TypeScript interfaces
└── integrations/
    └── supabase/
        ├── client.ts   # Supabase client instance
        └── types.ts    # Auto-generated DB types (read-only)
```

### **5.4 Service Layer Pattern**

All Supabase operations go through service files:

```typescript
// ✅ Correct: Use service layer
import { SpotifyService } from '@/services/spotify.service';
const tracks = await SpotifyService.getLikedTracks(userId);

// ❌ Avoid: Direct queries in components
const { data } = await supabase.from('spotify_liked').select('*');
```

### **5.5 Supabase Client Usage**

```typescript
// Always import from integrations
import { supabase } from '@/integrations/supabase/client';

// Never use environment variables for URLs
// ❌ Wrong: import.meta.env.VITE_SUPABASE_URL
// ✅ Correct: Use the configured client
```

---

## **6. Pagination Requirements (Critical)**

Supabase queries have a **default 1000 row maximum** with silent truncation.

### **6.1 When Pagination is Required**

Any query that could return >1000 rows:
* `spotify_liked` (users may have 10,000+ tracks)
* `local_mp3s` (large local libraries)
* Genre mapping queries during sync

### **6.2 Pagination Pattern**

```typescript
async function fetchAllRows<T>(
  table: string,
  userId: string
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data?.length) break;

    results.push(...data);
    offset += PAGE_SIZE;
  }

  return results;
}
```

### **6.3 Alternative: Explicit High Limit**

For known maximum sizes:

```typescript
// When you know the upper bound
const { data } = await supabase
  .from('spotify_liked')
  .select('*')
  .eq('user_id', userId)
  .limit(50000); // Explicit limit
```

---

## **7. Edge Function Constraints**

### **7.1 CORS Handling**

All edge functions called from browser must include:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Handle preflight
if (req.method === 'OPTIONS') {
  return new Response(null, { headers: corsHeaders });
}

// Include in all responses
return new Response(JSON.stringify(data), {
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});
```

### **7.2 Isolation Requirements**

* **Cannot import from `src/` directory** - Edge functions are self-contained
* **Duplicate shared code** when necessary (normalization, types)
* **Use `Deno.env.get()`** for secrets, never hardcoded values

### **7.3 Authentication**

```typescript
// Get user from Authorization header
const authHeader = req.headers.get('Authorization');
const { data: { user }, error } = await supabaseClient.auth.getUser(
  authHeader?.replace('Bearer ', '')
);

// For public endpoints, disable JWT in config.toml:
// [functions.my-function]
// verify_jwt = false
```

### **7.4 Logging**

Always include logging for debugging:

```typescript
console.log(`[spotify-sync] Starting sync for user ${userId}`);
console.log(`[spotify-sync] Fetched ${tracks.length} tracks`);
console.error(`[spotify-sync] Error:`, error.message);
```

Logs available at: `https://supabase.com/dashboard/project/{project_id}/functions/{function_name}/logs`

---

## **8. Sync Operation Patterns**

### **8.1 Batch Sizes**

| Operation | Batch Size | Reason |
|-----------|------------|--------|
| Spotify API fetch | 50 tracks | Spotify's maximum per page |
| Database processing | 500 tracks (CHUNK_SIZE) | Balance memory vs. DB round trips |
| Artist genre batching | 50 artists | Spotify /artists API limit |

### **8.2 Resumable Sync**

Sync operations must be resumable after interruption:

1. Track progress in `sync_progress` table
2. Store `last_offset` for pagination resume. It only advances after a chunk is upserted. A pause saves the offset of the last upserted chunk, not the fetch position, so tracks still in the chunk buffer are re-fetched on resume instead of skipped
3. On resume: load state from database, continue from `last_offset`
4. Never keep state that must span the whole sync in memory, because each resume is a new invocation. Full sync stamps every upserted `spotify_liked` row with `last_seen_sync_id = sync_id`. At the end it deletes the user's rows that don't carry the stamp (tracks unliked on Spotify)

### **8.3 Final Flush Pattern**

Batch operations must flush remaining items after loop:

```typescript
let buffer: Track[] = [];
const CHUNK_SIZE = 500;

for (const track of tracks) {
  buffer.push(track);
  if (buffer.length >= CHUNK_SIZE) {
    await processChunk(buffer);
    buffer = [];
  }
}

// CRITICAL: Don't forget remaining items
if (buffer.length > 0) {
  await processChunk(buffer);
}
```

---

## **9. Design System Integration**

### **9.1 Semantic Tokens**

All colors must use HSL-based semantic tokens from `index.css`:

```css
/* ✅ Correct: Use semantic tokens */
.button { background: hsl(var(--primary)); }

/* ❌ Wrong: Direct colors */
.button { background: #3b82f6; }
```

### **9.2 Theme Support**

* Dark mode is primary (DJ preference)
* Light mode available
* All components must respect `dark:` variants

---

## **10. External Integrations**

### **10.1 slskd Integration (One-Way)**

**Architecture Pattern:** Direct REST calls from the browser to slskd on the same PC

Mako pushes the tracks you confirmed missing to slskd as searches. slskd has no wishlist and downloads nothing by itself: you download from each search on slskd's Searches page. Setup, the push rules and troubleshooting are in [slskd Reference](reference/slskd.md).

#### **Integration Flow**

```
Confirmed Missing (Review Matches tab)
        │  tracks of the selected artists, or one album
        ▼
useSlskdSync  ◄──  SlskdStorageService (localStorage: mako-sync:slskd-config)
        │
        ▼
SlskdClientService.pushTracks() / pushAlbum()
        │  GET /api/v0/searches once, then POST /api/v0/searches per track
        ▼
slskd REST API (http://localhost:5030, loopback only)
        │  each search is saved in slskd with its results
        ▼
slskd Searches page: you pick a file and download it
        │
        ▼
Downloads folder → Step 5 (Process Downloads)
```

#### **Key Architectural Decisions**

1. **Client-Side Integration**
   - No edge function: the browser calls slskd directly. slskd only listens on loopback, so the push only works in a browser on the PC that runs slskd.
   - No CORS setup: slskd allows every origin and has no option for it.
   - On production (HTTPS on Vercel), Chrome asks once per site for Local Network Access before the page can call `localhost`. Dev doesn't ask.

2. **Data Storage**
   - The config (endpoint, API key, search format, last test result) is kept in the browser's localStorage under `mako-sync:slskd-config` by `SlskdStorageService`. It isn't stored in Supabase.
   - The `user_preferences` table (migration `20260117190334_create_user_preferences.sql`) has slskd columns, but nothing reads or writes them.
   - No sync state: Mako saves nothing about a push. slskd's saved searches are the record, and every push reads them to skip duplicates. This is why `retention.search` stays unset in `slskd.yml`.

3. **Security Model**
   - The API key is sent in the `X-API-Key` header, over plain HTTP to `localhost`.
   - In `slskd.yml`, the key is limited to loopback addresses with `cidr`, and the web UI and API listen only on `127.0.0.1` and `::1`.
   - The key is stored unencrypted in localStorage.

4. **Error Handling**
   - Every request to slskd times out after 10 seconds.
   - The connection test (`GET /api/v0/application`) tells apart: connected and logged in to Soulseek, not logged in, API key rejected (`401`), unreachable or timed out, and an unexpected response. Each has its own message.
   - If the saved searches can't be read, the push stops before starting any search, the progress dialog closes, and the toast says what to check.
   - A search slskd rejects (`409`, `429`, `500`) counts as Failed, and the push moves on to the next track. There's no automatic retry. A failed track has no saved search, so the next push tries it again.

#### **Service Pattern**

```typescript
// Client-side service (no edge function). All methods are static.
export class SlskdClientService {
  static async testConnection(config: SlskdConfig): Promise<SlskdConnectionResult>
  static async getExistingSearches(config: SlskdConfig): Promise<SlskdSearchResponse[]>
  static async startSearch(config: SlskdConfig, searchText: string): Promise<SlskdSearchResponse>
  static async pushTracks(config: SlskdConfig, tracks: SlskdTrackToSync[], onProgress?): Promise<SlskdSyncResult>
  static async pushAlbum(config: SlskdConfig, track: SlskdTrackToSync & { album: string }): Promise<{ outcome; searchText }>
  static formatSearchQuery(artist: string, title: string, format?: 'primary' | 'full'): string
  static formatAlbumSearchQuery(artist: string, album: string, format?: 'primary' | 'full'): string
  static isSearchDuplicate(existing: SlskdSearchResponse[], newSearch: string): boolean
}
```

A track's search text is `Primary Artist - Title`, with no bitrate or format. `isSearchDuplicate` reads the search's `state` flags (for example `Completed, TimedOut`): it skips searches that are waiting, running or finished, and allows a retry after `Cancelled` or `Errored`. See [slskd Reference](reference/slskd.md#the-duplicate-rule).

#### **UI Integration Points**

1. **Options page** (`src/pages/Security.tsx`, route `/security`) renders `SlskdConfigSection`:
   - API endpoint, API key and search query format
   - **Save** tests the connection, then saves. **Test Connection** only tests.
   - **Connected** badge and the last test result

2. **Confirmed Missing section** (`src/components/ReviewMatches/ConfirmedMissingSection.tsx`, in the Review Matches tab)
   - Artist-level checkboxes (multi-select)
   - "Push to slskd" button, plus a per-album "Push album" button
   - Push progress dialog (`SlskdSyncProgress`)
   - Works on tracks the user confirmed missing in the review queue
   - The buttons need a saved endpoint and key

#### **Multi-User Isolation**

- The config belongs to the browser and the site, not to the Mako user. Dev, production and each Vercel preview have their own copy.
- Two Mako users signed in to the same browser and site share one slskd config.

#### **Performance Considerations**

- 100 ms between searches in a push, because slskd answers `429` while a search is still starting
- A push reads slskd's saved searches once, then checks each track against that list
- No database writes during a push
- slskd runs about two searches at a time and queues the rest, so a 100-track push takes several minutes to finish in slskd, though Mako's push returns once every search has started

#### **Limitations & Future Enhancements**

**Current Scope:**
- ✓ One-way push (Mako → slskd only)
- ✓ Artist-level push, and a per-album push
- ✓ Duplicate check against slskd's saved searches
- ✓ Connection test that checks the Soulseek login

**Out of Scope (Future):**
- ✗ Mako picking files and queuing downloads (option C in [slskd Reference](reference/slskd.md#why-the-push-only-starts-searches))
- ✗ Download status tracking
- ✗ Automatic periodic push
- ✗ Track-level selection

---

## **11. Testing Considerations**

### **11.1 RLS Testing**

Test queries with actual user context, not service role:

```typescript
// Test as specific user
const { data, error } = await supabase
  .from('spotify_liked')
  .select('*')
  .eq('user_id', testUserId);

// Verify no cross-user data leakage
expect(data.every(row => row.user_id === testUserId)).toBe(true);
```

### **11.2 Edge Function Testing**

Use Supabase dashboard or curl with auth header:

```bash
curl -X POST \
  'https://your-project-id.supabase.co/functions/v1/spotify-sync-liked' \
  -H 'Authorization: Bearer <user_jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"forceFullSync": false}'
```
