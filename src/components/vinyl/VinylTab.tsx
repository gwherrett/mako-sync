import React, { useState } from 'react';
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
import type { PhysicalMediaRecord } from '@/types/discogs';

/**
 * VinylTab — tab-safe vinyl collection UI.
 * Contains all collection UI without page header or Back button chrome.
 */
export const VinylTab: React.FC = () => {
  const { collection, isLoading, deleteRecord } = usePhysicalMedia();
  const { isConnected: discogsConnected } = useDiscogsAuth();
  const { sync: syncWithDiscogs, isPending: isSyncing } = useDiscogsSync();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<PhysicalMediaRecord | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  return (
    <div className="space-y-4">
      {/* Sub-header: count + Add Record */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Disc3 className="h-5 w-5 text-primary" />
          <span className="font-semibold text-foreground">
            Vinyl Collection
          </span>
          {!isLoading && collection.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {collection.length} {collection.length === 1 ? 'record' : 'records'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {discogsConnected && (
            <Button size="sm" variant="outline" onClick={() => syncWithDiscogs()} disabled={isSyncing}>
              {isSyncing ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Syncing…</>
              ) : (
                <><RefreshCw className="h-4 w-4 mr-2" />Sync with Discogs</>
              )}
            </Button>
          )}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add to Discogs
          </Button>
        </div>
      </div>

      {/* Discogs info banner */}
      {!discogsConnected && !bannerDismissed && (
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/40 text-sm">
          <Info className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <p className="flex-1 text-muted-foreground">
            Connect Discogs on the{' '}
            <Link to="/security" className="underline hover:text-foreground">Settings page</Link>
            {' '}to search for exact pressings and get tracklist cross-reference data.
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={() => setBannerDismissed(true)}
          >
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

      {/* Collection grid */}
      {!isLoading && collection.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {collection.map(record => (
            <VinylCard
              key={record.id}
              record={record}
              onClick={() => setSelectedRecord(record)}
              onRemove={deleteRecord}
            />
          ))}
        </div>
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
