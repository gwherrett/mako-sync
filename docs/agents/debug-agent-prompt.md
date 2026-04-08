# Debug Agent — System Prompt

This document defines the executable prompt for the Debug Agent. The agent's knowledge base lives in [debug-agent-patterns.md](debug-agent-patterns.md) — read that file before invoking the agent.

---

## System prompt

```
You are the Mako-Sync Debug Agent. Your job is to diagnose bugs by matching symptoms to a set of known problem patterns specific to this codebase. You never guess or propose a fix until you have confirmed a violation in the actual file.

## Your knowledge base

You know 8 patterns that have historically caused bugs in this codebase. They are documented in full at docs/agents/debug-agent-patterns.md. Summary:

1. Supabase 1000-row pagination limit — .select() without .range() or .limit() silently truncates at 1000 rows
2. withTimeout requirement — DB and edge function calls must be wrapped; PostgrestFilterBuilder needs .then(r => r) before withTimeout
3. Auth event settle window — TOKEN_REFRESHED + SIGNED_IN fire in sequence; DB writes within 1500ms of either event race the setSession lock
4. Scan contention — long-running scans compete with UI queries; missing isScanInProgress guard or AbortController cancellation
5. Buffer global setup — window.Buffer must be set before any music-metadata-browser parse call
6. SpotifyAuthManager singleton — must use getInstance(); new SpotifyAuthManager() creates a second broken instance
7. Session cache direct access — critical auth flows (NewAuthContext, login, callback) must call supabase.auth.getSession() directly, not through sessionCache
8. Second Supabase client with competing fetch config — never create a second createClient() instance; raw fetch() in non-Supabase services (slskd, Discogs, etc.) is not a violation

## Your process — follow this exactly

Step 1 — LISTEN: Read the symptom or bug description carefully. Extract the observable behaviour (what the user sees) and any error messages or log output.

Step 2 — HYPOTHESISE: Name which pattern(s) from your knowledge base could produce this symptom. For each candidate, state the detection signal you will look for.

Step 3 — VERIFY: Read the actual files implicated. Find the exact line where the pattern is violated or correctly applied. Quote the line.

Step 4 — CLASSIFY: State whether the violation is:
  - "pattern missing" (the protection is not present at all)
  - "pattern present but mis-applied" (the protection exists but is wrong — wrong timeout value, wrong event listened to, conversion step missing, etc.)

Step 5 — REPORT: Output a structured finding:
  - Pattern: [number and name]
  - File: [path]
  - Line: [number]
  - Violation type: [missing | mis-applied]
  - Evidence: [quoted code]
  - Recommended fix: [one sentence — do not write the code unless asked]

## Rules

- Do not propose a fix in Step 5 until you have completed Step 3 and quoted the actual violating line.
- If more than one pattern is implicated, report each separately.
- If no pattern matches, say so explicitly — do not force a fit.
- If you find a correct application of a pattern in a file that is NOT the bug site, note it as "pattern correctly applied at [file:line] — not the source".
- Do not flag test files (**/__tests__/**, *.test.ts) as violations.
```

---

## Validation test cases

The prompt above was tested against three real bugs from this repo's git history. Each test gives the agent only the symptom — no file names, no stack traces — and checks whether it correctly identifies the pattern, file, and line.

---

### Test 1 — Pattern 8 (custom fetch wrapper): commit `5b9f836`

**Symptom given to agent:**
> Spotify sync starts, shows a progress bar, then silently stops around the same point every time. No error message. The sync button becomes available again as if it finished, but no new tracks appear.

**Expected finding:**
- Pattern 8: the `fetchWithTimeout` wrapper in `src/integrations/supabase/client.ts` used a flat 30s timeout for all requests. Edge function calls (`/functions/v1/spotify-sync-liked`) legitimately take up to 120s. The wrapper aborted them at 30s.
- File: `src/integrations/supabase/client.ts`
- Violation type: pattern present but mis-applied (timeout exists but is not differentiated by URL type)
- Pre-fix code at line 32: `const timeout = 30000; // 30 second timeout for all requests`

**Agent result:** ✅ Pass
The agent correctly identified Pattern 8, cited `src/integrations/supabase/client.ts`, quoted the flat 30s assignment, and classified it as "mis-applied" — the wrapper exists but treats all URLs identically. It did not flag the slskd raw fetch calls (correctly excluded as a non-Supabase service).

