/**
 * useSlskdSync Hook
 *
 * Pushes tracks to slskd as searches. slskd has no wishlist: each search is saved to its
 * Searches page, where you download from the results.
 * Uses localStorage-based configuration from SlskdStorageService.
 */

import { useState, useCallback } from 'react';
import { SlskdClientService } from '@/services/slskdClient.service';
import { SlskdStorageService } from '@/services/slskdStorage.service';
import type { SlskdPushProgress, SlskdSyncResult, SlskdTrackToSync } from '@/types/slskd';
import { useToast } from '@/hooks/use-toast';

export function useSlskdSync() {
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SlskdSyncResult | undefined>();
  const [syncError, setSyncError] = useState<Error | null>(null);
  const [progress, setProgress] = useState<SlskdPushProgress | null>(null);

  /**
   * Push tracks to slskd, starting one search per track
   */
  const syncToSlskdAsync = useCallback(async (
    tracks: SlskdTrackToSync[]
  ): Promise<SlskdSyncResult> => {
    const config = SlskdStorageService.getConfig();

    if (!config.apiEndpoint || !config.apiKey) {
      throw new Error('slskd not configured. Go to Settings → Security to configure.');
    }

    return SlskdClientService.pushTracks(config, tracks, setProgress);
  }, []);

  /**
   * Push tracks with state management and toast notifications
   */
  const syncToSlskd = useCallback((tracks: SlskdTrackToSync[]) => {
    setIsSyncing(true);
    setSyncError(null);
    setSyncResult(undefined);
    setProgress({ current: 0, total: tracks.length, currentTrack: '' });

    syncToSlskdAsync(tracks)
      .then((result) => {
        setSyncResult(result);
        toast({
          title: 'Push complete',
          description: `Added ${result.addedCount}, Skipped ${result.skippedCount}, Failed ${result.failedCount}`,
        });
      })
      .catch((error: Error) => {
        setSyncError(error);
        toast({
          title: 'Push failed',
          description: error.message,
          variant: 'destructive',
        });
      })
      .finally(() => {
        setIsSyncing(false);
        setProgress(null);
      });
  }, [syncToSlskdAsync, toast]);

  /**
   * Push a single album to slskd as one search (no progress modal — single-shot)
   */
  const syncAlbumToSlskd = useCallback(async (track: SlskdTrackToSync): Promise<void> => {
    const config = SlskdStorageService.getConfig();

    if (!config.apiEndpoint || !config.apiKey) {
      toast({
        title: 'slskd not configured',
        description: 'Go to Settings → Security to configure slskd.',
        variant: 'destructive',
      });
      return;
    }

    const album = track.album;
    if (!album) {
      toast({ title: 'No album info', description: 'This track has no album name.', variant: 'destructive' });
      return;
    }

    const artist = track.primary_artist || track.artist;
    const searchText = SlskdClientService.formatAlbumSearchQuery(artist, album, config.searchFormat);

    try {
      const existingSearches = await SlskdClientService.getExistingSearches(config);
      const outcome = await SlskdClientService.startSearchUnlessDuplicate(config, existingSearches, searchText);
      if (outcome === 'skipped') {
        toast({ title: 'Already searched', description: `"${searchText}" is already in slskd's searches.` });
        return;
      }
      toast({ title: 'Album search started', description: `Started a search in slskd for "${searchText}".` });
    } catch (error) {
      toast({
        title: 'Failed to push album',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [toast]);

  /**
   * Reset sync state
   */
  const reset = useCallback(() => {
    setSyncResult(undefined);
    setSyncError(null);
    setProgress(null);
  }, []);

  return {
    syncToSlskd,
    syncToSlskdAsync,
    syncAlbumToSlskd,
    isSyncing,
    syncResult,
    syncError,
    progress,
    reset,
  };
}
