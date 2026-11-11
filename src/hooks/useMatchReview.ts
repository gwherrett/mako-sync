import { useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/NewAuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  ManualMatchService,
  type ConfirmMatchOptions,
  type ConfirmMissingOptions,
  type ConfirmedMissingTrack,
  type RejectCandidateOptions,
  type ReviewCandidates,
} from '@/services/manualMatch.service';
import { DuplicateDetectionService } from '@/services/duplicateDetection.service';
import { TrackMatchingService, type MatchCandidateFilters } from '@/services/trackMatching.service';
import type { SpotifyTrack } from '@/services/trackMatchingEngine';

const QUERY_KEY = 'match_review';
const FILTER_OPTIONS_QUERY_KEY = 'match_review_filter_options';

type ErrorToast = (toast: { title: string; description: string; variant: 'destructive' }) => void;

export interface ConfirmMatchVariables {
  spotifyLikedId: string;
  mp3Id: string;
  options: ConfirmMatchOptions;
}

export interface RejectCandidateVariables {
  spotifyLikedId: string;
  mp3Id: string;
  options: RejectCandidateOptions;
}

export interface ConfirmMissingVariables {
  spotifyLikedId: string;
  options?: ConfirmMissingOptions;
}

export interface UnlikeTrackVariables {
  /** `spotify_liked.id`, to drop the track from the loaded queue. */
  spotifyLikedId: string;
  /** Spotify's own track id, which the Spotify API takes. */
  spotifyId: string;
}

/** The fields of a queued Spotify track that the Edit SuperGenre dialog changes. */
export type SpotifyTrackGenrePatch = Pick<SpotifyTrack, 'super_genre' | 'super_genre_manual_override'>;

/** The queue with the track gone from every group, as after an unlike. */
export function withoutSpotifyTrack(queue: ReviewCandidates, spotifyLikedId: string): ReviewCandidates {
  const keep = (item: { spotifyTrack: SpotifyTrack }) => item.spotifyTrack.id !== spotifyLikedId;
  return {
    ...queue,
    autoConfirmed: queue.autoConfirmed.filter(keep),
    toReview: queue.toReview.filter(keep),
    confirmedMissing: queue.confirmedMissing.filter(keep),
  };
}

/** The queue with one Spotify track's fields changed in every group it appears in. */
export function withSpotifyTrackPatched(
  queue: ReviewCandidates,
  spotifyLikedId: string,
  patch: SpotifyTrackGenrePatch
): ReviewCandidates {
  const update = <T extends { spotifyTrack: SpotifyTrack }>(item: T): T =>
    item.spotifyTrack.id === spotifyLikedId ? { ...item, spotifyTrack: { ...item.spotifyTrack, ...patch } } : item;
  return {
    ...queue,
    autoConfirmed: queue.autoConfirmed.map(update),
    toReview: queue.toReview.map(update),
    confirmedMissing: queue.confirmedMissing.map(update),
  };
}

/** Every review queue a user has loaded shares this prefix, so one invalidation covers them all. */
export function matchReviewBaseKey(userId: string | undefined) {
  return [QUERY_KEY, userId] as const;
}

export function matchReviewQueryKey(userId: string | undefined, filters: MatchCandidateFilters | null) {
  return [
    ...matchReviewBaseKey(userId),
    filters?.superGenre ?? 'all',
    filters?.genre ?? 'all',
    filters?.artist ?? 'all',
  ] as const;
}

/**
 * Mutation options for every review write. Each one invalidates the review queue on success
 * and shows a destructive toast on error. Built outside the hook so it can be tested with a
 * plain QueryClient.
 */