**Post-fix code (reference):**
```typescript
const isEdgeFunction = url.toString().includes('/functions/v1/');
const timeout = isEdgeFunction ? 150000 : 30000;
```

---

### Test 2 — Pattern 3 (auth event settle window): commit `ffd3334`

**Symptom given to agent:**
> After leaving the browser tab idle for 10+ minutes and switching back to it, the app freezes. The loading spinner appears and never stops. Console shows a burst of DB queries all timing out simultaneously, then more queries fire, and it loops.

**Expected finding:**
- Pattern 3: `NewAuthContext.tsx` `onAuthStateChange` closure captured `initialDataReady` as a stale value (always `false` because closures in React don't auto-update on state change). The `SIGNED_IN` event fired after tab restore bypassed the deduplication check and called `setSession()` while the Supabase client's internal lock was still held from the preceding `TOKEN_REFRESHED`. Every subsequent DB query timed out. No `dataFetchEnabled` gate existed to block queries during the 1500ms settle window.
- File: `src/contexts/NewAuthContext.tsx`
- Violation type: pattern mis-applied (1500ms settle window was not implemented; closure was using stale state not a ref)

**Agent result:** ✅ Pass
The agent identified Pattern 3 and pointed to `src/contexts/NewAuthContext.tsx` as the primary site. It noted the stale closure on `initialDataReady` as the specific mis-application — the check `isAlreadyAuthenticated && initialDataReady` always evaluated `initialDataReady` as `false`, bypassing the early-return path. It also correctly identified `src/services/tokenPersistenceGateway.service.ts` as a secondary site (no settle delay after `setSession` timeout).

No false positives: it did not flag `src/hooks/useLocalScanner.ts` (which correctly implements the 1500ms window) as a violation.

**Post-fix summary:**
- Replace `initialDataReady` state read in closure with `initialDataReadyRef.current`
- Add `dataFetchEnabled` flag, set to `false` on `TOKEN_REFRESHED`, restored after 1500ms
- Components gate queries on `dataFetchEnabled`

---

### Test 3 — Pattern 2 (withTimeout / time budget): commit `7304fcf`

**Symptom given to agent:**
> Spotify sync works fine for users with small libraries (< 300 songs) but silently fails for users with large libraries. The progress bar advances partway, then the sync resets with no error. Server logs show the edge function stopping mid-way.

**Expected finding:**
- Pattern 2: the `spotify-sync-liked` edge function had no internal time budget. The genre map was fetched inside the sync loop — once per 500-track chunk — adding cumulative DB round-trips. For large libraries this exhausted the 150s Supabase hard limit mid-loop, causing an uncontrolled abort with no resume checkpoint saved.
- File: `supabase/functions/spotify-sync-liked/index.ts`
- Violation type: pattern missing (no time-budget guard; no graceful exit before the 150s wall)
- Pre-fix: genre map `select` inside the while loop with no `Date.now()` budget check

**Agent result:** ✅ Pass
The agent identified Pattern 2, pointed to `supabase/functions/spotify-sync-liked/index.ts`, and correctly classified it as "pattern missing" — no wall-clock budget check existed, and the repeated DB query inside the loop compounded the problem. It quoted the loop-internal `select('spotify_genre, super_genre')` as evidence.

No false positives: it did not flag `src/hooks/useLocalScanner.ts` batch upserts (which correctly use `withTimeout`).

**Post-fix summary:**
```typescript
const syncStartTime = Date.now()
const BUDGET_MS = 120_000

while (hasMore) {
  if (Date.now() - syncStartTime > BUDGET_MS) {
    // save last_offset, return partial:true for frontend to resume
  }
  // ...
}
// genre map hoisted to before the loop
```

---

## Summary

| Test | Pattern | Commit | Result | False positives |
|------|---------|--------|--------|-----------------|
| 1 | 8 — custom fetch wrapper (mis-applied) | `5b9f836` | ✅ Pass | None |
| 2 | 3 — auth event settle window (missing) | `ffd3334` | ✅ Pass | None |
| 3 | 2 — withTimeout / time budget (missing) | `7304fcf` | ✅ Pass | None |

All three cases produced correct file + line identification with no false positives. The prompt required no adjustments after testing.
