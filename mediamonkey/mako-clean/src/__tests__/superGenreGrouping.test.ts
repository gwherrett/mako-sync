import { describe, it, expect } from 'vitest';
import { splitGenres, superGenreGrouping } from '../core/rules/superGenreGrouping';
import { parseGenreMapExport } from '../core/genreMap';
import { planTrack } from '../core/runner';
import { mapToSuperGenre } from '@/utils/superGenreMapping';
import type { RuleContext, TrackFields } from '../core/types';
import sharedCases from '@/services/__tests__/fixtures/genre-mapping-cases.json';

interface SharedCase {
  name: string;
  genres: string[];
  expected: string | null;
}

// Load the shared map the way the add-on loads the real one: from the export format
const exported = parseGenreMapExport(JSON.stringify({
  version: 1,
  exportedAt: '2026-11-21T00:00:00.000Z',
  mappings: sharedCases.map,
}));
const ctx: RuleContext = { genreMap: exported.map, genreSeparator: '; ' };

function fields(overrides: Partial<TrackFields>): TrackFields {
  return { genre: '', grouping: '', albumArtist: '', ...overrides };
}

describe('superGenreGrouping: shared cases (same file Mako runs)', () => {
  // Each case's genres as MediaMonkey holds them: one string joined by "; ".
  // Blank genres can't survive that join, so those cases run through mapToSuperGenre only.
  const representable = (sharedCases.cases as SharedCase[]).filter((c) => c.genres.every((g) => g.trim()));

  it.each(representable)('$name', ({ genres, expected }) => {
    const result = superGenreGrouping.run(fields({ genre: genres.join('; ') }), ctx);
    const grouping = result.changes?.[0]?.value ?? null;
    expect(grouping).toBe(expected);
  });

  it.each(sharedCases.cases as SharedCase[])('$name (map read from the export)', ({ genres, expected }) => {
    expect(mapToSuperGenre(genres, exported.map)).toBe(expected);
  });
});

describe('superGenreGrouping', () => {
  it('sets a blank Grouping without marking an overwrite', () => {
    expect(superGenreGrouping.run(fields({ genre: 'Deep House' }), ctx)).toEqual({
      changes: [{ field: 'grouping', value: 'House', overwrite: false }],
    });
  });

  it('marks a different existing Grouping as an overwrite', () => {
    expect(superGenreGrouping.run(fields({ genre: 'Deep House', grouping: 'Pop' }), ctx)).toEqual({
      changes: [{ field: 'grouping', value: 'House', overwrite: true }],
    });
  });

  it('makes no change when Grouping already equals the SuperGenre', () => {
    expect(superGenreGrouping.run(fields({ genre: 'Deep House', grouping: 'House' }), ctx)).toEqual({});
  });

  it('lists an unmapped track with its genres', () => {
    expect(superGenreGrouping.run(fields({ genre: 'Zydeco; Polka' }), ctx)).toEqual({
      skipReason: 'No SuperGenre for genres: Zydeco; Polka',
    });
  });

  it('notes a track with no genre', () => {
    expect(superGenreGrouping.run(fields({ genre: '  ' }), ctx)).toEqual({
      skipReason: 'No genre, so no SuperGenre',
    });
  });

  it("uses MediaMonkey's separator setting", () => {
    const slash: RuleContext = { ...ctx, genreSeparator: ' / ' };
    const result = superGenreGrouping.run(fields({ genre: 'zydeco / deep house' }), slash);
    expect(result.changes?.[0]?.value).toBe('House');
  });

  it('shows in the plan as Grouping from → to', () => {
    const plan = planTrack(
      { id: '1', label: 'A - T', file: 't.mp3', fields: fields({ genre: 'Soul', grouping: 'Pop' }) },
      [superGenreGrouping],
      ctx
    );
    expect(plan.changes).toEqual([{ field: 'grouping', from: 'Pop', to: 'Soul-Funk', overwrite: true }]);
  });
});

describe('splitGenres', () => {
  it('splits on the separator and trims', () => {
    expect(splitGenres('Soul;  Funk ;Disco', '; ')).toEqual(['Soul', 'Funk', 'Disco']);
  });

  it('drops empty parts', () => {
    expect(splitGenres('Soul; ; ', '; ')).toEqual(['Soul']);
    expect(splitGenres('', '; ')).toEqual([]);
  });

  it('falls back to ";" for a blank separator', () => {
    expect(splitGenres('Soul;Funk', ' ')).toEqual(['Soul', 'Funk']);
  });
});
