import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import {
  createMatchReviewMutations,
  matchReviewBaseKey,
  matchReviewQueryKey,
} from '@/hooks/useMatchReview';
import { ManualMatchService, type ReviewCandidates, type ReviewItem } from '@/services/manualMatch.service';

/**
 * Tests for the useMatchReview mutations (MAK-180). The suite runs without a DOM, so the
 * mutation options the hook passes to useMutation are run through a MutationObserver.
 */

vi.mock('@/contexts/NewAuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/manualMatch.service', () => ({
  ManualMatchService: {
    getCandidatesForReview: vi.fn(),
    bulkAutoConfirmTier1: vi.fn(),
    confirmMatch: vi.fn(),
    rejectCandidate: vi.fn(),
    confirmTrueMissing: vi.fn(),
    undoDecision: vi.fn(),
  },
}));

const USER_ID = 'user-123';
const FILTERS = { superGenre: 'House', genre: 'all', artist: 'Kerri Chandler' };

function reviewItem(id: string): ReviewItem {
  return {
    spotifyTrack: {
      id, title: `Track ${id}`, artist: 'Kerri Chandler', primary_artist: 'Kerri Chandler',
      album: null, genre: null, super_genre: 'House', super_genre_manual_override: false,
    },
    candidate: null,
    tier: null,
    rejectedMp3Ids: [],
  };
}

function queueOf(...ids: string[]): ReviewCandidates {
  return { autoConfirmed: [], toReview: ids.map(reviewItem), confirmedMissing: [], localTracks: [] };
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const toast = vi.fn();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const mutations = createMatchReviewMutations({ queryClient, toast, userId: USER_ID });
  const run = <TData, TVariables>(
    options: { mutationFn: (variables: TVariables) => TData | Promise<TData> },
    variables: TVariables
  ) => new MutationObserver(queryClient, options as never).mutate(variables as never) as Promise<TData>;
  return { queryClient, toast, invalidate, mutations, run };
}

describe('matchReviewQueryKey', () => {
  it('puts the filters in the key, under the per-user base key', () => {
    expect(matchReviewQueryKey(USER_ID, FILTERS)).toEqual(['match_review', USER_ID, 'House', 'all', 'Kerri Chandler']);
    expect(matchReviewQueryKey(USER_ID, FILTERS).slice(0, 2)).toEqual([...matchReviewBaseKey(USER_ID)]);
  });

  it('reads a missing filter as "all"', () => {
    expect(matchReviewQueryKey(USER_ID, {})).toEqual(['match_review', USER_ID, 'all', 'all', 'all']);
  });
});

describe('useMatchReview mutations — invalidation', () => {
  beforeEach(() => {
    vi.mocked(ManualMatchService.bulkAutoConfirmTier1).mockResolvedValue(42);
    vi.mocked(ManualMatchService.confirmMatch).mockResolvedValue('tm-confirmed');
    vi.mocked(ManualMatchService.rejectCandidate).mockResolvedValue('tm-rejected');
    vi.mocked(ManualMatchService.confirmTrueMissing).mockResolvedValue('tm-missing');
    vi.mocked(ManualMatchService.undoDecision).mockResolvedValue(undefined);
  });

  const expectQueueInvalidated = (invalidate: ReturnType<typeof setup>['invalidate']) => {
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['match_review', USER_ID] });
  };

  it('bulkAutoConfirmTier1 runs for the signed-in user and invalidates the queue', async () => {
    const { mutations, run, invalidate, toast } = setup();

    await expect(run(mutations.bulkAutoConfirmTier1, FILTERS)).resolves.toBe(42);

    expect(ManualMatchService.bulkAutoConfirmTier1).toHaveBeenCalledWith(USER_ID, FILTERS);
    expectQueueInvalidated(invalidate);
    expect(toast).not.toHaveBeenCalled();
  });

  it('confirmMatch passes its options through and invalidates the queue', async () => {
    const { mutations, run, invalidate } = setup();
    const options = { method: 'tier3_fuzzy', confidence: 87, source: 'human' } as const;

    await expect(run(mutations.confirmMatch, { spotifyLikedId: 's1', mp3Id: 'm1', options })).resolves.toBe('tm-confirmed');

    expect(ManualMatchService.confirmMatch).toHaveBeenCalledWith('s1', 'm1', options);
    expectQueueInvalidated(invalidate);
  });

  it('rejectCandidate invalidates the queue', async () => {
    const { mutations, run, invalidate } = setup();
    const options = { method: 'tier2_core' } as const;

    await run(mutations.rejectCandidate, { spotifyLikedId: 's1', mp3Id: 'm1', options });

    expect(ManualMatchService.rejectCandidate).toHaveBeenCalledWith('s1', 'm1', options);
    expectQueueInvalidated(invalidate);
  });

  it('confirmTrueMissing invalidates the queue', async () => {
    const { mutations, run, invalidate } = setup();

    await expect(run(mutations.confirmTrueMissing, { spotifyLikedId: 's1' })).resolves.toBe('tm-missing');

    expect(ManualMatchService.confirmTrueMissing).toHaveBeenCalledWith('s1', undefined);
    expectQueueInvalidated(invalidate);
  });

  it('undoDecision invalidates the queue', async () => {
    const { mutations, run, invalidate } = setup();

    await run(mutations.undoDecision, 'tm-confirmed');

    expect(ManualMatchService.undoDecision).toHaveBeenCalledWith('tm-confirmed');
    expectQueueInvalidated(invalidate);
  });

  it('marks every loaded queue of the user stale, and leaves other users alone', async () => {
    const { mutations, run, queryClient } = setup();
    const mine = matchReviewQueryKey(USER_ID, FILTERS);
    const mineOtherFilters = matchReviewQueryKey(USER_ID, {});
    const theirs = matchReviewQueryKey('someone-else', FILTERS);
    for (const key of [mine, mineOtherFilters, theirs]) queryClient.setQueryData(key, queueOf('s1'));

    await run(mutations.undoDecision, 'tm-confirmed');

    expect(queryClient.getQueryState(mine)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(mineOtherFilters)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(theirs)?.isInvalidated).toBe(false);
  });
});

