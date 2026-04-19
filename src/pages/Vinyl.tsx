import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Disc3, Plus, Info, X, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { usePhysicalMedia } from '@/hooks/usePhysicalMedia';
import { useDiscogsAuth } from '@/hooks/useDiscogsAuth';
import { useDiscogsPull } from '@/hooks/useDiscogsPull';
import { VinylCard } from '@/components/vinyl/VinylCard';
import { VinylDetailPanel } from '@/components/vinyl/VinylDetailPanel';
import { AddVinylDialog } from '@/components/vinyl/AddVinylDialog';
import type { PhysicalMediaRecord } from '@/types/discogs';

const Vinyl: React.FC = () => {
  const { collection, isLoading } = usePhysicalMedia();
  const { isConnected: discogsConnected } = useDiscogsAuth();
  const { pullFromDiscogs, isPulling } = useDiscogsPull();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<PhysicalMediaRecord | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link to="/">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Dashboard
                </Button>
              </Link>
              <div className="flex items-center gap-3">
                <Disc3 className="h-8 w-8 text-primary" />
                <div>
                  <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                    Vinyl Collection
                    {!isLoading && (
                      <Badge variant="secondary" className="text-sm font-normal">
                        {collection.length} {collection.length === 1 ? 'record' : 'records'}
                      </Badge>
                    )}
                  </h1>
                  <p className="text-muted-foreground text-sm">Track your physical media and find missing digital files</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {discogsConnected && (
                <Button variant="outline" onClick={() => pullFromDiscogs()} disabled={isPulling}>
                  {isPulling ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Syncing…</>
                  ) : (
                    <><RefreshCw className="h-4 w-4 mr-2" />Sync from Discogs</>
                  )}
                </Button>
              )}
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Record
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Discogs connection banner */}
        {!discogsConnected && !bannerDismissed && (
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/40 text-sm">
            <Info className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <p className="flex-1 text-muted-foreground">
              Connect Discogs on the{' '}
              <Link to="/security" className="underline hover:text-foreground">Security page</Link>
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
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <div className="p-6 bg-muted rounded-full">
              <Disc3 className="h-14 w-14 text-muted-foreground/40" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Your collection is empty</h2>
              <p className="text-muted-foreground mt-1">Add your first vinyl record to get started.</p>
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
              />
            ))}
          </div>
        )}
      </main>

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

export default Vinyl;
