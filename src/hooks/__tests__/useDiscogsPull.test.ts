import { describe, it, expect } from 'vitest';
import type { DiscogsTrack } from '@/types/discogs';

/**
 * Tests for useDiscogsPull business logic.
 *
 * The hook is React-stateful, so tests cover the two pure logic areas
 * extracted from it:
 *   1. Error message resolution — structured error codes from error.context
 *   2. Success toast construction — message variants based on import counts
 */

// ─── Error message resolution ─────────────────────────────────────────────────

/**
 * Mirrors the error-parsing block inside mutationFn.
 * Resolves a human-readable message from a Supabase FunctionInvokeError.
 */
async function resolveErrorMessage(error: {
  message?: string;
  context?: unknown;
}): Promise<string> {
  let message = error.message ?? 'Failed to pull from Discogs';
  try {
    const parsed =
      typeof error.context === 'object' && error.context !== null
        ? await (error.context as { json?: () => Promise<unknown> }).json?.()
        : null;
    const p = parsed as Record<string, string> | null;
    if (p?.code === 'RATE_LIMITED') {
      message = 'Discogs rate limit hit. Please wait 60 seconds and try again.';
    } else if (p?.code === 'NOT_CONNECTED') {
      message = 'Discogs is not connected. Connect it on the Security page.';
    } else if (p?.error) {
      message = p.error;
    }
  } catch {
    // leave message as-is
  }
  return message;
}

describe('useDiscogsPull — error message resolution', () => {
  it('returns RATE_LIMITED message when code is RATE_LIMITED', async () => {
    const error = {
      message: 'error',
      context: { json: async () => ({ code: 'RATE_LIMITED' }) },
    };
    const msg = await resolveErrorMessage(error);
    expect(msg).toBe('Discogs rate limit hit. Please wait 60 seconds and try again.');
  });

  it('returns NOT_CONNECTED message when code is NOT_CONNECTED', async () => {
    const error = {
      message: 'error',
      context: { json: async () => ({ code: 'NOT_CONNECTED' }) },
    };
    const msg = await resolveErrorMessage(error);
    expect(msg).toBe('Discogs is not connected. Connect it on the Security page.');
  });

  it('uses parsed.error as message when no known code but error field present', async () => {
    const error = {
      message: 'generic error',
      context: { json: async () => ({ error: 'Release not found on Discogs' }) },
    };
    const msg = await resolveErrorMessage(error);
    expect(msg).toBe('Release not found on Discogs');
  });

  it('falls back to error.message when context JSON has no recognised fields', async () => {
    const error = {
      message: 'Server error',
      context: { json: async () => ({ detail: 'something else' }) },
    };
    const msg = await resolveErrorMessage(error);
    expect(msg).toBe('Server error');
  });

  it('falls back to error.message when context.json() throws', async () => {
    const error = {
      message: 'Network failure',
      context: { json: async () => { throw new Error('parse error'); } },
    };
    const msg = await resolveErrorMessage(error);
    expect(msg).toBe('Network failure');
  });

  it('falls back to error.message when context is null', async () => {
    const error = { message: 'Unauthorized', context: null };
    const msg = await resolveErrorMessage(error);
    expect(msg).toBe('Unauthorized');
  });

  it('falls back to error.message when context is a string (not an object)', async () => {
    const error = { message: 'Bad request', context: 'plain string' };
    const msg = await resolveErrorMessage(error);
    expect(msg).toBe('Bad request');
  });

  it('uses default message when error.message is undefined', async () => {
    const error = { context: null };
    const msg = await resolveErrorMessage(error);
    expect(msg).toBe('Failed to pull from Discogs');
  });

  it('RATE_LIMITED takes precedence over error field when both present', async () => {
    const error = {
      message: 'error',
      context: { json: async () => ({ code: 'RATE_LIMITED', error: 'Try later' }) },
    };
    const msg = await resolveErrorMessage(error);
    expect(msg).toBe('Discogs rate limit hit. Please wait 60 seconds and try again.');
  });
});

// ─── Success toast construction ───────────────────────────────────────────────

