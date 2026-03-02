/**
 * useSlskdSync Hook
 *
 * Handles syncing tracks to slskd wishlist.
 * Uses localStorage-based configuration from SlskdStorageService.
 */

import { useState, useCallback } from 'react';
import { SlskdClientService } from '@/services/slskdClient.service';
import { SlskdStorageService } from '@/services/slskdStorage.service';
import type { SlskdSyncResult, SlskdTrackToSync } from '@/types/slskd';
import { useToast } from '@/hooks/use-toast';

interface SyncProgress {
  current: number;
  total: number;
  currentTrack: string;
}

export function useSlskdSync() {
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SlskdSyncResult | undefined>();
  const [syncError, setSyncError] = useState<Error | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  /**
   * Sync tracks to slskd wishlist
   */
  const syncToSlskdAsync = useCallback(async (
    tracks: SlskdTrackToSync[]
  ): Promise<SlskdSyncResult> => {
    const config = SlskdStorageService.getConfig();

    if (!config.apiEndpoint || !config.apiKey) {
      throw new Error('slskd not configured. Go to Settings → Security to configure.');
    }

    const existingSearches = await SlskdClientService.getExistingSearches(config);

    const result: SlskdSyncResult = {
      totalTracks: tracks.length,
      addedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const artist = track.primary_artist || track.artist;
      const searchText = SlskdClientService.formatSearchQuery(
        artist,
        track.title,
        config.searchFormat
      );

      setProgress({
        current: i + 1,
        total: tracks.length,
        currentTrack: `${artist} - ${track.title}`,
      });

      if (SlskdClientService.isSearchDuplicate(existingSearches, searchText)) {
        result.skippedCount++;
        continue;
      }

      try {
        await SlskdClientService.addToWishlist(config, searchText);
        result.addedCount++;
        // Add to local list to prevent duplicates within same batch
        existingSearches.push({ id: '', searchText, state: 'InProgress' });
      } catch (error) {
        result.failedCount++;
        result.errors.push({
          track: `${artist} - ${track.title}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return result;
  }, []);

  /**
   * Sync tracks with state management and toast notifications
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
          title: 'Sync Complete',
          description: `Added ${result.addedCount}, Skipped ${result.skippedCount}, Failed ${result.failedCount}`,
        });
      })
      .catch((error: Error) => {
        setSyncError(error);
        toast({
          title: 'Sync Failed',
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
   * Push a single album to slskd wishlist (no progress modal — single-shot)
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
      if (SlskdClientService.isSearchDuplicate(existingSearches, searchText)) {
        toast({ title: 'Already queued', description: `"${searchText}" is already in slskd.` });
        return;
      }
      await SlskdClientService.addToWishlist(config, searchText);
      toast({ title: 'Album added', description: `"${searchText}" added to slskd wishlist.` });
    } catch (error) {
      toast({
        title: 'Failed to add album',
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
