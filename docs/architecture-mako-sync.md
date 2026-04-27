# **mako-sync Architecture Document**

**Document Version:** 1.0  
**Last Updated:** December 5, 2025

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

User-assigned `super_genre` values must survive sync operations:

1. **Before sync:** Cache manually assigned values
2. **During sync:** Store cache in `sync_progress.cached_genres` JSONB column
3. **On resume:** Load cached genres from database (not memory)
4. **After upsert:** Reapply cached values using service role client

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
2. Store `last_offset` for pagination resume
3. Cache manual genre assignments in `cached_genres` JSONB
4. On resume: load state from database, continue from `last_offset`

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

**Architecture Pattern:** Direct REST API integration from client-side

The slskd integration enables users to push missing tracks to their Soulseek download queue via the slskd REST API.

#### **Integration Flow**

```
┌──────────────────┐
│ Missing Tracks   │
│ Analysis (Client)│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ User Preferences │ (slskd config + RLS)
│ (Supabase Table) │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ slskdClient      │ (fetch API calls)
│ Service          │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ slskd REST API   │ (user's local/remote instance)
│ /api/v0/searches │
└──────────────────┘
```

#### **Key Architectural Decisions**

1. **Client-Side Integration**
   - No edge function required (public slskd API, user-provided credentials)
   - Direct fetch calls from browser to slskd instance
   - User responsible for CORS configuration on slskd

2. **Data Storage**
   - `user_preferences` table stores slskd API endpoint + API key per user
   - No sync state tracking (operations are ephemeral)
   - Duplicate prevention via real-time slskd API queries
   - User preferences protected by RLS (user isolation)

3. **Security Model**
   - **No encryption** of slskd credentials (user responsibility)
   - Stored in Supabase table (not Vault) as user's local service
   - RLS prevents cross-user access
   - API key transmitted in `X-API-Key` header

4. **Error Handling**
   - Network failures: Stop processing, preserve state, allow retry
   - 401 Unauthorized: Prompt credential re-entry
   - 429 Rate Limit: Exponential backoff with user feedback
   - Connection timeout: 10 second timeout per request

#### **Database Schema**

```sql
-- User preferences (includes slskd config)
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  slskd_api_endpoint TEXT,
  slskd_api_key TEXT,
  slskd_last_connection_test TIMESTAMPTZ,
  slskd_connection_status BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Note: No separate sync state table needed
-- Duplicate detection handled via real-time slskd API queries
```

#### **Service Pattern**

```typescript
// Client-side service (no edge function)
export class SlskdClientService {
  // All methods are static (stateless)
  static async testConnection(config: SlskdConfig): Promise<boolean>
  static async getExistingSearches(config: SlskdConfig): Promise<SlskdSearchResponse[]>
  static async addToWishlist(config: SlskdConfig, searchText: string): Promise<SlskdSearchResponse>
  static formatSearchQuery(artist: string, title: string): string
  static isSearchDuplicate(existing: SlskdSearchResponse[], newSearch: string): boolean
}
```

#### **UI Integration Points**

1. **Settings Page** (`src/pages/Security.tsx`)
   - Add slskd configuration section
   - API endpoint + API key inputs
   - Test connection button
   - Connection status indicator

2. **Missing Tracks Analyzer** (`src/components/MissingTracksAnalyzer.tsx`)
   - Add artist-level checkboxes (multi-select)
   - "Push to slskd Wishlist" button
   - Sync progress UI
   - Results summary display

#### **Multi-User Isolation**

- Each user has separate slskd configuration
- Different users can connect to different slskd instances
- RLS policies ensure users only see their own configuration (`user_preferences.user_id`)

#### **Performance Considerations**

- Small delay (100ms) between API calls to avoid rate limiting
- Batch processing with progress updates in component state
- No pagination needed (slskd handles wishlist management)
- No database writes during sync (only reads slskd API)

#### **Limitations & Future Enhancements**

**Current Scope (V1):**
- ✓ One-way sync (Mako → slskd only)
- ✓ Artist-level approval workflow
- ✓ Duplicate prevention
- ✓ Error handling and retry
- ✓ Multi-user support

**Out of Scope (Future):**
- ✗ Bi-directional sync (download status tracking)
- ✗ Quality preferences (320 MP3 only)
- ✗ Album-level or track-level approval
- ✗ Automatic periodic sync
- ✗ Download progress monitoring

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
