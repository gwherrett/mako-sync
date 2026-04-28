import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Disc3, Plus, Info, X, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { usePhysicalMedia } from '@/hooks/usePhysicalMedia';
import { useDiscogsAuth } from '@/hooks/useDiscogsAuth';
import { useDiscogsSync } from '@/hooks/useDiscogsSync';
import { VinylCard } from '@/components/vinyl/VinylCard';
import { VinylDetailPanel } from '@/components/vinyl/VinylDetailPanel';
import { AddVinylDialog } from '@/components/vinyl/AddVinylDialog';
import { VinylFilters, VINYL_FILTER_DEFAULTS, applyVinylFilters } from '@/components/vinyl/VinylFilters';
import type { VinylFilterState, VinylFilterOptions } from '@/components/vinyl/VinylFilters';
import { ViewModeSwitcher } from '@/components/vinyl/ViewModeSwitcher';
import type { ViewMode } from '@/components/vinyl/ViewModeSwitcher';
import { CoverFlowView } from '@/components/vinyl/CoverFlowView';
import { VinylListView } from '@/components/vinyl/VinylListView';
import type { PhysicalMediaRecord } from '@/types/discogs';

function getDecade(year: number | null): string | null {
  if (!year) return null;
  if (year < 1950) return 'pre-1950';
  return `${Math.floor(year / 10) * 10}s`;
}

const STORAGE_KEY = 'mako_vinyl_view_mode';

export const VinylTab: React.FC = () => {
  const { collection, isLoading, deleteRecord } = usePhysicalMedia();
  const { isConnected: discogsConnected } = useDiscogsAuth();
  const { sync: syncWithDiscogs, isPending: isSyncing } = useDiscogsSync();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<PhysicalMediaRecord | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem(STORAGE_KEY) as ViewMode | null) ?? 'grid'
  );
  const [filterState, setFilterState] = useState<VinylFilterState>(VINYL_FILTER_DEFAULTS);

  const handleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  };

  const filterOptions = useMemo<VinylFilterOptions>(() => {
    const decadeSet = new Set<string>();
    collection.forEach((r) => {
      const d = getDecade(r.year);
      if (d) decadeSet.add(d);
    });
    return {
      artists: [...new Set(collection.map((r) => r.artist).filter(Boolean))].sort() as string[],
      labels: [...new Set(collection.map((r) => r.label).filter((l) => l != null))].sort() as string[],
      formats: [...new Set(collection.map((r) => r.format).filter((f) => f != null))].sort() as string[],
      decades: [...decadeSet].sort(),
      superGenres: [...new Set(collection.map((r) => r.super_genre).filter((g) => g != null))].sort() as string[],
    };
  }, [collection]);

  const filteredRecords = useMemo(
    () => applyVinylFilters(collection, filterState),
    [collection, filterState]
  );

  const hasFilters =
    filterState.searchQuery !== VINYL_FILTER_DEFAULTS.searchQuery ||
    filterState.selectedArtist !== VINYL_FILTER_DEFAULTS.selectedArtist ||
    filterState.selectedLabel !== VINYL_FILTER_DEFAULTS.selectedLabel ||
    filterState.selectedFormat !== VINYL_FILTER_DEFAULTS.selectedFormat ||
    filterState.selectedDecade !== VINYL_FILTER_DEFAULTS.selectedDecade ||
    filterState.selectedSuperGenre !== VINYL_FILTER_DEFAULTS.selectedSuperGenre ||
    filterState.minRating !== VINYL_FILTER_DEFAULTS.minRating;

  const badgeLabel = hasFilters && filteredRecords.length !== collection.length
    ? `${filteredRecords.length} of ${collection.length} records`
    : `${collection.length} ${collection.length === 1 ? 'record' : 'records'}`;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <Disc3 className="h-5 w-5 text-primary" />
          <span className="font-semibold text-foreground">Vinyl Collection</span>
          {!isLoading && collection.length > 0 && (
            <Badge variant="secondary" className="text-xs">{badgeLabel}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && collection.length > 0 && (
            <ViewModeSwitcher value={viewMode} onChange={handleViewMode} />
          )}
          {discogsConnected && (
            <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => syncWithDiscogs()} disabled={isSyncing}>
              {isSyncing ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Syncing…</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-2" />Sync with Discogs</>
              )}
            </Button>
          )}
          <Button size="sm" className="flex-1 sm:flex-none" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add to Discogs
          </Button>
        </div>
      </div>

      {/* Filter bar — shown when collection is non-empty */}
      {!isLoading && collection.length > 0 && (
        <VinylFilters
          filterState={filterState}
          filterOptions={filterOptions}
          onChange={setFilterState}
        />
      )}

      {/* Discogs info banner */}
      {!discogsConnected && !bannerDismissed && (
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/40 text-sm">
          <Info className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <p className="flex-1 text-muted-foreground">
            Connect Discogs on the{' '}
            <Link to="/security" className="underline hover:text-foreground">Settings page</Link>
            {' '}to search for exact pressings and get tracklist cross-reference data.
          </p>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => setBannerDismissed(true)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-square w-full rounded-md" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && collection.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <div className="p-6 bg-muted rounded-full">
            <Disc3 className="h-12 w-12 text-muted-foreground/40" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Your collection is empty</h2>
            <p className="text-muted-foreground text-sm mt-1">Add your first vinyl record to get started.</p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add your first record
          </Button>
        </div>
      )}

      {/* View modes */}
      {!isLoading && collection.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredRecords.map((record) => (
            <VinylCard
              key={record.id}
              record={record}
              onClick={() => setSelectedRecord(record)}
              onRemove={deleteRecord}
            />
          ))}
          {filteredRecords.length === 0 && (
            <div className="col-span-full flex flex-col items-center py-12 text-muted-foreground gap-2">
              <Disc3 className="h-8 w-8 opacity-30" />
              <p className="text-sm">No records match the current filters.</p>
            </div>
          )}
        </div>
      )}

      {!isLoading && collection.length > 0 && viewMode === 'coverflow' && (
        <CoverFlowView records={filteredRecords} onSelect={setSelectedRecord} />
      )}

      {!isLoading && collection.length > 0 && viewMode === 'list' && (
        <VinylListView records={filteredRecords} onSelect={setSelectedRecord} />
      )}

      {/* Detail panel */}
      <VinylDetailPanel
        record={selectedRecord}
        open={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
      />

      {/* Add dialog */}
      <AddVinylDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
};

export default VinylTab;
