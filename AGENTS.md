# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## 🤖 Automated Validation

**Mako Agents Framework** - 3 agents enforcing 15 coding patterns automatically.

```bash
npm run agents:validate          # All agents
npm run agents:validate:debug    # Debug patterns only
npm run agents:validate:auth     # Auth patterns only
npm run agents:validate:code     # Code patterns only
npm run agents:test              # Run framework tests
```

📚 Full docs: [`docs/agents/`](docs/agents/) | Architecture, usage guide, phase summaries

---

## Critical Non-Obvious Patterns

- **File System Access API Required**: Local file scanning only works in Chromium browsers and fails in iframes (like Lovable preview). Must open deployed app in new tab for testing.
- **Buffer Global Required**: `music-metadata-browser` needs `window.Buffer = Buffer` set globally for MP3 parsing to work.
- **Supabase Client Import**: Always use `import { supabase } from '@/integrations/supabase/client'` - never use env vars directly.
- **TypeScript Strict Mode Disabled**: `tsconfig.app.json` has `strict: false` and disabled linting rules - project allows loose typing.
- **Service Layer Pattern**: All Supabase operations must go through `src/services/*.service.ts` files, never direct queries in components.

## Database & Edge Functions

- **No Raw SQL**: Edge functions must use Supabase client methods only, never raw SQL execution.
- **Pagination Required**: Supabase has 1000 row limit with silent truncation - use `.range()` or explicit `.limit()` for large datasets.
- **Token Storage**: Spotify tokens stored in Supabase Vault, not plain text. Connection table stores vault secret IDs.
- **RLS Patterns**: User data uses `auth.uid() = user_id`, admin access uses `has_role(auth.uid(), 'admin')` security definer function.

## Genre System Architecture

- **SUPER_GENRES Ordering**: Must be alphabetical in UI using `[...SUPER_GENRES].sort()` - array itself is not sorted.
- **Genre Mapping Validation**: Edge function accepts any spotify_genre (no strict validation), but super_genre must be valid enum.
- **Database Enum Updates**: Require separate transactions - update enum type first, then migrate data, never together.

## File Processing

- **Metadata Extraction**: Uses `music-metadata-browser` with extensive fallback logic across ID3v2.4/2.3/1.1 and vorbis tags.
- **Normalization Service**: Complex text processing for track matching - handles diacritics, punctuation, featuring artists, and mix extraction.
- **Hash Generation**: Files hashed with SHA-256 for duplicate detection using Web Crypto API.
- **Batch Processing**: Files processed in batches of 5 for metadata extraction to prevent memory issues.

## Authentication Context

- **Single Auth Context**: Only `NewAuthProvider` exists - legacy `AuthContext` removed to prevent conflicts and race conditions.
- **NewAuthProvider**: Uses complex initialization with `useRef` to prevent double-initialization and deferred data loading to avoid deadlocks.
- **Role Security**: Roles stored in separate `user_roles` table (never on profiles) to prevent privilege escalation.
- **Password Reset Flow**: Complete implementation with token validation in dedicated `/reset-password` route.
- **Auth Context Consolidation**: All components must use `@/contexts/NewAuthContext` - no legacy auth imports allowed.

## Build Commands

- `npm run build:dev` - Development build with different mode
- `npx vitest run` - Run all tests (Vitest, coverage threshold 60%)
- `npm run eval:matching` - Run track matching eval suite

## Unified Spotify Authentication

- **SpotifyAuthManager Singleton**: Must use `SpotifyAuthManager.getInstance()` - never instantiate directly, manages global state with subscription pattern
- **Connection Check Cooldown**: 5-second cooldown prevents excessive API calls - use `force: true` parameter to bypass
- **State Subscription Pattern**: Components subscribe to auth state changes via `subscribe()` method, automatically notified of updates
- **Promise Deduplication**: Multiple simultaneous connection checks return same promise to prevent race conditions
- **Unified Hook Only**: Only `useUnifiedSpotifyAuth` exists - legacy hooks removed during cleanup
- **Token Vault Storage**: Spotify tokens stored as vault secret IDs in `access_token_secret_id`/`refresh_token_secret_id` fields, actual token fields contain `***ENCRYPTED_IN_VAULT***` placeholders
- **Edge Function Timeout Requirements**: Cold-start edge functions require 45+ second timeouts for complex operations (authentication, token exchange, vault storage, database upserts)
- **Session Cache Direct Access**: Critical flows must use direct `supabase.auth.getSession()` calls to prevent cascading timeout failures from session cache wrappers
- **Supabase Client Configuration**: Never add custom fetch wrappers - use default SDK configuration to prevent conflicts with internal handling
- **Error Classification System**: Implement specific error types (NETWORK_TIMEOUT, SERVER_TIMEOUT, NETWORK_ERROR, SERVER_ERROR) for proper user messaging and debugging
- **Promise Timeout Protection**: Use `withTimeout()` utility from `src/utils/promiseUtils.ts` for operations that may hang indefinitely - critical for auth operations like signOut