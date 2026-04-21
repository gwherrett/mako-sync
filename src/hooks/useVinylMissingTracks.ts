import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/NewAuthContext';
import { TrackMatchingService } from '@/services/trackMatching.service';
import {
  buildLocalIndex,
  normalize,
  normalizeArtist,
  extractCoreTitle,
  calculateSimilarity,
  FUZZY_MATCH_THRESHOLD,
  type LocalTrack,
} from '@/services/trackMatchingEngine';
import type { PhysicalMediaRecord } from '@/types/discogs';

interface VinylMissingTracksResult {
  matched: LocalTrack[];
  missing: { position: string; title: string }[];
  isLoading: boolean;
  error: Error | null;
}

export function useVinylMissingTracks(record: PhysicalMediaRecord | null): VinylMissingTracksResult {
  const { user } = useAuth();

  // Global cache for local tracks corpus — shared across all record views
  const { data: localTracks } = useQuery({
    queryKey: ['local-tracks-corpus', user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: () => TrackMatchingService.fetchLocalTracks(user!.id),
  });

  const hasTracklist = !!record && Array.isArray(record.tracklist) && record.tracklist.length > 0;

  const { data, isLoading, error } = useQuery({
    queryKey: ['vinyl-missing', record?.id],
    enabled: !!user?.id && hasTracklist && !!localTracks,
    staleTime: 5 * 60 * 1000,
    queryFn: () => {
      const localIndex = buildLocalIndex(localTracks!);
      const normalizedArtist = normalizeArtist(record!.artist);

      const matched: LocalTrack[] = [];
      const missing: { position: string; title: string }[] = [];

      for (const discogsTrack of record!.tracklist!) {
        if (!discogsTrack.title) continue;

        const normTitle = normalize(discogsTrack.title);
        const coreTitle = extractCoreTitle(discogsTrack.title);

        const exactKey = `${normTitle}_${normalizedArtist}`;
        if (localIndex.exactSet.has(exactKey)) {
          const found = localIndex.normalized.find(l => `${l.title}_${l.artist}` === exactKey);
          if (found) matched.push(found.track);
          continue;
        }

        const coreKey = `${coreTitle}_${normalizedArtist}`;
        if (localIndex.coreSet.has(coreKey)) {
          const found = localIndex.normalized.find(l => `${l.coreTitle}_${l.artist}` === coreKey);
          if (found) matched.push(found.track);
          continue;
        }

        let fuzzyFound = null;
        for (const local of localIndex.normalized) {
          if (local.artist !== normalizedArtist) continue;
          const titleSim = calculateSimilarity(local.title, normTitle);
          const coreSim = calculateSimilarity(local.coreTitle, coreTitle);
          if (titleSim >= FUZZY_MATCH_THRESHOLD || coreSim >= FUZZY_MATCH_THRESHOLD) {
            fuzzyFound = local.track;
            break;
          }
        }

        if (fuzzyFound) {
          matched.push(fuzzyFound);
        } else {
          missing.push({ position: discogsTrack.position, title: discogsTrack.title });
        }
      }

      return { matched, missing };
    },
  });

  return {
    matched: data?.matched ?? [],
    missing: data?.missing ?? [],
    isLoading: isLoading || (!localTracks && !!user?.id),
    error: error as Error | null,
  };
}
