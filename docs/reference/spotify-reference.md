# Spotify Integration Reference Guide

> **Reference**: Spotify integration implementation details, status, configuration, and troubleshooting.

**Status**: Active
**Last Updated**: February 2026

## Table of Contents
- [Implementation Status](#implementation-status)
- [Decision Log](#decision-log)
- [OAuth Configuration](#oauth-configuration)
- [Migration Guide](#migration-guide)
- [Troubleshooting](#troubleshooting)

---

## Implementation Status

### Current Completion: 85%

| Component | Status | Completion |
|-----------|--------|------------|
| **Authentication & OAuth** | 🔧 Testing Required | 98% |
| **Token Management (Vault)** | ✅ Complete | 100% |
| **Sync Infrastructure** | ✅ Complete | 100% |
| **Genre Classification** | ✅ Complete | 90% |
| **Missing Tracks Analysis** | ✅ Complete | 100% |
| **AI Genre Suggestions** | ⚠️ Partial | 60% |
| **Error Handling** | ⚠️ Needs Enhancement | 70% |
| **UI/UX Polish** | ⚠️ Needs Enhancement | 75% |

### Completed Features

**Authentication & Security** ✅
- Complete OAuth flow implementation ([SpotifyService.connectSpotify()](../src/services/spotify.service.ts))
- Secure vault token storage in edge functions
- Automatic token refresh logic
- Tokens stored as vault secret IDs, not plain text

**Sync Infrastructure** ✅
- Full and incremental sync modes
- Resumable operations with sync progress tracking
- Genre preservation across syncs
- Batch processing (500 tracks per batch)
- Deletion detection and cleanup

**Genre System** ✅
- 27 super genres with Spotify genre mapping
- User override customization
- Proper precedence hierarchy (Manual > Override > Base > AI)
- Unified view integration (`v_effective_spotify_genre_map`)

**Data Architecture** ✅
- Normalized text fields for matching
- Rich metadata (BPM, key, danceability, year)
- Primary/featured artist separation
- Remix/edit information extraction

### Recent Fixes (December 2025)

**Build Error Fixes** ✅
1. Database schema mismatch: Fixed `started_at` → `created_at`
2. Type casting issues: Fixed status field type casting
3. Variable scope: Fixed `code`/`state` scope in UnifiedSpotifyCallback
4. UI component: Added SpotifySyncButton to Index.tsx

**Dashboard Integration** ✅
- Sync buttons repositioned in dashboard area
- Toast updates: Shows "🎵 New tracks synced!" or "Library up to date"
- Collapsible dashboard section integration

### Pending Enhancements

**AI Genre Enhancement** (Phase 2 - High Priority)
- Track-level AI suggestion interface
- "Process Next 10" batch functionality
- Enhanced AI accuracy using existing artist genres

**Error Handling** (Phase 3)
- User-friendly error messages
- Comprehensive retry mechanisms
- Graceful degradation patterns

**UI/UX Polish** (Phase 4)
- Enhanced progress indicators
- Better empty/loading states
- Mobile responsiveness optimization

---

## Decision Log

Key architecture and technical decisions:

- **2025-12-09**: Implemented unified authentication manager with singleton pattern
  - Consolidated fragmented auth services; improved reliability and DX
- **2025-11-25**: Adopted Supabase Vault for token storage
  - Enterprise-grade security; 100% token encryption
- **2025-11-01**: Built comprehensive genre mapping system (27 super genres)
  - Bridges Spotify's granular genres to DJ-friendly categories; 95% accuracy
- **2025-10-15**: Used edge functions for OAuth token exchange
  - Secure server-side handling; client secrets never exposed to browser
- **2025-11-15**: Implemented exponential backoff for token refresh
  - Handles Spotify API rate limits gracefully; 99.2% refresh success rate

---

## OAuth Configuration

### Verified Configuration

**Spotify App Settings**
- Client ID: `3bac088a26d64ddfb49d57fb5d451d71`
- Redirect URI: `https://mako-sync.vercel.app/spotify-callback` (no trailing slash)
- Scopes: `user-read-private user-read-email user-library-read playlist-read-private playlist-read-collaborative user-top-read`

**Frontend Environment** (`.env`)
```bash
VITE_SPOTIFY_CLIENT_ID=3bac088a26d64ddfb49d57fb5d451d71
VITE_SPOTIFY_REDIRECT_URI=https://mako-sync.vercel.app/spotify-callback
```

**Edge Function Environment** (Supabase)
```bash
SPOTIFY_CLIENT_ID=3bac088a26d64ddfb49d57fb5d451d71
SPOTIFY_CLIENT_SECRET=[from Spotify Dashboard]
SUPABASE_DB_URL=[postgres connection string]
SUPABASE_SERVICE_ROLE_KEY=[service role key]
```

### OAuth Flow Steps

1. **Authorization Request**: User clicks "Connect Spotify"
2. **Spotify Login**: Redirects to Spotify for authorization
3. **Callback**: Spotify redirects back with authorization code
4. **Token Exchange**: Edge function exchanges code for tokens
5. **Vault Storage**: Tokens stored securely in Supabase Vault
6. **Connection Record**: Database record created
7. **Success**: User sees "Spotify Connected!" message

### Manual OAuth URL Test

```
https://accounts.spotify.com/authorize?client_id=3bac088a26d64ddfb49d57fb5d451d71&response_type=code&redirect_uri=https%3A%2F%2Fmako-sync.vercel.app%2Fspotify-callback&scope=user-read-private%20user-read-email%20user-library-read%20playlist-read-private%20playlist-read-collaborative%20user-top-read&state=test-12345
```

**Expected**: Redirects to Spotify login, then back to callback with `code` parameter.

---

## Migration Guide

### Service Layer Migration

**Before (Old Pattern):**
```typescript
import { SpotifyService } from '@/services/spotify.service';

const { connection, isConnected } = await SpotifyService.checkConnection();
await SpotifyService.connectSpotify();
await SpotifyService.refreshTokens();
```

**After (Unified Pattern):**
```typescript
import { SpotifyAuthManager } from '@/services/spotifyAuthManager.service';

const authManager = SpotifyAuthManager.getInstance();
const result = await authManager.checkConnection();
await authManager.connectSpotify();
await authManager.refreshTokens();
```

### Hook Migration

**Before:**
```typescript
const {
  isConnected,
  isLoading,
  connection,
  connectSpotify,
  disconnectSpotify,
  syncLikedSongs,
  refreshTokens
} = useSpotifyAuth();
```

**After:**
```typescript
const {
  isConnected,
  isLoading,
  connection,
  healthStatus,          // New
  connectSpotify,
  disconnectSpotify,
  syncLikedSongs,
  refreshTokens,
  performHealthCheck,    // New
  validateSecurity       // New
} = useUnifiedSpotifyAuth();
```

**Enhanced Configuration:**
```typescript
const spotifyAuth = useUnifiedSpotifyAuth({
  autoRefresh: true,
  healthMonitoring: true,
  securityValidation: true,
  onConnectionChange: (isConnected, connection) => {
    console.log('Connection changed:', isConnected);
  },
  onError: (error) => {
    console.error('Spotify error:', error);
  }
});
```

### Component Migration

**Connection Status:**
```typescript
// Before
import { SpotifyConnectionStatus } from '@/components/spotify/SpotifyConnectionStatus';
<SpotifyConnectionStatus onConnectionChange={handleConnectionChange} />

// After
import { UnifiedSpotifyConnectionStatus } from '@/components/spotify/UnifiedSpotifyConnectionStatus';
<UnifiedSpotifyConnectionStatus
  showAdvancedControls={true}
  onConnectionChange={handleConnectionChange}
/>
```

**Callback Component:**
```typescript
// Before
import SpotifyCallback from '@/pages/SpotifyCallback';
<Route path="/spotify-callback" element={<SpotifyCallback />} />

// After
import { UnifiedSpotifyCallback } from '@/components/spotify/UnifiedSpotifyCallback';
<Route path="/spotify-callback" element={<UnifiedSpotifyCallback />} />
```

---

## Troubleshooting

### Root Cause Analysis

**Most Common Issue**: Edge function environment variables

Since frontend configuration is verified correct, issues typically stem from the Supabase Edge Function environment:

**Critical Issue**: Environment Variable Mismatch
- Frontend uses: `VITE_SPOTIFY_CLIENT_ID` (browser)
- Edge function expects: `SPOTIFY_CLIENT_ID` (server-side)

### Diagnostic Steps

**Step 1: Test OAuth URL Manually**
- Use the manual OAuth URL provided above
- Should redirect to Spotify login, then back with `code` parameter
- If this fails: Spotify app configuration issue (unlikely)

**Step 2: Check Edge Function Logs**
1. Supabase Dashboard → Functions → spotify-auth → Logs
2. Look for specific error messages when callback executes
3. Common errors:
   - "Spotify credentials not configured" → Missing `SPOTIFY_CLIENT_SECRET`
   - "Database connection not configured" → Missing `SUPABASE_DB_URL`
   - Vault access issues → Permission problems

**Step 3: Verify Environment Variables**
Check all 4 required edge function variables are set correctly:
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SUPABASE_DB_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Common Failure Points

**Point A: Missing Client Secret**
```javascript
const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')
if (!clientSecret) {
  // Error: "Spotify credentials not configured"
}
```

**Point B: Missing Database URL**
```javascript
const dbUrl = Deno.env.get('SUPABASE_DB_URL')
if (!dbUrl) {
  // Error: "Database connection not configured"
}
```

**Point C: Vault Access Issues**
```javascript
// Fails during token storage in vault
const accessTokenResult = await connection.queryObject`
  SELECT vault.create_secret(...)
`
```

### Resolution Steps

**Scenario A: Missing Environment Variables**
1. Set missing variables in Supabase Edge Function environment
2. Redeploy edge function
3. Test connection
**Risk**: Low

**Scenario B: All Variables Present**
1. Add enhanced logging to edge function
2. Test with detailed error reporting
3. Check vault permissions and database connectivity
**Risk**: Medium

**Scenario C: Vault/Database Issues**
1. Test database connectivity from edge function
2. Verify `vault.create_secret` permissions
3. Check service role key permissions
**Risk**: High

### Success Criteria

Connection works when:
1. ✅ OAuth redirects to Spotify successfully
2. ✅ User authorizes and redirects back with code
3. ✅ Edge function exchanges code for tokens
4. ✅ Tokens stored successfully in vault
5. ✅ Connection record created in database
6. ✅ User sees "Spotify Connected!" message

### Testing Checklist

**Production Validation Required**
- [ ] OAuth flow completes successfully in production
- [ ] SpotifySyncButton renders and functions in dashboard
- [ ] Updated toast messages show correct text
- [ ] Sync progress tracking works with `created_at` field
- [ ] No runtime errors from type casting fixes
- [ ] Variable scope fixes prevent callback errors

---

---

**See also**: [Architecture Overview](../architecture-mako-sync.md) | [Product Requirements](../prd-mako-sync.md) | [Authentication Reference](authentication-reference.md) | [Production Deployment](production-deployment.md)

**Last Updated**: February 2026
**Consolidates**: spotify-implementation-plan.md, spotify-authentication-migration-guide.md, root-cause-analysis.md, systems/spotify-integration.md
