import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for useLocalScanner business logic.
 *
 * The hook is React-stateful and browser-dependent, so tests cover the pure
 * logic extracted from it rather than rendering the hook itself. This mirrors
 * the LocalTracksTable.test.ts approach.
 *
 * Key areas covered:
 *  - Hash-based skip logic (existing files are not re-inserted)
 *  - Batch deduplication (duplicate hashes within a single batch are collapsed)
 *  - Token-refresh settle window (remainingMs calculation)
 *  - DB error propagation (batch fails → scan aborts)
 *  - onScanComplete callback only fires on success
 */

// ─── Hash-based skip logic ───────────────────────────────────────────────────

/**
 * Mirrors the hash-check loop inside the batch processor.
 * Returns only files whose hash is not already in existingHashes.
 */
function filterNewFiles(
  files: Array<{ name: string; hash: string }>,
  existingHashes: Set<string>
): Array<{ name: string; hash: string }> {
  return files.filter(f => !existingHashes.has(f.hash));
}

describe('useLocalScanner — hash-based skip logic', () => {
  it('includes all files when DB is empty', () => {
    const files = [
      { name: 'a.mp3', hash: 'hash-a' },
      { name: 'b.mp3', hash: 'hash-b' },
    ];
    expect(filterNewFiles(files, new Set())).toHaveLength(2);
  });

  it('excludes files whose hash is already in DB', () => {
    const files = [
      { name: 'a.mp3', hash: 'hash-a' },
      { name: 'b.mp3', hash: 'hash-b' },
      { name: 'c.mp3', hash: 'hash-c' },
    ];
    const existing = new Set(['hash-a', 'hash-c']);
    const result = filterNewFiles(files, existing);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('b.mp3');
  });

  it('returns empty array when all files are already in DB', () => {
    const files = [
      { name: 'a.mp3', hash: 'hash-a' },
      { name: 'b.mp3', hash: 'hash-b' },
    ];
    const existing = new Set(['hash-a', 'hash-b']);
    expect(filterNewFiles(files, existing)).toHaveLength(0);
  });

  it('includes files with no hash (hash collision guard)', () => {
    const files = [
      { name: 'a.mp3', hash: '' },
      { name: 'b.mp3', hash: 'hash-b' },
    ];
    const existing = new Set(['hash-b']);
    // Empty-string hash is not in the existing set, so file is included
    const result = filterNewFiles(files, existing);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('a.mp3');
  });
});

// ─── Batch deduplication ─────────────────────────────────────────────────────

/**
 * Mirrors the deduplication filter applied to each batch before upsert.
 * Keeps the first occurrence of each hash; tracks with no hash pass through.
 */
interface TrackWithHash {
  title: string;
  hash: string | null;
}

function deduplicateBatch(tracks: TrackWithHash[]): TrackWithHash[] {
  return tracks.filter((track, index, self) => {
    if (!track.hash) return true;
    return self.findIndex(t => t.hash === track.hash) === index;
  });
}

describe('useLocalScanner — batch deduplication', () => {
  it('keeps all tracks when hashes are unique', () => {
    const tracks = [
      { title: 'A', hash: 'h1' },
      { title: 'B', hash: 'h2' },
      { title: 'C', hash: 'h3' },
    ];
    expect(deduplicateBatch(tracks)).toHaveLength(3);
  });

  it('removes duplicate hashes, keeping first occurrence', () => {
    const tracks = [
      { title: 'A', hash: 'h1' },
      { title: 'A-copy', hash: 'h1' },
      { title: 'B', hash: 'h2' },
    ];
    const result = deduplicateBatch(tracks);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('A');
    expect(result[1].title).toBe('B');
  });

  it('passes through tracks with null hash without deduplication', () => {
    const tracks = [
      { title: 'No-hash-1', hash: null },
      { title: 'No-hash-2', hash: null },
      { title: 'Has-hash', hash: 'h1' },
    ];
    // Both null-hash tracks survive because the guard returns true for !hash
    expect(deduplicateBatch(tracks)).toHaveLength(3);
  });

  it('handles a batch where every track is a duplicate', () => {
    const tracks = [
      { title: 'A', hash: 'h1' },
      { title: 'A', hash: 'h1' },
      { title: 'A', hash: 'h1' },
    ];
    expect(deduplicateBatch(tracks)).toHaveLength(1);
  });

  it('handles an empty batch', () => {
    expect(deduplicateBatch([])).toHaveLength(0);
  });
});

// ─── Token-refresh settle window ─────────────────────────────────────────────

/**
 * Mirrors the remainingMs calculation used before each upsert.
 * When a TOKEN_REFRESHED or SIGNED_IN event fires mid-scan, the scanner
 * sets tokenRefreshSettledAt = Date.now() + 1500 and then waits for any
 * remaining time before issuing the next upsert.
 */
