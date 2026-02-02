# Test Improvement Plan

## Current State

| Metric | Current | Target |
|--------|---------|--------|
| Test Files | 18 | 24+ |
| Tests | 416 | 580+ |
| Passing | 407 (97.8%) | 100% |
| Failing | 9 | 0 |
| Coverage | ~30% (estimated) | 35% |

## Phase 1: Fix Failing Tests (Priority: HIGH)

### Issue: `trackMatching.service.test.ts` - 9 failing tests

**Root Cause:** The test mocks use `.limit()` but the actual `fetchLocalTracks()` method uses `.range()` for pagination.

**File:** [trackMatching.service.test.ts](src/services/__tests__/trackMatching.service.test.ts)

**Affected Tests:**
1. `fetchLocalTracks > should fetch local tracks for a user`
2. `fetchLocalTracks > should return empty array when no tracks found`
3. `fetchLocalTracks > should throw error when fetch fails`
4. `findMissingTracks > should find tracks that exist in Spotify but not locally`
5. `findMissingTracks > should return empty array when all tracks match`
6. `findMissingTracks > should handle case-insensitive matching`
7. `findMissingTracks > should handle null titles and artists`
8. `findMissingTracks > should normalize special characters in matching`
9. `findMissingTracks > should pass super genre filter to fetchSpotifyTracks`

**Fix:** Update test mocks to use `.range()` instead of `.limit()`:

```typescript
// Before (broken):
vi.mocked(supabase.from).mockReturnValue({
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: mockTracks, error: null })
    })
  })
} as any);

// After (fixed):
vi.mocked(supabase.from).mockReturnValue({
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      range: vi.fn().mockResolvedValue({ data: mockTracks, error: null })
    })
  })
} as any);
```

**Additional consideration:** The `fetchLocalTracks` method uses pagination with a while loop, so the mock needs to handle returning empty data on the second call to exit the loop:

```typescript
const rangeMock = vi.fn()
  .mockResolvedValueOnce({ data: mockTracks, error: null })
  .mockResolvedValueOnce({ data: [], error: null }); // Exit pagination loop
```

---

## Phase 2: Add Tests for Untested Services

### Services without tests (13 total):

| Service | Lines | Complexity | Priority |
|---------|-------|------------|----------|
| `metadataExtractor.ts` | ~300 | High | HIGH |
| `fileScanner.ts` | ~400 | High | HIGH |
| `trackGenre.service.ts` | ~150 | Medium | MEDIUM |
| `queryWrapper.service.ts` | ~80 | Low | LOW |
| `authRetry.service.ts` | ~100 | Medium | MEDIUM |
| `authStateRecovery.service.ts` | ~120 | Medium | MEDIUM |
| `directoryHandle.service.ts` | ~100 | Medium | LOW |
| `errorLogging.service.ts` | ~80 | Low | LOW |
| `startupSessionValidator.service.ts` | ~150 | Medium | MEDIUM |
| `startupSessionValidator.improved.ts` | ~180 | Medium | MEDIUM |
| `tokenPersistenceGateway.service.ts` | ~100 | Medium | LOW |

### Recommended new test files:

1. **`trackGenre.service.test.ts`** (MEDIUM priority)
   - Test genre suggestion logic
   - Test AI integration mocking
   - Estimated: 15-20 tests

2. **`queryWrapper.service.test.ts`** (LOW priority)
   - Test query wrapping functionality
   - Test timeout handling
   - Estimated: 8-10 tests

3. **`authRetry.service.test.ts`** (MEDIUM priority)
   - Test retry logic
   - Test backoff strategies
   - Estimated: 10-15 tests

4. **`startupSessionValidator.service.test.ts`** (MEDIUM priority)
   - Test session validation flow
   - Test recovery scenarios
   - Estimated: 12-15 tests

---

## Phase 3: Add Tests for Untested Utilities

### Utilities without tests (6 total):

| Utility | Lines | Priority |
|---------|-------|----------|
| `supabaseQuery.ts` | ~60 | MEDIUM |
| `linkUtils.ts` | ~40 | LOW |
| `debugHelpers.ts` | ~80 | LOW |
| `serviceWorkerCleanup.ts` | ~50 | LOW |
| `storageIsolationTest.ts` | ~60 | LOW |
| `reloadDebugger.ts` | ~40 | LOW |

### Recommended new test files:

1. **`supabaseQuery.test.ts`** (MEDIUM priority)
   - Test query construction
   - Test error handling
   - Estimated: 8-10 tests

2. **`linkUtils.test.ts`** (LOW priority)
   - Test link generation
   - Test URL manipulation
   - Estimated: 5-8 tests

---

## Phase 4: Improve Test Setup (Optional)

### Update `src/test/setup.ts` for better Supabase mocking:

Add `.range()` method to the default mock chain:

```typescript
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    // ... existing mocks ...
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          range: vi.fn().mockResolvedValue({ data: [], error: null }), // ADD THIS
          limit: vi.fn().mockResolvedValue({ data: [], error: null }), // ADD THIS
          not: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
      // ... rest of mocks ...
    })),
  },
}));
```

---

## Coverage Impact Estimation

| Phase | Tests Added | Coverage Increase |
|-------|-------------|-------------------|
| Phase 1 (Fix failures) | 0 (fixes 9) | +2% (unlocks coverage report) |
| Phase 2 (Services) | ~60 | +3-4% |
| Phase 3 (Utilities) | ~20 | +1% |
| **Total** | **~80** | **~6-7%** |

**Estimated final coverage: 35-37%**

---

## Implementation Order

1. **Phase 1:** Fix `trackMatching.service.test.ts` (1-2 hours)
2. **Phase 2a:** Add `trackGenre.service.test.ts` (2-3 hours)
3. **Phase 2b:** Add `queryWrapper.service.test.ts` (1-2 hours)
4. **Phase 3:** Add `supabaseQuery.test.ts` (1-2 hours)
5. **Phase 2c:** Add `authRetry.service.test.ts` (2-3 hours)
6. **Phase 4:** Improve test setup (optional, 1 hour)

---

## Commands to Verify Progress

```bash
# Run all tests
npx vitest run

# Run with coverage
npx vitest run --coverage

# Run specific test file
npx vitest run src/services/__tests__/trackMatching.service.test.ts

# Run tests in watch mode
npx vitest
```
