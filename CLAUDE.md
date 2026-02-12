# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mako-Sync is a web application that helps music collectors identify gaps between their Spotify liked songs and local MP3 files. Core features include Spotify library sync, local file scanning with metadata extraction, genre mapping/normalization, and missing tracks analysis.

## Commands

```bash
# Development
npm run dev              # Start Vite dev server on port 8080
npm run build            # Production build
npm run lint             # ESLint

# Testing (tests in src/services/__tests__/)
npx vitest run           # Run all tests
npx vitest run --coverage # Run with coverage
npx vitest <pattern>     # Run specific test file

# Agents framework (code validation)
npm run agents:validate  # Validate all agents
npm run agents:test      # Run agent tests (from agents/ dir)
npm run agents:fix       # Auto-fix violations
```

## Architecture

### Frontend Stack
- **React 18** with TypeScript, Vite, React Router
- **UI**: shadcn/ui components (in `src/components/ui/`), Tailwind CSS
- **State**: TanStack Query for server state, React Context for auth
- **Path alias**: `@/` maps to `src/`

### Backend
- **Supabase**: Auth, PostgreSQL database, Edge Functions, Vault (for OAuth tokens)
- **Edge Functions** (`supabase/functions/`):
  - `spotify-auth` / `spotify-callback` - OAuth flow
  - `spotify-sync-liked` - Sync liked songs with progress tracking
  - `spotify-resync-tracks` - Re-apply genre mappings
  - `genre-mapping` - Fetch/export genre mappings
  - `ai-track-genre-suggest` - AI genre recommendations

### Key Database Tables
- `spotify_liked` - User's Spotify liked songs
- `local_mp3s` - Scanned local files with metadata
- `spotify_genre_map_base` / `spotify_genre_map_overrides` - Genre mappings
- `spotify_connections` - OAuth tokens (encrypted in vault)
- `sync_progress` - Tracks sync state for resume capability

### Key Services (`src/services/`)
- `normalization.service.ts` - Text normalization for track matching (critical for matching accuracy)
- `metadataExtractor.ts` - MP3 metadata extraction using music-metadata-browser
- `spotifyAuthManager.service.ts` - Spotify connection management
- `trackMatching.service.ts` - Matching logic between Spotify and local files
- `sessionCache.service.ts` - Auth session caching with timeouts

### Auth Flow
- Auth context: `src/contexts/NewAuthContext.tsx`
- Protected routes use `NewProtectedRoute` component
- Spotify OAuth handled via Edge Functions with PKCE flow
- Session validation with startup validator service

### Agents Framework (`agents/`)
Custom code validation framework for enforcing project patterns:
- `DebugAgent` - Pagination, timeouts, fetch wrapper rules
- `AuthAgent` - Auth context consolidation rules
- `CodeAgent` - Service layer, Supabase imports, edge function isolation

## Important Patterns

### Supabase Client Import
Always import from the integration path:
```typescript
import { supabase } from '@/integrations/supabase/client';
```

### Query Timeouts
Use `withTimeout` for database operations to prevent hangs (45+ seconds for edge functions with cold starts):
```typescript
import { withTimeout } from '@/utils/promiseUtils';
const result = await withTimeout(promise, 60000, 'Operation timed out');
```

### Batch Processing
For large data operations (6k+ files), batch inserts/updates to avoid timeouts:
```typescript
const DB_BATCH_SIZE = 100;
for (let i = 0; i < items.length; i += DB_BATCH_SIZE) {
  const batch = items.slice(i, i + DB_BATCH_SIZE);
  await supabase.from('table').upsert(batch);
}
```

### Normalization for Matching
Track matching relies on normalized metadata. The `NormalizationService` handles:
- Unicode normalization (NFKC)
- Case folding, accent removal
- Feature artist extraction ("feat.", "ft.")
- Mix/version extraction from parentheses

## Routes

- `/` - Main dashboard (protected)
- `/auth` - Login/signup
- `/genre-mapping` - Genre mapping management
- `/no-genre-tracks` - AI-assisted genre classification
- `/spotify-callback` - OAuth callback handler
- `/security` - Security settings

## Critical Patterns

See [AGENTS.md](AGENTS.md) for additional critical non-obvious patterns including:
- File System API browser limitations
- Buffer global requirement for MP3 parsing
- Supabase 1000-row pagination limits
- SpotifyAuthManager singleton usage
- Session cache direct access requirements

## Documentation

All documentation lives in the `docs/` folder. See [docs/README.md](docs/README.md) for the full navigation hub and documentation template.

**File naming**: lowercase with dashes (e.g., `setup-guide.md`).

**Key documentation:**
- [docs/mako-sync-overview.md](docs/mako-sync-overview.md) - Product overview and 5-step workflow
- [docs/architecture-mako-sync.md](docs/architecture-mako-sync.md) - System architecture
- [docs/reference/production-deployment.md](docs/reference/production-deployment.md) - Deployment and configuration

**Documentation locations:**

| Location | Purpose |
|----------|---------|
| Root (`README.md`, `CLAUDE.md`, `AGENTS.md`) | Short, high-signal entry points |
| `docs/` (root level) | Product vision and architecture |
| `docs/reference/` | Implementation guides, debugging, deployment |
| `docs/plans/` | Active feature implementation plans |
| `docs/agents/` | Validation framework documentation |
| `docs/archive/` | Historical docs (read-only, not maintained) |
| `agents/README.md` | Framework quick start (points to docs/agents/) |
