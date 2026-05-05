import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mirrors of panel logic under test ────────────────────────────────────────

const RATING_LABELS: Record<number, string> = {
  5: 'Mint',
  4: 'Very Good Plus',
  3: 'Good',
  2: 'Fair',
  1: 'Poor',
};

function ratingText(rating: number | null): string | null {
  if (rating === null) return null;
  const filled = '★'.repeat(rating);
  const empty = '☆'.repeat(5 - rating);
  return `${filled}${empty} ${RATING_LABELS[rating]}`;
}

interface TrackRef { position: string; title: string }

function classifyTracks(
  tracklist: TrackRef[],
  missing: TrackRef[],
  isMatching: boolean,
): { title: string; isMissing: boolean; isFound: boolean }[] {
  return tracklist.map(t => {
    const isMissing = missing.some(m => m.position === t.position && m.title === t.title);
    const isFound = !isMatching && !isMissing;
    return { title: t.title, isMissing, isFound };
  });
}

function librarySummary(matchedCount: number, tracklistLength: number): string {
  return `${matchedCount}/${tracklistLength} in library`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RatingDisplay logic', () => {
  it('returns null for null rating', () => {
    expect(ratingText(null)).toBeNull();
  });

  it('renders 5 stars as all filled', () => {
    expect(ratingText(5)).toBe('★★★★★ Mint');
  });

  it('renders 4 stars with one empty', () => {
    expect(ratingText(4)).toBe('★★★★☆ Very Good Plus');
  });

  it('renders 3 stars with two empty', () => {
    expect(ratingText(3)).toBe('★★★☆☆ Good');
  });

  it('renders 2 stars with three empty', () => {
    expect(ratingText(2)).toBe('★★☆☆☆ Fair');
  });

  it('renders 1 star with four empty', () => {
    expect(ratingText(1)).toBe('★☆☆☆☆ Poor');
  });

  it('filled + empty always sums to 5 characters', () => {
    for (let r = 1; r <= 5; r++) {
      const text = ratingText(r)!;
      const stars = text.split(' ')[0];
      expect([...stars].length).toBe(5);
    }
  });
});

describe('Track cross-reference logic', () => {
  const tracklist: TrackRef[] = [
    { position: 'A1', title: 'Polynomial-C' },
    { position: 'A2', title: 'Tha' },
    { position: 'B1', title: 'Hedphelym' },
  ];

  it('marks all tracks as found when missing list is empty and not matching', () => {
    const result = classifyTracks(tracklist, [], false);
    expect(result.every(t => t.isFound)).toBe(true);
    expect(result.every(t => !t.isMissing)).toBe(true);
  });

  it('marks a track as missing when it appears in the missing list', () => {
    const missing = [{ position: 'A2', title: 'Tha' }];
    const result = classifyTracks(tracklist, missing, false);
    expect(result.find(t => t.title === 'Tha')?.isMissing).toBe(true);
    expect(result.find(t => t.title === 'Tha')?.isFound).toBe(false);
  });

  it('marks non-missing tracks as found', () => {
    const missing = [{ position: 'A2', title: 'Tha' }];
    const result = classifyTracks(tracklist, missing, false);
    expect(result.find(t => t.title === 'Polynomial-C')?.isFound).toBe(true);
    expect(result.find(t => t.title === 'Hedphelym')?.isFound).toBe(true);
  });

  it('marks no track as found while isMatching is true', () => {
    const result = classifyTracks(tracklist, [], true);
    expect(result.every(t => !t.isFound)).toBe(true);
  });

  it('requires both position and title to match for missing detection', () => {
    // Same title, different position — should NOT be treated as missing
    const missing = [{ position: 'Z9', title: 'Polynomial-C' }];
    const result = classifyTracks(tracklist, missing, false);
    expect(result.find(t => t.title === 'Polynomial-C')?.isMissing).toBe(false);
  });

  it('handles all tracks missing', () => {
    const result = classifyTracks(tracklist, [...tracklist], false);
    expect(result.every(t => t.isMissing)).toBe(true);
    expect(result.every(t => !t.isFound)).toBe(true);
  });

  it('returns empty array for empty tracklist', () => {
    expect(classifyTracks([], [], false)).toEqual([]);
  });
});

describe('Library summary string', () => {
  it('shows 0/N when nothing matched', () => {
    expect(librarySummary(0, 10)).toBe('0/10 in library');
  });

  it('shows full count when all matched', () => {
    expect(librarySummary(8, 8)).toBe('8/8 in library');
  });

  it('shows partial count', () => {
    expect(librarySummary(3, 10)).toBe('3/10 in library');
  });
});

describe('handleDelete flow', () => {
  it('calls deleteRecord with the record id then onClose', async () => {
    const deleteRecord = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    const handleDelete = async (recordId: string) => {
      await deleteRecord(recordId);
      onClose();
    };

    await handleDelete('rec-123');

    expect(deleteRecord).toHaveBeenCalledWith('rec-123');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose even if deleteRecord resolves immediately', async () => {
    const deleteRecord = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    const handleDelete = async (recordId: string) => {
      await deleteRecord(recordId);
      onClose();
    };

    await handleDelete('rec-456');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not proceed when record is null', async () => {
    const deleteRecord = vi.fn();
    const onClose = vi.fn();

    const handleDelete = async (record: { id: string } | null) => {
      if (!record) return;
      await deleteRecord(record.id);
      onClose();
    };

    await handleDelete(null);
    expect(deleteRecord).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
