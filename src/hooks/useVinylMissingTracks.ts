import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/NewAuthContext';
import { TrackMatchingService } from '@/services/trackMatching.service';
import type { PhysicalMediaRecord } from '@/types/discogs';
import type { LocalTrack } from '@/services/trackMatchingEngine';

interface VinylMissingTracksResult {
  matched: LocalTrack[];
  missing: { position: string; title: string }[];
  isLoading: boolean;
  error: Error | null;
}

export function useVinylMissingTracks(record: PhysicalMediaRecord | null): VinylMissingTracksResult {
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['vinyl-missing', record?.id],
    enabled: !!user?.id && !!record && Array.isArray(record.tracklist) && record.tracklist.length > 0,
    staleTime: 5 * 60 * 1000, // 5 min — tracklist data rarely changes
    queryFn: async () => {
      return TrackMatchingService.matchTracklistAgainstLocal(
        user!.id,
        record!.tracklist!,
        record!.artist
      );
    },
  });

  return {
    matched: data?.matched ?? [],
    missing: data?.missing ?? [],
    isLoading,
    error: error as Error | null,
  };
}
