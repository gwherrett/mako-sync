import type { PhysicalMediaRecord } from '@/types/discogs';

export interface VinylFilterState {
  searchQuery: string;
  selectedArtist: string;
  selectedLabel: string;
  selectedFormat: string;
  selectedDecade: string;
  selectedSuperGenre: string;
  minRating: number | null;
}

export const VINYL_FILTER_DEFAULTS: VinylFilterState = {
  searchQuery: '',
  selectedArtist: '',
  selectedLabel: '',
  selectedFormat: '',
  selectedDecade: '',
  selectedSuperGenre: '',
  minRating: null,
};

export interface VinylFilterOptions {
  artists: string[];
  labels: string[];
  formats: string[];
  decades: string[];
  superGenres: string[];
}

export function getDecade(year: number | null): string | null {
  if (!year) return null;
  if (year < 1950) return 'pre-1950';
  return `${Math.floor(year / 10) * 10}s`;
}

export function buildDecadeOptions(records: PhysicalMediaRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) {
    const d = getDecade(r.year);
    if (d) set.add(d);
  }
  return [...set].sort((a, b) => {
    if (a === 'pre-1950') return -1;
    if (b === 'pre-1950') return 1;
    return parseInt(a) - parseInt(b);
  });
}

export function applyVinylFilters(
  records: PhysicalMediaRecord[],
  state: VinylFilterState
): PhysicalMediaRecord[] {
  return records.filter((r) => {
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const haystack = [r.artist, r.title, r.label, r.catalogue_number]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (state.selectedArtist && r.artist !== state.selectedArtist) return false;
    if (state.selectedLabel && r.label !== state.selectedLabel) return false;
    if (state.selectedFormat && r.format !== state.selectedFormat) return false;
    if (state.selectedDecade && getDecade(r.year) !== state.selectedDecade) return false;
    if (state.selectedSuperGenre && r.super_genre !== state.selectedSuperGenre) return false;
    if (state.minRating !== null) {
      if (r.rating === null || r.rating < state.minRating) return false;
    }
    return true;
  });
}