describe('useMatchReview mutations — the decided row leaves the queue', () => {
  beforeEach(() => {
    vi.mocked(ManualMatchService.confirmMatch).mockResolvedValue('tm-confirmed');
    vi.mocked(ManualMatchService.rejectCandidate).mockResolvedValue('tm-rejected');
    vi.mocked(ManualMatchService.confirmTrueMissing).mockResolvedValue('tm-missing');
  });

  const queuedIds = (queryClient: QueryClient) =>
    queryClient.getQueryData<ReviewCandidates>(matchReviewQueryKey(USER_ID, FILTERS))?.toReview.map(i => i.spotifyTrack.id);

  it('removes the track after confirmMatch, before the refetch', async () => {
    const { mutations, run, queryClient } = setup();
    queryClient.setQueryData(matchReviewQueryKey(USER_ID, FILTERS), queueOf('s1', 's2'));

    await run(mutations.confirmMatch, { spotifyLikedId: 's1', mp3Id: 'm1', options: { method: 'manual', source: 'human' } });

    expect(queuedIds(queryClient)).toEqual(['s2']);
  });

  it('removes the track after confirmTrueMissing', async () => {
    const { mutations, run, queryClient } = setup();
    queryClient.setQueryData(matchReviewQueryKey(USER_ID, FILTERS), queueOf('s1', 's2'));

    await run(mutations.confirmTrueMissing, { spotifyLikedId: 's2' });

    expect(queuedIds(queryClient)).toEqual(['s1']);
  });

  it('keeps the track after rejectCandidate: it still needs a decision', async () => {
    const { mutations, run, queryClient } = setup();
    queryClient.setQueryData(matchReviewQueryKey(USER_ID, FILTERS), queueOf('s1', 's2'));

    await run(mutations.rejectCandidate, { spotifyLikedId: 's1', mp3Id: 'm1', options: { method: 'tier2_core' } });

    expect(queuedIds(queryClient)).toEqual(['s1', 's2']);
  });
});

describe('useMatchReview mutations — errors', () => {
  it.each([
    ['confirmMatch', 'Could not confirm match', { spotifyLikedId: 's1', mp3Id: 'm1', options: { method: 'manual', source: 'human' } }],
    ['rejectCandidate', 'Could not reject candidate', { spotifyLikedId: 's1', mp3Id: 'm1', options: { method: 'tier2_core' } }],
    ['confirmTrueMissing', 'Could not confirm missing', { spotifyLikedId: 's1' }],
    ['undoDecision', 'Could not undo decision', 'tm-1'],
    ['bulkAutoConfirmTier1', 'Could not confirm exact matches', FILTERS],
  ] as const)('%s shows a destructive toast and does not invalidate', async (name, title, variables) => {
    const { mutations, run, invalidate, toast, queryClient } = setup();
    queryClient.setQueryData(matchReviewQueryKey(USER_ID, FILTERS), queueOf('s1'));
    vi.mocked(ManualMatchService[name]).mockRejectedValue(new Error('row level security'));

    await expect(run(mutations[name] as never, variables)).rejects.toThrow('row level security');

    expect(toast).toHaveBeenCalledWith({ title, description: 'row level security', variant: 'destructive' });
    expect(invalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData<ReviewCandidates>(matchReviewQueryKey(USER_ID, FILTERS))?.toReview).toHaveLength(1);
  });

  it('bulkAutoConfirmTier1 fails without a signed-in user', async () => {
    const queryClient = new QueryClient();
    const toast = vi.fn();
    const mutations = createMatchReviewMutations({ queryClient, toast, userId: undefined });

    await expect(
      new MutationObserver(queryClient, mutations.bulkAutoConfirmTier1).mutate(FILTERS)
    ).rejects.toThrow('Sign in to review matches.');
    expect(ManualMatchService.bulkAutoConfirmTier1).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });
});
