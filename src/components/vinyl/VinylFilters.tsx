import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { VINYL_FILTER_DEFAULTS, type VinylFilterState, type VinylFilterOptions } from './vinylFilters.utils';

interface VinylFiltersProps {
  filterState: VinylFilterState;
  filterOptions: VinylFilterOptions;
  onChange: (state: VinylFilterState) => void;
}

export const VinylFilters: React.FC<VinylFiltersProps> = ({ filterState, filterOptions, onChange }) => {
  const set = (patch: Partial<VinylFilterState>) => onChange({ ...filterState, ...patch });

  const hasFilters =
    filterState.searchQuery !== VINYL_FILTER_DEFAULTS.searchQuery ||
    filterState.selectedArtist !== VINYL_FILTER_DEFAULTS.selectedArtist ||
    filterState.selectedLabel !== VINYL_FILTER_DEFAULTS.selectedLabel ||
    filterState.selectedDecade !== VINYL_FILTER_DEFAULTS.selectedDecade ||
    filterState.selectedSuperGenre !== VINYL_FILTER_DEFAULTS.selectedSuperGenre;

  return (
    <div className="space-y-2">
      {/* Row 1: search */}
      <div className="flex gap-2 items-center">
        <Input
          placeholder="Search artist, title, label…"
          value={filterState.searchQuery}
          onChange={(e) => set({ searchQuery: e.target.value })}
          className="flex-1"
        />
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
