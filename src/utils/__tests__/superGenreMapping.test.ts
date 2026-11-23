import { describe, it, expect } from 'vitest';
import { mapToSuperGenre, normalizeGenreKey } from '../superGenreMapping';
import { _testExports } from '@/services/downloadProcessor.service';
import sharedCases from '@/services/__tests__/fixtures/genre-mapping-cases.json';

interface SharedCase {
  name: string;
  genres: string[];
  expected: string | null;
}

const genreMap = new Map<string, string>(sharedCases.map as [string, string][]);

describe('mapToSuperGenre shared cases (also run by the Mako Clean add-on)', () => {
  it.each(sharedCases.cases as SharedCase[])('$name', ({ genres, expected }) => {
    expect(mapToSuperGenre(genres, genreMap)).toBe(expected);
  });

  it('is the function Step 5 (downloadProcessor) uses', () => {
    expect(_testExports.mapToSuperGenre).toBe(mapToSuperGenre);
  });
});

describe('normalizeGenreKey', () => {
  it('lowercases and trims', () => {
    expect(normalizeGenreKey('  Deep HOUSE ')).toBe('deep house');
  });
});
