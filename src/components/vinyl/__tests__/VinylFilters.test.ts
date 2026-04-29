import { describe, it, expect } from 'vitest';
import { applyVinylFilters, buildDecadeOptions, VINYL_FILTER_DEFAULTS } from '../VinylFilters';
import type { PhysicalMediaRecord } from '@/types/discogs';

function makeRecord(overrides: Partial<PhysicalMediaRecord> = {}): PhysicalMediaRecord {
  return {
    id: 'r1',
    user_id: 'u1',
    discogs_release_id: null,
    discogs_master_id: null,
    artist: 'Artist',
    title: 'Title',
    label: 'Label',
    catalogue_number: 'CAT-001',
    year: 1985,
    country: null,
    pressing: null,
    rating: null,
    discogs_instance_id: null,
    discogs_synced_at: null,
    format: 'LP',
    format_details: null,
    notes: null,
    cover_image_url: null,
    tracklist: null,
    genres: null,
    styles: null,
    super_genre: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const records: PhysicalMediaRecord[] = [
  makeRecord({ id: '1', artist: 'Aphex Twin', title: 'Selected Ambient Works', label: 'Apollo', year: 1992, format: 'LP', rating: 5, super_genre: 'Electronic', catalogue_number: 'AMB-92' }),
  makeRecord({ id: '2', artist: 'Prince', title: 'Purple Rain', label: 'Warner', year: 1984, format: '7"', rating: 4, super_genre: 'Pop', catalogue_number: 'WB-84' }),
  makeRecord({ id: '3', artist: 'DJ Shadow', title: 'Endtroducing', label: 'Mo Wax', year: 1996, format: 'LP', rating: 5, super_genre: 'Hip Hop', catalogue_number: 'MW-96' }),
  makeRecord({ id: '4', artist: 'Sade', title: 'Diamond Life', label: 'Epic', year: 1984, format: 'LP', rating: null, super_genre: null, catalogue_number: null }),
];

describe('buildDecadeOptions', () => {
  it('returns empty array for empty collection', () => {
    expect(buildDecadeOptions([])).toEqual([]);
  });

  it('returns empty array when all years are null', () => {
    expect(buildDecadeOptions([makeRecord({ year: null }), makeRecord({ year: null })])).toEqual([]);
  });

  it('deduplicates decades from multiple records', () => {
    const result = buildDecadeOptions([makeRecord({ year: 1984 }), makeRecord({ year: 1987 }), makeRecord({ year: 1992 })]);
    expect(result).toEqual(['1980s', '1990s']);
  });

  it('sorts decades chronologically', () => {
    const result = buildDecadeOptions([
      makeRecord({ year: 2005 }),
      makeRecord({ year: 1975 }),
      makeRecord({ year: 1945 }),
      makeRecord({ year: 1992 }),
    ]);
    expect(result).toEqual(['pre-1950', '1970s', '1990s', '2000s']);
  });

  it('places pre-1950 before all numeric decades', () => {
    const result = buildDecadeOptions([makeRecord({ year: 1940 }), makeRecord({ year: 1985 })]);
    expect(result[0]).toBe('pre-1950');
  });

  it('omits null years without affecting valid entries', () => {
    const result = buildDecadeOptions([makeRecord({ year: 1985 }), makeRecord({ year: null })]);
    expect(result).toEqual(['1980s']);
  });
});

describe('applyVinylFilters', () => {
  it('returns empty array for empty collection', () => {
    expect(applyVinylFilters([], VINYL_FILTER_DEFAULTS)).toEqual([]);
  });

  it('returns empty array when decade filter matches nothing', () => {
    expect(applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, selectedDecade: '2000s' })).toEqual([]);
  });

  it('returns all records when using defaults', () => {
    expect(applyVinylFilters(records, VINYL_FILTER_DEFAULTS)).toHaveLength(4);
  });

  describe('searchQuery', () => {
    it('matches on artist', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, searchQuery: 'prince' });
      expect(result.map(r => r.id)).toEqual(['2']);
    });

    it('matches on title', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, searchQuery: 'endtro' });
      expect(result.map(r => r.id)).toEqual(['3']);
    });

    it('matches on label', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, searchQuery: 'mo wax' });
      expect(result.map(r => r.id)).toEqual(['3']);
    });

    it('matches on catalogue_number', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, searchQuery: 'AMB-92' });
      expect(result.map(r => r.id)).toEqual(['1']);
    });

    it('is case-insensitive', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, searchQuery: 'APHEX' });
      expect(result.map(r => r.id)).toEqual(['1']);
    });

    it('returns empty when no match', () => {
      expect(applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, searchQuery: 'zzznomatch' })).toHaveLength(0);
    });
  });

  describe('selectedArtist', () => {
    it('filters to exact artist', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, selectedArtist: 'Sade' });
      expect(result.map(r => r.id)).toEqual(['4']);
    });
  });

  describe('selectedLabel', () => {
    it('filters to exact label', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, selectedLabel: 'Apollo' });
      expect(result.map(r => r.id)).toEqual(['1']);
    });
  });

  describe('selectedFormat', () => {
    it('returns only matching format', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, selectedFormat: '7"' });
      expect(result.map(r => r.id)).toEqual(['2']);
    });
  });

  describe('selectedDecade', () => {
    it('filters to 1980s', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, selectedDecade: '1980s' });
      expect(result.map(r => r.id)).toEqual(['2', '4']);
    });

    it('filters to 1990s', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, selectedDecade: '1990s' });
      expect(result.map(r => r.id)).toEqual(['1', '3']);
    });

    it('handles null year — excluded from any decade filter', () => {
      const nullYear = makeRecord({ id: '5', year: null });
      const result = applyVinylFilters([...records, nullYear], { ...VINYL_FILTER_DEFAULTS, selectedDecade: '1980s' });
      expect(result.map(r => r.id)).not.toContain('5');
    });

    it('buckets years below 1950 as pre-1950', () => {
      const old = makeRecord({ id: '6', year: 1948 });
      const result = applyVinylFilters([old], { ...VINYL_FILTER_DEFAULTS, selectedDecade: 'pre-1950' });
      expect(result.map(r => r.id)).toEqual(['6']);
    });
  });

  describe('selectedSuperGenre', () => {
    it('filters to matching super_genre', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, selectedSuperGenre: 'Electronic' });
      expect(result.map(r => r.id)).toEqual(['1']);
    });

    it('excludes records with null super_genre', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, selectedSuperGenre: 'Pop' });
      expect(result.every(r => r.super_genre === 'Pop')).toBe(true);
      expect(result.map(r => r.id)).not.toContain('4');
    });
  });

  describe('minRating', () => {
    it('includes records at or above minimum', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, minRating: 5 });
      expect(result.map(r => r.id)).toEqual(['1', '3']);
    });

    it('includes lower ratings when minimum is lower', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, minRating: 4 });
      expect(result.map(r => r.id)).toEqual(['1', '2', '3']);
    });

    it('excludes records with null rating', () => {
      const result = applyVinylFilters(records, { ...VINYL_FILTER_DEFAULTS, minRating: 1 });
      expect(result.map(r => r.id)).not.toContain('4');
    });
  });

  describe('combined filters', () => {
    it('AND-combines multiple active filters', () => {
      const result = applyVinylFilters(records, {
        ...VINYL_FILTER_DEFAULTS,
        selectedDecade: '1980s',
        minRating: 4,
      });
      expect(result.map(r => r.id)).toEqual(['2']);
    });

    it('returns empty when combined filters match nothing', () => {
      const result = applyVinylFilters(records, {
        ...VINYL_FILTER_DEFAULTS,
        selectedSuperGenre: 'Electronic',
        selectedDecade: '1980s',
      });
      expect(result).toHaveLength(0);
    });
  });
});
