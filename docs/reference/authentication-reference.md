# Authentication Reference Guide

> **Reference**: Authentication implementation details, status, debugging procedures, and testing strategies.

**Status**: Active
**Last Updated**: February 2026

## Table of Contents
- [Implementation Overview](#implementation-overview)
- [Decision Log](#decision-log)
- [Debugging Procedures](#debugging-procedures)
- [Testing Guide](#testing-guide)
- [Common Issues & Solutions](#common-issues--solutions)

---

## Implementation Overview

### Completed Features

**Phase 1: Core Authentication Foundation** ✅
- Role-based security system with RLS policies
- Password reset flow with email verification
- Unified authentication context (NewAuthContext.tsx)
- Prevention of initialization deadlocks and race conditions

**Phase 2: UI/UX Enhancement** ✅
- Real-time form validation with debouncing (300ms)
- Progressive password strength indicator
- Multi-step onboarding wizard
- Enhanced loading states and session timeout warnings

**Phase 3: Spotify OAuth Integration** ✅
- Step-by-step OAuth visualization
- Automatic token refresh and lifecycle management
- Real-time connection monitoring
- Enhanced callback handling with state preservation

**Phase 4: Security Hardening** ✅
- Unified authentication manager with singleton pattern
- Exponential backoff with retry policies
- Rate limiting detection and intelligent retry scheduling
- Vault-based token storage with encryption

**Phase 5: Session Validation** ✅
- Fixed "Token Status: expired" false positives (Dec 2025)
- Network error handling separated from auth failures
- Session preservation during network issues
- Auth infinite loop resolution with connection cooldowns

### Pending Features

**Email Verification** (Phase 5.5 - In Progress)
- Core infrastructure exists (`isEmailVerified` state, `resendConfirmation()`)
- Needs: Production config enabled, protected route enforcement, enhanced UI

**User Profile & Role Management** (Phase 6 - Pending)
- User profile management interface
- Admin dashboard with role assignment
- Privacy controls and data management

**Performance & Monitoring** (Phase 7 - Pending)
- Performance metrics collection
- Session optimization
- Analytics dashboard

### Key File References

| Component | File Path | Purpose |
|-----------|-----------|---------|
| Auth Context | [src/contexts/NewAuthContext.tsx](../src/contexts/NewAuthContext.tsx) | Unified authentication provider |
| Spotify Auth Manager | [src/services/spotifyAuthManager.service.ts](../src/services/spotifyAuthManager.service.ts) | Consolidated auth service |
| Unified Spotify Hook | [src/hooks/useUnifiedSpotifyAuth.ts](../src/hooks/useUnifiedSpotifyAuth.ts) | Single auth hook |
| Password Reset | [src/pages/ResetPassword.tsx](../src/pages/ResetPassword.tsx) | Password reset flow |
| Security Dashboard | [src/components/spotify/SpotifySecurityDashboard.tsx](../src/components/spotify/SpotifySecurityDashboard.tsx) | Security monitoring |
| Session Cache | [src/services/sessionCache.service.ts](../src/services/sessionCache.service.ts) | Session validation |
| Auth Service | [src/services/auth.service.ts](../src/services/auth.service.ts) | Core auth operations |

---

## Decision Log

Key architecture and technical decisions made during implementation:

- **2025-12-12**: Enhanced session validation to fix false "Token Status: expired" errors
  - Separated network errors from auth failures; added 10-second timeout protection
- **2025-12-05**: Implemented separate `user_roles` table for security
  - Prevents privilege escalation attacks; uses SECURITY DEFINER function
- **2025-11-20**: Chose React Hook Form over custom validation
  - Better performance and developer experience; reduced form bugs by 80%
- **2025-11-15**: Consolidated to single `NewAuthContext` provider
  - Eliminated race conditions and context conflicts from legacy auth providers
- **2025-12-02**: Adopted Supabase Vault for token storage
  - Enterprise-grade security compliance; all tokens encrypted at rest

---

## Debugging Procedures

### Quick Debugging Tools

#### 1. Command Line Testing
```bash
# Make script executable
chmod +x scripts/debug-auth-endpoints.sh

# Run endpoint tests
./scripts/debug-auth-endpoints.sh
```

#### 2. Web UI Testing
Navigate to: `http://localhost:3000/auth-debug`

#### 3. Browser Console Testing
```javascript
// Capture current auth state
AuthDebugger.captureAuthState('manual-test');

// Test auth endpoints
AuthDebugger.testAuthEndpoints();

// Test sign in flow
AuthDebugger.testSignIn('your-email@example.com', 'your-password');

// Test sign out
AuthDebugger.testSignOut();

// Export debug logs
AuthDebugger.exportLogs();
```

### Debugging Workflow

**Step 1: Capture Current State**
```javascript
AuthDebugger.captureAuthState('initial-state');
```

**Step 2: Test Basic Connectivity**
```bash
./scripts/debug-auth-endpoints.sh
```

**Step 3: Test Auth Flow**
1. Go to `/auth-debug` page
2. Enter test credentials
3. Click "Test Sign In Flow"
4. Check console for detailed logs

**Step 4: Monitor State Changes**
```javascript
// Start monitoring
const stopMonitoring = AuthDebugger.startMonitoring();

// Perform actions (login, logout, navigate)
// Check console for state change logs

// Stop monitoring
stopMonitoring();
```

### Key Issues to Check

**Session Extension Window Pulsing**
- Expected: Intentional `animate-pulse` CSS when `timeRemaining <= 1`
- Check: Console logs for "Session timer update" frequency
- Fixed: Timer optimization reduces unnecessary re-renders

**Input Field Focus Loss**
- Check: Console logs for "updateField called" and "Debounced validation triggered"
- Look for: Rapid state updates during typing

**Edge Browser Sign-out Failure**
- Check: Console logs showing "Browser: Edge" detection
- Look for: Fallback to local scope when global scope fails

**Blank Pages After Auth Actions**
- Check: Auth state capture before/after actions
- Look for: Session/user state inconsistencies
- Monitor: Route changes and protected route logic

### Debug Data Collection

**Export Debug Logs**
```javascript
const logs = AuthDebugger.exportLogs();
console.log(logs);
```

**Key Data Points**
- Session state (expires_at, access_token presence)
- User state (email, email_confirmed_at)
- Browser storage (localStorage, sessionStorage)
- Network requests (success/failure status)
- Route navigation (current URL, redirects)

### Common Debugging Patterns

**Session Expiry Issues**
```javascript
const session = await supabase.auth.getSession();
const expiresAt = new Date(session.data.session?.expires_at * 1000);
const isExpired = expiresAt < new Date();
console.log('Session expired:', isExpired);
```

**Storage Persistence Issues**
```javascript
console.log('localStorage:', Object.fromEntries(
  Object.entries(localStorage).filter(([k]) => k.includes('supabase'))
));
```

**Network Connectivity**
```javascript
fetch(`${SUPABASE_URL}/auth/v1/user`, {
  headers: { 'apikey': SUPABASE_ANON_KEY }
}).then(r => console.log('API Status:', r.status));
```

---

## Testing Guide

### Available Test Scripts

**Quick Connectivity Check** (~10 seconds)
```bash
./scripts/quick-connectivity-check.sh
```
Tests: Environment variables, basic Supabase connectivity, auth endpoint accessibility

**Basic Connectivity Tests** (~30 seconds)
```bash
./scripts/basic-connectivity-tests.sh
```
Tests: Environment validation, health checks, error handling, response times

**Debug Auth Endpoints** (~60 seconds, interactive)
```bash
./scripts/debug-auth-endpoints.sh
```
Tests: Health check, session endpoint, sign in, authenticated requests, token refresh, sign out

**Session Management Tests** (~90 seconds, interactive)
```bash
./scripts/session-management-tests.sh
```
Tests: Session persistence, token extraction, token refresh, concurrent requests, logout validation

**Comprehensive Integration Tests** (~120 seconds, interactive)
```bash
./scripts/auth-integration-tests.sh
```
Tests: Complete end-to-end auth flow with all components

### Test Execution Order

**Quick Verification**
```bash
# 1. Quick check (essential tests only)
./scripts/quick-connectivity-check.sh

# 2. If quick check passes, run basic tests
./scripts/basic-connectivity-tests.sh
```

**Complete Testing**
```bash
# 1. Basic connectivity
./scripts/basic-connectivity-tests.sh

# 2. Auth endpoints
./scripts/debug-auth-endpoints.sh

# 3. Session management
./scripts/session-management-tests.sh

# 4. Integration tests
./scripts/auth-integration-tests.sh
```

**Automated CI/CD**
```bash
# Run non-interactive tests only
./scripts/quick-connectivity-check.sh && ./scripts/basic-connectivity-tests.sh
```

### Test Requirements

**Environment Setup**
- `.env` file with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Valid test credentials for interactive tests
- `curl`, `bash`, `bc` commands available

**Expected Results**
```
✅ All environment variables present
✅ Health check: 200 OK
✅ Auth endpoints: 200/401/403 OK (endpoint accessible)
✅ Sign in: 200 OK with tokens
✅ Authenticated requests: 200 OK
✅ Token refresh: 200 OK
✅ Sign out: 200 OK
✅ Post-logout token invalidation: 401/403 OK
```

### Performance Benchmarks

- Health check: < 500ms
- Auth endpoint check: < 500ms
- Sign in: < 1000ms
- Token refresh: < 500ms
- Authenticated requests: < 500ms

### Email Verification Testing

When email verification is enabled:
- [ ] New user signup triggers verification email
- [ ] Unverified users see verification notice
- [ ] Unverified users cannot access protected routes
- [ ] Resend verification email works with rate limiting
- [ ] Verification link properly confirms email
- [ ] Verified users can access all protected routes

---

## Common Issues & Solutions

### Troubleshooting Steps

**If Endpoints Fail**
1. Check `.env` file for correct Supabase URL/keys
2. Verify network connectivity
3. Check Supabase dashboard for service status
4. Test with curl directly

**If Auth State is Inconsistent**
1. Clear browser storage: `localStorage.clear(); sessionStorage.clear();`
2. Check for multiple auth contexts
3. Verify auth provider initialization
4. Monitor auth state change events

**If Routes Show Blank Pages**
1. Check protected route logic
2. Verify auth redirect hooks
3. Monitor React component mounting
4. Check for JavaScript errors in console

**Session Timeout Issues**
- Replaced hanging `supabase.auth.getSession()` with faster `supabase.auth.getUser()`
- Added timeout protection using `Promise.race()` with 10-second timeouts
- Enhanced error logging for debugging
- Fixed persistent session timeouts preventing Spotify connections

**Infinite Loop Issues**
- Implemented global state management to prevent multiple simultaneous connection checks
- Added connection check cooldown mechanism (5-second minimum interval)
- Enhanced with listener pattern for state synchronization across components

**OAuth State Parameter Errors**
- Enhanced state validation with dual storage checking (localStorage + sessionStorage)
- Improved error handling and cleanup mechanisms
- Added comprehensive logging for OAuth debugging
- Fixed "Invalid state parameter" errors in production

### Advanced Debugging

**Network Tab Analysis**
1. Open browser DevTools → Network tab
2. Filter by "auth" or "supabase"
3. Look for failed requests or unexpected responses
4. Check request/response headers

**React DevTools**
1. Install React DevTools extension
2. Check component state in auth context
3. Monitor prop changes in protected routes
4. Verify hook dependencies

**Supabase Dashboard**
1. Check Auth → Users for user state
2. Review Auth → Settings for configuration
3. Monitor Logs for server-side errors
4. Verify RLS policies if applicable

### Reporting Issues

When reporting authentication issues, include:
1. Exported debug logs from AuthDebugger
2. Browser console output
3. Network tab screenshots
4. Steps to reproduce
5. Expected vs actual behavior

---

---

**See also**: [Architecture Overview](../architecture-mako-sync.md) | [Product Requirements](../prd-mako-sync.md) | [Spotify Reference](spotify-reference.md)

**Last Updated**: February 2026
**Consolidates**: auth-implementation-plan.md, auth-debugging-instructions.md, auth-flow-testing-guide.md, auth-testing-completion-summary.md, systems/authentication.md