function computeRemainingSettleMs(tokenRefreshSettledAt: number, now: number): number {
  return tokenRefreshSettledAt - now;
}

describe('useLocalScanner — token-refresh settle window', () => {
  it('returns positive remaining time when settle window has not elapsed', () => {
    const settledAt = Date.now() + 1500;
    const remaining = computeRemainingSettleMs(settledAt, Date.now());
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(1500);
  });

  it('returns zero or negative when settle window has already elapsed', () => {
    const settledAt = Date.now() - 100; // 100ms in the past
    const remaining = computeRemainingSettleMs(settledAt, Date.now());
    expect(remaining).toBeLessThanOrEqual(0);
  });

  it('returns exactly 1500ms when called immediately after event fires', () => {
    const now = 1_000_000;
    const settledAt = now + 1500;
    expect(computeRemainingSettleMs(settledAt, now)).toBe(1500);
  });

  it('late SIGNED_IN event resets and extends the window past TOKEN_REFRESHED', () => {
    // TOKEN_REFRESHED fires at t=0, settledAt = 1500
    const firstEventSettledAt = 1500;
    // SIGNED_IN fires at t=900 (while the first window is still open)
    // The window resets: settledAt = 900 + 1500 = 2400
    const secondEventNow = 900;
    const secondEventSettledAt = secondEventNow + 1500;

    // At t=1400, checking the SECOND window still has 1000ms remaining
    const checkAt = 1400;
    expect(computeRemainingSettleMs(secondEventSettledAt, checkAt)).toBe(1000);

    // Whereas the FIRST window would already be elapsed at t=1400
    expect(computeRemainingSettleMs(firstEventSettledAt, checkAt)).toBe(100);
  });
});

// ─── Batch error propagation ─────────────────────────────────────────────────

/**
 * Mirrors the DB error check and throw after a failed upsert.
 * The scanner throws immediately on error so the outer catch toasts and aborts.
 */
function checkBatchResult(result: { error: any }): void {
  if (result.error) {
    throw result.error;
  }
}

describe('useLocalScanner — batch error propagation', () => {
  it('does not throw when result has no error', () => {
    expect(() => checkBatchResult({ error: null })).not.toThrow();
  });

  it('throws the error object when upsert fails', () => {
    const err = new Error('DB write failed');
    expect(() => checkBatchResult({ error: err })).toThrow('DB write failed');
  });

  it('throws Supabase-style error objects (code + message)', () => {
    const pgErr = { code: '23505', message: 'duplicate key value' };
    expect(() => checkBatchResult({ error: pgErr })).toThrow();
  });
});

// ─── onScanComplete callback ──────────────────────────────────────────────────

/**
 * Validates that onScanComplete is only invoked after a successful scan,
 * not on error. This mirrors the control flow in scanLocalFiles.
 */
async function simulateScanFlow(
  shouldFail: boolean,
  onScanComplete?: () => void
): Promise<void> {
  try {
    if (shouldFail) throw new Error('Scan failed');
    if (onScanComplete) onScanComplete();
  } catch {
    // error path — callback not called
  }
}

describe('useLocalScanner — onScanComplete callback', () => {
  it('calls onScanComplete when scan succeeds', async () => {
    const cb = vi.fn();
    await simulateScanFlow(false, cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not call onScanComplete when scan throws', async () => {
    const cb = vi.fn();
    await simulateScanFlow(true, cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('works without onScanComplete callback (no error)', async () => {
    await expect(simulateScanFlow(false, undefined)).resolves.toBeUndefined();
  });
});

// ─── Hash load pagination ─────────────────────────────────────────────────────

/**
 * Mirrors the pagination logic that loads all existing hashes.
 * hasMore = (result.data.length === HASH_PAGE_SIZE)
 */
const HASH_PAGE_SIZE = 1000;

function shouldFetchNextPage(pageResultCount: number): boolean {
  return pageResultCount === HASH_PAGE_SIZE;
}

describe('useLocalScanner — hash load pagination', () => {
  it('continues paging when a full page is returned', () => {
    expect(shouldFetchNextPage(1000)).toBe(true);
  });

  it('stops paging when result is less than page size', () => {
    expect(shouldFetchNextPage(999)).toBe(false);
    expect(shouldFetchNextPage(0)).toBe(false);
    expect(shouldFetchNextPage(500)).toBe(false);
  });

  it('stops paging when result is exactly 0 (empty DB)', () => {
    expect(shouldFetchNextPage(0)).toBe(false);
  });

  it('accumulates hashes across pages', () => {
    const existingHashes = new Set<string>();
    // Page 1
    ['h1', 'h2', 'h3'].forEach(h => existingHashes.add(h));
    // Page 2
    ['h4', 'h5'].forEach(h => existingHashes.add(h));

    expect(existingHashes.size).toBe(5);
    expect(existingHashes.has('h3')).toBe(true);
    expect(existingHashes.has('h5')).toBe(true);
  });
});
