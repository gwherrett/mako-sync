import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/NewAuthContext';
import { TrackMatchingService, type VinylGapRecord } from '@/services/trackMatching.service';
import {
  buildLocalIndex,
  normalize,
  normalizeArtist,
  extractCoreTitle,
  calculateSimilarity,
  FUZZY_MATCH_THRESHOLD,
  type LocalTrack,
} from '@/services/trackMatchingEngine';

interface VinylCollectionGapsResult {
  records: VinylGapRecord[];
  totalMissing: number;
  isLoading: boolean;
  error: Error | null;
}

export function useVinylCollectionGaps(superGenreFilter?: string): VinylCollectionGapsResult {
  const { user } = useAuth();

  // Shared local tracks corpus — same cache key as useVinylMissingTracks
  const { data: localTracks } = useQuery({
    queryKey: ['local-tracks-corpus', user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: () => TrackMatchingService.fetchLocalTracks(user!.id),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['vinyl-collection-gaps', user?.id, superGenreFilter],
    enabled: !!user?.id && !!localTracks,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { records, flat } = await TrackMatchingService.fetchVinylTracks(user!.id, superGenreFilter);

      if (records.length === 0) return [];

      const localIndex = buildLocalIndex(localTracks!);

      // Track matched/missing per record
      const recordMap = new Map<string, { matched: LocalTrack[]; missing: { position: string; title: string }[] }>(
        records.map(r => [r.id, { matched: [], missing: [] }])
      );

      for (const vinylTrack of flat) {
        const normalizedArtist = normalizeArtist(vinylTrack.recordArtist);
        const normTitle = normalize(vinylTrack.title);
        const coreTitle = extractCoreTitle(vinylTrack.title);
        const bucket = recordMap.get(vinylTrack.recordId)!;

        // Tier 1: exact
        const exactKey = `${normTitle}_${normalizedArtist}`;
        if (localIndex.exactSet.has(exactKey)) {
          const found = localIndex.normalized.find(l => `${l.title}_${l.artist}` === exactKey);
          if (found) bucket.matched.push(found.track);
          continue;
        }

        // Tier 2: core title
        const coreKey = `${coreTitle}_${normalizedArtist}`;
        if (localIndex.coreSet.has(coreKey)) {
          const found = localIndex.normalized.find(l => `${l.coreTitle}_${l.artist}` === coreKey);
          if (found) bucket.matched.push(found.track);
          continue;
        }

        // Tier 3: fuzzy
        let fuzzyFound: LocalTrack | null = null;
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
          bucket.matched.push(fuzzyFound);
        } else {
          bucket.missing.push({ position: vinylTrack.position, title: vinylTrack.title });
        }
      }

      // Return only records with at least one missing track
      return records
        .map(record => ({ record, ...recordMap.get(record.id)! }))
        .filter(r => r.missing.length > 0);
    },
  });

  const records = data ?? [];
  const totalMissing = records.reduce((sum, r) => sum + r.missing.length, 0);

  return {
    records,
    totalMissing,
    isLoading: isLoading || (!localTracks && !!user?.id),
    error: error as Error | null,
  };
}