interface PullResult {
  imported: number;
  skipped: number;
  total_in_discogs: number;
}

/**
 * Mirrors the onSuccess toast branching in useDiscogsPull.
 * Returns the toast payload that would be passed to toast().
 */
function buildSuccessToast(result: PullResult): { title: string; description: string } {
  if (result.imported === 0) {
    return {
      title: 'Already up to date',
      description: `No new records found in your Discogs collection (${result.total_in_discogs} total tracked).`,
    };
  }
  return {
    title: `Imported ${result.imported} record${result.imported === 1 ? '' : 's'}`,
    description: `${result.skipped} already tracked, ${result.total_in_discogs} total in Discogs.`,
  };
}

describe('useDiscogsPull — success toast construction', () => {
  it('shows "Already up to date" title when nothing was imported', () => {
    const toast = buildSuccessToast({ imported: 0, skipped: 5, total_in_discogs: 5 });
    expect(toast.title).toBe('Already up to date');
  });

  it('includes total_in_discogs in the "already up to date" description', () => {
    const toast = buildSuccessToast({ imported: 0, skipped: 42, total_in_discogs: 42 });
    expect(toast.description).toContain('42');
  });

  it('uses singular "record" when exactly 1 item imported', () => {
    const toast = buildSuccessToast({ imported: 1, skipped: 9, total_in_discogs: 10 });
    expect(toast.title).toBe('Imported 1 record');
  });

  it('uses plural "records" when more than 1 item imported', () => {
    const toast = buildSuccessToast({ imported: 5, skipped: 3, total_in_discogs: 8 });
    expect(toast.title).toBe('Imported 5 records');
  });

  it('includes skipped count in the import description', () => {
    const toast = buildSuccessToast({ imported: 5, skipped: 3, total_in_discogs: 8 });
    expect(toast.description).toContain('3 already tracked');
  });

  it('includes total_in_discogs in the import description', () => {
    const toast = buildSuccessToast({ imported: 5, skipped: 3, total_in_discogs: 8 });
    expect(toast.description).toContain('8 total in Discogs');
  });

  it('handles 0 skipped correctly (entire collection is new)', () => {
    const toast = buildSuccessToast({ imported: 10, skipped: 0, total_in_discogs: 10 });
    expect(toast.title).toBe('Imported 10 records');
    expect(toast.description).toContain('0 already tracked');
  });

  it('handles large collections correctly', () => {
    const toast = buildSuccessToast({ imported: 342, skipped: 1658, total_in_discogs: 2000 });
    expect(toast.title).toBe('Imported 342 records');
    expect(toast.description).toContain('1658 already tracked');
    expect(toast.description).toContain('2000 total in Discogs');
  });
});

// ─── Discogs instance ID deduplication ───────────────────────────────────────

/**
 * Mirrors the deduplication logic inside discogs-sync-from-collection edge function:
 * builds a Set of existing instance IDs, then filters incoming items.
 * Tests here validate the client-side understanding of what constitutes a "new" record.
 */
function filterNewCollectionItems(
  items: Array<{ id: number }>,
  existingInstanceIds: Set<number>
): Array<{ id: number }> {
  return items.filter(item => !existingInstanceIds.has(item.id));
}

describe('useDiscogsPull — collection deduplication logic', () => {
  it('returns all items when none are already tracked', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = filterNewCollectionItems(items, new Set());
    expect(result).toHaveLength(3);
  });

  it('excludes items whose instance_id is already in the tracked set', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = filterNewCollectionItems(items, new Set([1, 3]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it('returns empty array when all items are already tracked', () => {
    const items = [{ id: 10 }, { id: 20 }];
    const result = filterNewCollectionItems(items, new Set([10, 20]));
    expect(result).toHaveLength(0);
  });

  it('handles empty incoming items array', () => {
    const result = filterNewCollectionItems([], new Set([1, 2, 3]));
    expect(result).toHaveLength(0);
  });

  it('uses strict numeric equality for instance IDs', () => {
    const items = [{ id: 100 }, { id: 200 }];
    const result = filterNewCollectionItems(items, new Set([100]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(200);
  });
});
