# Production Deployment Guide

> **Reference**: Complete deployment guide covering environment setup, Spotify configuration, Supabase configuration, and troubleshooting.

**Status**: Active
**Last Updated**: February 2026

## Table of Contents
- [Quick Setup](#quick-setup)
- [Environment Variables](#environment-variables)
- [Spotify App Configuration](#spotify-app-configuration)
- [Supabase Configuration](#supabase-configuration)
- [Database Verification](#database-verification)
- [Deployment Checklist](#deployment-checklist)
- [Troubleshooting](#troubleshooting)

---

## Quick Setup

### Automated Deployment
```bash
# One-command setup (applies migrations, deploys functions, validates)
./scripts/deploy-phase4.sh
```

### Manual CLI Setup
```bash
# 1. Authenticate with Supabase
supabase login
supabase link --project-ref your-project-id

# 2. Apply database migrations
supabase db push

# 3. Enable vault extension (if not already enabled)
# Supabase Dashboard → Database → Extensions → Enable "vault"

# 4. Set edge function secrets
supabase secrets set SPOTIFY_CLIENT_ID=your_client_id
supabase secrets set SPOTIFY_CLIENT_SECRET=your_client_secret
supabase secrets set SUPABASE_DB_URL=your_connection_string

# 5. Deploy edge functions
supabase functions deploy spotify-sync-liked
supabase functions deploy spotify-auth
supabase functions deploy spotify-callback
```

### How to Get Credentials

**Spotify Client ID & Secret:**
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create or select your app
3. Copy **Client ID** and click "Show Client Secret" for the secret

**Supabase Database URL:**
1. [Supabase Dashboard](https://supabase.com/dashboard) → Select project
2. **Settings → Database → Connection String** → Select "URI" tab
3. Format: `postgresql://postgres:PASSWORD@db.PROJECT_ID.supabase.co:5432/postgres`

---

## Environment Variables

### Frontend Environment (Vercel)

```bash
# Spotify Configuration
VITE_SPOTIFY_CLIENT_ID=3bac088a26d64ddfb49d57fb5d451d71
VITE_SPOTIFY_REDIRECT_URI=https://mako-sync.vercel.app/spotify-callback

# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Backend Environment (Supabase Edge Functions)

```bash
# Spotify Credentials
SPOTIFY_CLIENT_ID=3bac088a26d64ddfb49d57fb5d451d71
SPOTIFY_CLIENT_SECRET=your_production_spotify_client_secret

# Database Connection
SUPABASE_DB_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_ID.supabase.co:5432/postgres
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Configuration Notes

**Important Fixes Applied:**
- ✅ Removed hardcoded client ID fallbacks from `src/services/spotify.service.ts`
- ✅ Removed hardcoded redirect URI from `supabase/functions/spotify-auth/index.ts`
- ✅ Added explicit `VITE_SPOTIFY_REDIRECT_URI` for production consistency

**Case Sensitivity:**
- Environment variable names are **case-sensitive**
- Frontend uses `VITE_` prefix for browser access
- Edge functions use plain names (no prefix)

---

## Spotify App Configuration

### Verified Production Settings

**Client ID:** `3bac088a26d64ddfb49d57fb5d451d71`
**Status:** ✅ Confirmed in Spotify Dashboard

### Required Redirect URIs

Add these **exact** URIs to your Spotify app (case-sensitive):

✅ **Production:**
```
https://mako-sync.vercel.app/spotify-callback
```

✅ **Development:**
```
http://localhost:8080/spotify-callback
http://localhost:3000/spotify-callback
```

### Common Configuration Errors

❌ **Avoid these mistakes:**
- `https://mako-sync.vercel.app/spotify-callback/` (trailing slash)
- `https://www.mako-sync.vercel.app/spotify-callback` (www subdomain)
- `http://mako-sync.vercel.app/spotify-callback` (HTTP instead of HTTPS)
- `https://mako-sync.vercel.app/callback` (wrong path)

### Required Scopes

Verify these scopes are enabled in your Spotify app:
```
user-read-private
user-read-email
user-library-read
playlist-read-private
playlist-read-collaborative
user-top-read
```

### App Mode Settings

**Development Mode:**
- Only works for users explicitly added to the app
- Go to "Users and Access" to add test users
- Limited to 25 users

**Extended Quota Mode:**
- Works for 25 users without restrictions

**Production Mode:**
- Works for all users
- Requires Spotify approval process

### Client Secret Management

**Location:** Spotify Developer Dashboard → Your App → Settings
- Click "Show Client Secret" to view
- **Never expose** in frontend code or version control
- If regenerated, immediately update in Supabase edge function environment

---

## Supabase Configuration

### Finding Your Database URL

**Method 1: Supabase Dashboard**
1. Navigate to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings → Database → Connection String**
4. Select "URI" tab for direct connection string

**Method 2: Manual Construction**

Format:
```
postgresql://postgres:YOUR_DATABASE_PASSWORD@db.your-project-id.supabase.co:5432/postgres
```

**To get components:**
- **Host:** Always `db.your-project-id.supabase.co`
- **Port:** Always `5432`
- **Database:** Always `postgres`
- **User:** Always `postgres`
- **Password:** Your project database password (Settings → Database)

**If you don't remember your password:**
1. Go to Settings → Database
2. Find "Reset database password" section
3. Generate new password and update connection string

### Configuring Edge Function Environment

**Step 1: Access Edge Function Settings**
1. Supabase Dashboard → Settings → Edge Functions
2. Click "Manage environment variables"

**Step 2: Add Required Variables**

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `SPOTIFY_CLIENT_ID` | `3bac088a26d64ddfb49d57fb5d451d71` | Public client ID |
| `SPOTIFY_CLIENT_SECRET` | From Spotify Dashboard | **Private - never expose** |
| `SUPABASE_DB_URL` | See format above | **Includes password** |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase Settings → API | **Private - full access** |

### Security Validation

**Vault Storage Checklist:**
- ✅ Tokens stored in Supabase Vault (not plain text)
- ✅ No credentials exposed in client-side code
- ✅ Proper RLS policies for data access
- ✅ Secure session management

**Access Control:**
- Frontend only has access to client ID (public)
- Backend edge functions have access to client secret (private)
- Database credentials restricted to edge function environment only

---

## Database Verification

Run these queries in **Supabase Dashboard → SQL Editor** to verify configuration:

```sql
-- Check user_roles table exists
SELECT * FROM information_schema.tables WHERE table_name = 'user_roles';

-- Check has_role security function exists
SELECT * FROM information_schema.routines WHERE routine_name = 'has_role';

-- Check sync_progress has cached_genres column
SELECT column_name FROM information_schema.columns
WHERE table_name = 'sync_progress' AND column_name = 'cached_genres';

-- Check vault extension is enabled
SELECT * FROM pg_extension WHERE extname = 'vault';

-- Test vault is working
SELECT vault.create_secret('test-secret', 'test-value');
```

You can also run the automated validation script:
```bash
# In Supabase SQL Editor
\i scripts/validate-phase4-config.sql
```

---

## Deployment Checklist

### Pre-Deployment Verification

**Spotify Configuration:**
- [ ] Client ID matches: `3bac088a26d64ddfb49d57fb5d451d71`
- [ ] Redirect URI registered: `https://mako-sync.vercel.app/spotify-callback`
- [ ] Client secret is current (not recently regenerated)
- [ ] All required scopes enabled
- [ ] App mode appropriate for user count

**Frontend Environment (Vercel):**
- [ ] `VITE_SPOTIFY_CLIENT_ID` set correctly
- [ ] `VITE_SPOTIFY_REDIRECT_URI` set to production URL
- [ ] `VITE_SUPABASE_URL` configured
- [ ] `VITE_SUPABASE_ANON_KEY` configured

**Backend Environment (Supabase):**
- [ ] `SPOTIFY_CLIENT_ID` matches frontend
- [ ] `SPOTIFY_CLIENT_SECRET` from Spotify Dashboard
- [ ] `SUPABASE_DB_URL` connection string correct
- [ ] `SUPABASE_SERVICE_ROLE_KEY` configured

**Code Verification:**
- [ ] No hardcoded credentials in codebase
- [ ] `.env` file not committed to version control
- [ ] Build passes without errors
- [ ] Type errors resolved

### Manual OAuth URL Test

Before deploying, test this URL manually:
```
https://accounts.spotify.com/authorize?client_id=3bac088a26d64ddfb49d57fb5d451d71&response_type=code&redirect_uri=https%3A%2F%2Fmako-sync.vercel.app%2Fspotify-callback&scope=user-read-private%20user-read-email%20user-library-read%20playlist-read-private%20playlist-read-collaborative%20user-top-read&state=test-12345
```

**Expected Results:**
- ✅ Redirects to Spotify login
- ✅ Shows correct app name and permissions
- ✅ After authorization, redirects to callback URL with `code` parameter

**Error Indicators:**
- ❌ "Invalid redirect URI" → Configuration mismatch
- ❌ "Invalid client" → Client ID incorrect
- ❌ "Access denied" → App in Development mode, user not added

### Post-Deployment Testing

**OAuth Flow:**
- [ ] Click "Connect Spotify" in app
- [ ] Redirects to Spotify OAuth consent (not login page)
- [ ] After authorization, returns to app dashboard
- [ ] Connection status shows "Connected"
- [ ] No console errors during flow

**Sync Operations:**
- [ ] Sync button visible in dashboard
- [ ] Click sync triggers operation
- [ ] Toast shows "🎵 New tracks synced!" or "Library up to date"
- [ ] Dashboard counts update correctly
- [ ] No database errors in Supabase logs

**Token Management:**
- [ ] Check Supabase logs: tokens stored in vault (not plain text)
- [ ] Verify connection persists after page reload
- [ ] Test token refresh works automatically
- [ ] Disconnection properly clears vault entries

---

## Troubleshooting

### Common Issues & Solutions

#### "Invalid redirect URI" Error

**Cause:** Redirect URI not exactly registered in Spotify app
**Solution:**
1. Check Spotify Dashboard → Edit Settings → Redirect URIs
2. Verify exact match: `https://mako-sync.vercel.app/spotify-callback`
3. No trailing slash, correct protocol (https)

#### "Invalid client" Error

**Cause:** Client ID mismatch
**Solution:**
1. Verify `VITE_SPOTIFY_CLIENT_ID` = `3bac088a26d64ddfb49d57fb5d451d71`
2. Check `SPOTIFY_CLIENT_ID` in edge function matches
3. Confirm value in Spotify Dashboard

#### "State Parameter Mismatch" Error

**Cause:** Cross-domain storage or URL encoding issues
**Solution:**
1. Check browser console for detailed state debugging
2. Clear browser storage: `localStorage.clear(); sessionStorage.clear();`
3. Check for cross-domain cookie blocking
4. Review Supabase edge function logs for server-side errors

#### "Spotify credentials not configured"

**Cause:** Missing `SPOTIFY_CLIENT_SECRET` in edge function
**Solution:**
1. Go to Supabase Dashboard → Settings → Edge Functions → Environment Variables
2. Add `SPOTIFY_CLIENT_SECRET` with value from Spotify Dashboard
3. Redeploy edge function

#### "Database connection not configured"

**Cause:** Missing or invalid `SUPABASE_DB_URL`
**Solution:**
1. Construct database URL: `postgresql://postgres:PASSWORD@db.PROJECT_ID.supabase.co:5432/postgres`
2. Verify password is correct
3. Add to edge function environment variables

#### Redirects to Spotify Login Instead of OAuth

**Cause:** Client ID or redirect URI mismatch
**Solution:**
1. Verify all environment variables deployed correctly to Vercel
2. Hard refresh browser (Ctrl+Shift+R)
3. Check that Vercel environment variables are active (not preview-only)

#### Vault Access Issues

**Cause:** Permission problems with token storage
**Solution:**
1. Check `SUPABASE_SERVICE_ROLE_KEY` is set correctly
2. Verify edge function has vault access permissions
3. Test database connectivity: Run simple query in SQL Editor
4. Check Supabase logs for specific vault error messages

### Diagnostic Workflow

**Step 1: Frontend Check**
- Open browser DevTools → Network tab
- Filter by "spotify" or "auth"
- Look for failed requests
- Check request/response headers

**Step 2: Edge Function Logs**
1. Supabase Dashboard → Functions → spotify-auth → Logs
2. Look for errors during callback execution
3. Check for environment variable errors
4. Verify database connection attempts

**Step 3: Database Verification**
1. Supabase Dashboard → SQL Editor
2. Run: `SELECT 'Database connection successful' as status;`
3. Check if vault extension enabled: `SELECT * FROM pg_extension WHERE extname = 'vault';`

### Performance Benchmarks

**Expected Metrics:**
- **OAuth Success Rate:** 99%+
- **Connection Time:** < 10 seconds
- **Token Storage:** 100% vault-encrypted
- **Sync Operations:** < 2 minutes for typical library

### Getting Help

When reporting deployment issues, include:
1. **Environment:** Production/staging/development
2. **Error Messages:** Exact text from console/logs
3. **Configuration:** Which variables are set (not values)
4. **Steps to Reproduce:** Exact sequence of actions
5. **Expected vs Actual:** What should happen vs what does happen

**Log Collection:**
```bash
# Check Vercel deployment logs
vercel logs <deployment-url>

# Check Supabase function logs
# Via dashboard: Functions → spotify-auth → Logs
```

---

## Security Best Practices

### Never Expose in Version Control
- ❌ Client secrets
- ❌ Database passwords
- ❌ Service role keys
- ❌ API keys

### Environment Variable Storage
- ✅ Vercel: Project settings → Environment Variables
- ✅ Supabase: Settings → Edge Functions → Environment Variables
- ❌ Never in `.env` files committed to Git

### Credential Rotation
- Rotate Spotify client secret if exposed
- Update database password periodically
- Regenerate service role key if compromised
- Update all locations when rotating credentials

---

## Quick Reference

### URLs Format Validation

**Must be exact (case-sensitive):**
- Protocol: `https://` (not `http://`)
- Domain: `mako-sync.vercel.app` (no `www.`)
- Path: `/spotify-callback` (no trailing `/`)

### Environment Variable Mapping

| Location | Variable | Value Type |
|----------|----------|------------|
| Frontend | `VITE_SPOTIFY_CLIENT_ID` | Public |
| Edge Function | `SPOTIFY_CLIENT_ID` | Public |
| Edge Function | `SPOTIFY_CLIENT_SECRET` | **Private** |
| Edge Function | `SUPABASE_DB_URL` | **Private** |

### Configuration Files Modified

**Fixed Hardcoded Values:**
- `src/services/spotify.service.ts` - Removed client ID fallback
- `supabase/functions/spotify-auth/index.ts` - Removed redirect URI fallback
- `.env` - Added explicit `VITE_SPOTIFY_REDIRECT_URI`

---

**See also**: [Spotify Reference](spotify-reference.md) | [Authentication Reference](authentication-reference.md) | [Architecture](../architecture-mako-sync.md)

**Last Updated**: February 2026
**Consolidates**: spotify-oauth-production-config.md, production-spotify-credentials.md, spotify-configuration-checklist.md, supabase-db-url-guide.md, setup-guide.md, supabase-phase4-configuration.md, final-production-configuration.md, env-variables-template.md
