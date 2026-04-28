import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
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

function getDecade(year: number | null): string | null {
  if (!year) return null;
  if (year < 1950) return 'pre-1950';
  return `${Math.floor(year / 10) * 10}s`;
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

interface VinylFiltersProps {
  filterState: VinylFilterState;
  filterOptions: VinylFilterOptions;
  onChange: (state: VinylFilterState) => void;
}

const STAR_RATINGS = [1, 2, 3, 4, 5] as const;

export const VinylFilters: React.FC<VinylFiltersProps> = ({ filterState, filterOptions, onChange }) => {
  const set = (patch: Partial<VinylFilterState>) => onChange({ ...filterState, ...patch });

  const hasFilters =
    filterState.searchQuery !== VINYL_FILTER_DEFAULTS.searchQuery ||
    filterState.selectedArtist !== VINYL_FILTER_DEFAULTS.selectedArtist ||
    filterState.selectedLabel !== VINYL_FILTER_DEFAULTS.selectedLabel ||
    filterState.selectedFormat !== VINYL_FILTER_DEFAULTS.selectedFormat ||
    filterState.selectedDecade !== VINYL_FILTER_DEFAULTS.selectedDecade ||
    filterState.selectedSuperGenre !== VINYL_FILTER_DEFAULTS.selectedSuperGenre ||
    filterState.minRating !== VINYL_FILTER_DEFAULTS.minRating;

  return (
    <div className="space-y-2">
      {/* Row 1: search + rating stars */}
      <div className="flex gap-2 items-center">
        <Input
          placeholder="Search artist, title, label…"
          value={filterState.searchQuery}
          onChange={(e) => set({ searchQuery: e.target.value })}
          className="flex-1"
        />
        <div className="flex items-center gap-0.5 shrink-0">
          {STAR_RATINGS.map((n) => (
            <Button
              key={n}
              variant="ghost"
              size="sm"
              className={`h-8 w-8 p-0 text-base ${filterState.minRating === n ? 'text-yellow-500' : 'text-muted-foreground'}`}
              onClick={() => set({ minRating: filterState.minRating === n ? null : n })}
              title={`${n}★ and above`}
            >
              ★
            </Button>
          ))}
        </div>
      </div>

      {/* Row 2: dropdowns */}
      <div className="flex flex-wrap gap-2">
        <Select value={filterState.selectedArtist || '_all'} onValueChange={(v) => set({ selectedArtist: v === '_all' ? '' : v })}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Artists" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Artists</SelectItem>
            {filterOptions.artists.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterState.selectedLabel || '_all'} onValueChange={(v) => set({ selectedLabel: v === '_all' ? '' : v })}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Labels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Labels</SelectItem>
            {filterOptions.labels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterState.selectedFormat || '_all'} onValueChange={(v) => set({ selectedFormat: v === '_all' ? '' : v })}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Formats" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Formats</SelectItem>
            {filterOptions.formats.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterState.selectedDecade || '_all'} onValueChange={(v) => set({ selectedDecade: v === '_all' ? '' : v })}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Decades" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Decades</SelectItem>
            {filterOptions.decades.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>

        {filterOptions.superGenres.length > 0 && (
          <Select value={filterState.selectedSuperGenre || '_all'} onValueChange={(v) => set({ selectedSuperGenre: v === '_all' ? '' : v })}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All Supergenres" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Supergenres</SelectItem>
              {filterOptions.superGenres.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Row 3: clear button */}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={() => onChange(VINYL_FILTER_DEFAULTS)}>
          Clear Filters
        </Button>
      )}
    </div>
  );
};
