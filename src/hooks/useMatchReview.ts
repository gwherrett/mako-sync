import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/NewAuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  ManualMatchService,
  type ConfirmMatchOptions,
  type ConfirmMissingOptions,
  type RejectCandidateOptions,
  type ReviewCandidates,
} from '@/services/manualMatch.service';
import { TrackMatchingService, type MatchCandidateFilters } from '@/services/trackMatching.service';

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
  // The decided track leaves the queue straight away. The refetch then reconciles.
  const decided = (spotifyLikedId: string) => {
    const undecided = (item: { spotifyTrack: { id: string } }) => item.spotifyTrack.id !== spotifyLikedId;
    queryClient.setQueriesData<ReviewCandidates>({ queryKey: baseKey }, queue =>
      queue && {
        ...queue,
        toApprove: queue.toApprove.filter(undecided),
        toReview: queue.toReview.filter(undecided),
      }
    );
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
      onSuccess: (_id: string, { spotifyLikedId }: ConfirmMissingVariables) => decided(spotifyLikedId),
      onError: failWith('Could not confirm missing'),
    },
    undoDecision: {
      mutationFn: (trackMatchId: string) => ManualMatchService.undoDecision(trackMatchId),
      onSuccess: invalidate,
      onError: failWith('Could not undo decision'),
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
