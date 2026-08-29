
import React from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DANCE_ALL_VALUE } from '@/types/genreMapping';

// Base filter configuration
export interface FilterConfig {
  search?: boolean;
  dateFilters?: boolean;
  genre?: boolean;
  superGenre?: boolean;
  artist?: boolean;
  genreLabel?: string;
  superGenreLabel?: string;
}

// Filter state interface
export interface FilterState {
  searchQuery: string;
  selectedGenre: string;
  selectedSuperGenre: string;
  selectedArtist: string;
  dateFilter: string;
  noSuperGenre: boolean;
  noGenre?: boolean;
}

// Filter options interface
export interface FilterOptions {
  genres: string[];
  superGenres: string[];
  artists: string[];
}

// Filter callbacks interface
export interface FilterCallbacks {
  onSearchChange: (value: string) => void;
  onGenreChange: (value: string) => void;
  onSuperGenreChange: (value: string) => void;
  onArtistChange: (value: string) => void;
  onDateFilterChange: (value: string) => void;
  onNoSuperGenreChange: (value: boolean) => void;
  onNoGenreChange?: (value: boolean) => void;
  onClearFilters: () => void;
  onPageChange: (page: number) => void;
}

interface TrackFiltersProps {
  config: FilterConfig;
  state: FilterState;
  options: FilterOptions;
  callbacks: FilterCallbacks;
  className?: string;
}

export const TrackFilters: React.FC<TrackFiltersProps> = ({
  config,
  state,
  options,
  callbacks,
  className = ""
}) => {
  const hasActiveFilters = state.searchQuery || (state.selectedGenre && state.selectedGenre !== 'all') || (state.selectedSuperGenre && state.selectedSuperGenre !== 'all') || (state.selectedArtist && state.selectedArtist !== 'all') || state.dateFilter || state.noSuperGenre || state.noGenre;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Top Row: Search Bar + Date Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        {/* Search Bar */}
        {config.search && (
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tracks or artists…"
              value={state.searchQuery}
              onChange={(e) => callbacks.onSearchChange(e.target.value)}
              className="pl-8"
            />
          </div>
        )}

        {/* Date Filters */}
        {config.dateFilters && (
          <div className="flex gap-2">
            <Button
              variant={state.dateFilter === 'week' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                callbacks.onDateFilterChange(state.dateFilter === 'week' ? '' : 'week');
                callbacks.onPageChange(1);
              }}
            >
              Last Week
            </Button>
            <Button
              variant={state.dateFilter === 'month' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                callbacks.onDateFilterChange(state.dateFilter === 'month' ? '' : 'month');
                callbacks.onPageChange(1);
              }}
            >
              Last Month
            </Button>
            {callbacks.onNoGenreChange && (
              <Button
                variant={state.noGenre ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  const newValue = !state.noGenre;
                  callbacks.onNoGenreChange!(newValue);
                  callbacks.onPageChange(1);
                }}
              >
                Unmapped Only
              </Button>
            )}
          </div>
        )}
      </div>
      
      {/* Bottom Row: Super Genre + Genre + Artist Filters + No Super Genre */}
      {(config.genre || config.superGenre || config.artist) && (
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Super Genre Filter */}
          {config.superGenre && (
            <div className="flex-1 max-w-xs">
              <Select
                value={state.noSuperGenre ? 'no-super-genre' : (state.selectedSuperGenre || 'all')}
          onValueChange={(value) => {
            if (value === 'no-super-genre') {
              callbacks.onNoSuperGenreChange(true);
              callbacks.onSuperGenreChange('');
            } else {
              callbacks.onNoSuperGenreChange(false);
              callbacks.onSuperGenreChange(value === 'all' ? '' : value);
            }
            callbacks.onGenreChange(''); // Clear genre filter when super genre changes
            callbacks.onArtistChange(''); // Clear artist filter when super genre changes
            callbacks.onPageChange(1);
          }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={config.superGenreLabel || "All Supergenres"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{config.superGenreLabel || "All Supergenres"}</SelectItem>
                  <SelectItem value="no-super-genre">Unmapped</SelectItem>
                  <SelectSeparator />
                  <SelectItem value={DANCE_ALL_VALUE}>Dance (all)</SelectItem>
                  <SelectSeparator />
                  {options.superGenres.map((superGenre) => (
                    <SelectItem key={superGenre} value={superGenre}>
                      {superGenre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Genre Filter */}
          {config.genre && (
            <div className="flex-1 max-w-xs">
              <Select
                value={state.selectedGenre || 'all'}
                onValueChange={(value) => {
                  callbacks.onGenreChange(value === 'all' ? '' : value);
                  callbacks.onArtistChange(''); // Clear artist filter when genre changes
                  callbacks.onPageChange(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={config.genreLabel || "All Spotify genres"} />
                </SelectTrigger>
                  <SelectContent>
                  <SelectItem value="all">{config.genreLabel || "All Spotify genres"}</SelectItem>
                  {options.genres.filter(genre => genre && genre.trim() !== '').map((genre) => (
                    <SelectItem key={genre} value={genre}>
                      {genre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          
          {/* Artist Filter */}
          {config.artist && (
            <div className="flex-1 max-w-xs">
              <Select
                value={state.selectedArtist || 'all'}
                onValueChange={(value) => {
                  callbacks.onArtistChange(value === 'all' ? '' : value);
                  callbacks.onPageChange(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All artists" />
                </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                  <SelectItem value="all">All artists</SelectItem>
                  {options.artists.filter(artist => artist && artist.trim() !== '').map((artist) => (
                    <SelectItem key={artist} value={artist}>
                      {artist}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Clear Filters Button */}
      {hasActiveFilters && (
        <div className="flex justify-start">
          <Button variant="ghost" size="sm" onClick={callbacks.onClearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear Filters
          </Button>
        </div>
      )}
    </div>
  );
};