export function createMatchReviewMutations({
  queryClient,
  toast,
  userId,
}: {
  queryClient: QueryClient;
  toast: ErrorToast;
  userId: string | undefined;
}) {
  const baseKey = matchReviewBaseKey(userId);
  // Not returned from onSuccess: the refetch re-runs the whole match, and a decision
  // shouldn't stay pending until that finishes.
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: baseKey });
  };
  const failWith = (title: string) => (error: Error) => {
    toast({ title, description: error.message, variant: 'destructive' });
  };
  // The decided track leaves the queue straight away, and a track confirmed missing joins
  // Confirmed Missing. The refetch then reconciles.
  const decided = (spotifyLikedId: string, missing?: { trackMatchId: string; options?: ConfirmMissingOptions }) => {
    queryClient.setQueriesData<ReviewCandidates>({ queryKey: baseKey }, queue => {
      if (!queue) return queue;
      const item = queue.toReview.find(i => i.spotifyTrack.id === spotifyLikedId);
      const confirmedMissing: ConfirmedMissingTrack[] =
        item && missing
          ? [
              ...queue.confirmedMissing,
              {
                trackMatchId: missing.trackMatchId,
                spotifyTrack: item.spotifyTrack,
                failureCategory: missing.options?.failureCategory ?? null,
                notes: missing.options?.notes ?? null,
                reviewedAt: new Date().toISOString(),
              },
            ]
          : queue.confirmedMissing;
      return {
        ...queue,
        toReview: queue.toReview.filter(i => i.spotifyTrack.id !== spotifyLikedId),
        confirmedMissing,
      };
    });
    invalidate();
  };

  return {
    bulkAutoConfirmTier1: {
      mutationFn: (filters: MatchCandidateFilters) => {
        if (!userId) throw new Error('Sign in to review matches.');
        return ManualMatchService.bulkAutoConfirmTier1(userId, filters);
      },
      onSuccess: invalidate,
      onError: failWith('Could not confirm exact matches'),
    },
    confirmMatch: {
      mutationFn: ({ spotifyLikedId, mp3Id, options }: ConfirmMatchVariables) =>
        ManualMatchService.confirmMatch(spotifyLikedId, mp3Id, options),
      onSuccess: (_id: string, { spotifyLikedId }: ConfirmMatchVariables) => decided(spotifyLikedId),
      onError: failWith('Could not confirm match'),
    },
    rejectCandidate: {
      mutationFn: ({ spotifyLikedId, mp3Id, options }: RejectCandidateVariables) =>
        ManualMatchService.rejectCandidate(spotifyLikedId, mp3Id, options),
      onSuccess: invalidate,
      onError: failWith('Could not reject candidate'),
    },
    confirmTrueMissing: {
      mutationFn: ({ spotifyLikedId, options }: ConfirmMissingVariables) =>
        ManualMatchService.confirmTrueMissing(spotifyLikedId, options),
      onSuccess: (trackMatchId: string, { spotifyLikedId, options }: ConfirmMissingVariables) =>
        decided(spotifyLikedId, { trackMatchId, options }),
      onError: failWith('Could not confirm missing'),
    },
    undoDecision: {
      mutationFn: (trackMatchId: string) => ManualMatchService.undoDecision(trackMatchId),
      // An undone confirmed-missing row leaves that list straight away. The refetch puts
      // the track back in the queue.
      onSuccess: (_result: void, trackMatchId: string) => {
        queryClient.setQueriesData<ReviewCandidates>({ queryKey: baseKey }, queue =>
          queue && {
            ...queue,
            confirmedMissing: queue.confirmedMissing.filter(item => item.trackMatchId !== trackMatchId),
          }
        );
        invalidate();
      },
      onError: failWith('Could not undo decision'),
    },
    unlikeTrack: {
      mutationFn: ({ spotifyId }: UnlikeTrackVariables) => {
        if (!userId) throw new Error('Sign in to unlike tracks.');
        return DuplicateDetectionService.unlikeTrack(spotifyId, userId);
      },
      // Unliking deletes the spotify_liked row, and its track_matches rows cascade with it.
      onSuccess: (_result: void, { spotifyLikedId }: UnlikeTrackVariables) => {
        queryClient.setQueriesData<ReviewCandidates>({ queryKey: baseKey }, queue =>
          queue && withoutSpotifyTrack(queue, spotifyLikedId)
        );
        invalidate();
      },
      onError: failWith('Failed to unlike'),
    },
  };
}

/**
 * The review queue for a filtered subset, plus the writes a person makes on it.
 * Pass `null` until the person asks for a queue: nothing is fetched before then.
 */
export function useMatchReview(filters: MatchCandidateFilters | null) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const query = useQuery({
    queryKey: matchReviewQueryKey(userId, filters),
    enabled: !!userId && filters !== null,
    queryFn: () => ManualMatchService.getCandidatesForReview(userId!, filters!),
    // The fetch re-runs the whole match, so it only happens on Load and after a decision.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const queryError = query.error;
  useEffect(() => {
    if (queryError) {
      toast({ title: 'Could not load review queue', description: queryError.message, variant: 'destructive' });
    }
  }, [queryError, toast]);

  const mutations = useMemo(
    () => createMatchReviewMutations({ queryClient, toast, userId }),
    [queryClient, toast, userId]
  );
  const bulkAutoConfirm = useMutation(mutations.bulkAutoConfirmTier1);
  const confirmMatch = useMutation(mutations.confirmMatch);
  const rejectCandidate = useMutation(mutations.rejectCandidate);
  const confirmTrueMissing = useMutation(mutations.confirmTrueMissing);
  const undoDecision = useMutation(mutations.undoDecision);
  const unlikeTrack = useMutation(mutations.unlikeTrack);

  // Not a refetch: that re-runs the whole match, and would drop a track whose new
  // supergenre falls outside the filters while the person is still looking at it.
  const updateSpotifyTrack = useCallback(
    (spotifyLikedId: string, patch: SpotifyTrackGenrePatch) => {
      queryClient.setQueriesData<ReviewCandidates>({ queryKey: matchReviewBaseKey(userId) }, queue =>
        queue && withSpotifyTrackPatched(queue, spotifyLikedId, patch)
      );
    },
    [queryClient, userId]
  );

  return {
    queue: query.data,
    /** True for the first fetch of a queue, when there are no rows to show yet. */
    isLoading: bulkAutoConfirm.isPending || query.isLoading,
    /** True while a loaded queue is being re-read after a decision. */
    isRefreshing: query.isFetching && !query.isLoading,
    error: bulkAutoConfirm.error ?? query.error,
    bulkAutoConfirmTier1: bulkAutoConfirm.mutateAsync,
    confirmMatch: confirmMatch.mutateAsync,
    rejectCandidate: rejectCandidate.mutateAsync,
    confirmTrueMissing: confirmTrueMissing.mutateAsync,
    undoDecision: undoDecision.mutateAsync,
    unlikeTrack: unlikeTrack.mutateAsync,
    /** Change a track's fields in the loaded queue, after an edit saved elsewhere. */
    updateSpotifyTrack,
  };
}

/** Genre and artist options for the review filters, narrowed by the supergenre. */
export function useReviewFilterOptions(superGenre: string) {
  const { user } = useAuth();
  const userId = user?.id;

  const { data: pairs = [], isLoading } = useQuery({
    queryKey: [FILTER_OPTIONS_QUERY_KEY, userId, superGenre],
    enabled: !!userId,
    queryFn: () => TrackMatchingService.fetchGenreArtistPairs(userId!, superGenre),
    staleTime: 5 * 60 * 1000,
  });

  return { pairs, isLoading };
}
