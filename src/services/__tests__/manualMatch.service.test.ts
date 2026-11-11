import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ManualMatchService,
  DB_BATCH_SIZE,
  findNewDownloadIds,
  type TrackMatchDecision,
} from '../manualMatch.service';
import type { LocalTrack, SpotifyTrack } from '../trackMatchingEngine';
import { supabase } from '@/integrations/supabase/client';

const NOW = '2026-11-08T12:00:00.000Z';
const WRITE_METHODS = ['upsert', 'insert', 'update', 'delete'] as const;
type WriteMethod = (typeof WRITE_METHODS)[number];

type Op = { method: string; args: unknown[] };
type QueryCall = { table: string; ops: Op[] };

/**
 * Stand-in for the supabase query builder. Every `from()` call is recorded with the chain of
 * methods called on it. Filters are recorded, not applied: each test passes the rows the
 * database would return. Reads are served one `range()` page at a time, like PostgREST.
 * Writes resolve to no error, and a write ending in `.single()` returns a new row id.
 */
function mockSupabase(
  rowsByTable: Record<string, unknown[]>,
  {
    writeErrors = {},
    deleteCount = 1,
  }: { writeErrors?: Partial<Record<WriteMethod, { message: string }>>; deleteCount?: number } = {}
): QueryCall[] {
  const calls: QueryCall[] = [];
  let nextId = 0;

  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const call: QueryCall = { table, ops: [] };
    calls.push(call);

    const respond = () => {
      const write = WRITE_METHODS.find(method => call.ops.some(op => op.method === method));
      if (write) {
        const error = writeErrors[write];
        if (error) return { data: null, error, count: null };
        if (write === 'delete') return { data: null, error: null, count: deleteCount };
        const single = call.ops.some(op => op.method === 'single');
        return { data: single ? { id: `tm-new-${++nextId}` } : null, error: null };
      }
      const rows = rowsByTable[table] ?? [];
      const range = call.ops.find(op => op.method === 'range');
      const [from, to] = (range?.args ?? [0, rows.length - 1]) as number[];
      return { data: rows.slice(from, to + 1), error: null };
    };

    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(respond()).then(resolve, reject),
    };
    for (const method of ['select', 'eq', 'in', 'is', 'not', 'order', 'range', 'single', ...WRITE_METHODS]) {
      builder[method] = (...args: unknown[]) => {
        call.ops.push({ method, args });
        return builder;
      };
    }
    return builder;
  }) as unknown as typeof supabase.from);

  return calls;
}

/** The track_matches queries that called `method`, in order. */
function queriesWith(calls: QueryCall[], method: string): QueryCall[] {
  return calls.filter(call => call.table === 'track_matches' && call.ops.some(op => op.method === method));
}

/** The args of every `method` call on one query. */
function argsOf(call: QueryCall, method: string): unknown[][] {
  return call.ops.filter(op => op.method === method).map(op => op.args);
}

function local(id: string, title: string, artist: string): LocalTrack {
  return { id, title, artist, primary_artist: artist, album: 'Album', genre: null, file_path: `/music/${id}.mp3` };
}

function spotify(id: string, title: string, artist: string): SpotifyTrack {
  return {
    id, title, artist, primary_artist: artist, album: 'Album', genre: null,
    super_genre: 'House', super_genre_manual_override: false,
  };
}

function decision(
  id: string,
  spotifyLikedId: string,
  mp3Id: string | null,
  isConfirmed: boolean | null,
  extra: Partial<TrackMatchDecision> = {}
): TrackMatchDecision {
  return {
    id, spotify_track_id: spotifyLikedId, mp3_id: mp3Id, is_confirmed: isConfirmed,
    match_method: 'manual', match_confidence: null, matched_at: '2026-11-01T00:00:00.000Z',
    source: 'human', reviewed_at: '2026-11-01T00:00:00.000Z', failure_category: null, notes: null,
    ...extra,
  };
}

/** One Spotify track per tier, against a library where each tier has one candidate. */
const LIBRARY = {
  local_mp3s: [
    local('l1', 'Track One', 'Artist A'),
    local('l2', 'Track Name (Original Mix)', 'Artist A'),
    local('l3', 'Another Song', 'Artist B'),
    local('l4', 'Unrelated', 'Artist A'),
  ],
  spotify_liked: [
    spotify('s1', 'Track One', 'Artist A'),                // tier 1
    spotify('s2', 'Track Name (Extended Mix)', 'Artist A'), // tier 2
    spotify('s3', 'Anothr Song', 'Artist B'),              // tier 3
    spotify('s4', 'Missing Track', 'Artist A'),            // no match
  ],
};

function summarise(review: Awaited<ReturnType<typeof ManualMatchService.getCandidatesForReview>>) {
  return {
    autoConfirmed: review.autoConfirmed.map(m => `${m.spotifyTrack.id}→${m.localTrack.id}`),
    toApprove: review.toApprove.map(r => `${r.spotifyTrack.id}→${r.candidate?.id ?? 'none'} (tier ${r.tier})`),
    toReview: review.toReview.map(r => `${r.spotifyTrack.id}→${r.candidate?.id ?? 'none'} (tier ${r.tier})`),
    confirmedMissing: review.confirmedMissing.map(m => m.spotifyTrack.id),
  };
}

describe('ManualMatchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // getCandidatesForReview
  // ---------------------------------------------------------------------------

  describe('getCandidatesForReview', () => {
    it('puts Tier 1 results in autoConfirmed and Tier 2, Tier 3 and no-match results in toReview', async () => {
      mockSupabase({ ...LIBRARY, track_matches: [] });

      const review = await ManualMatchService.getCandidatesForReview('user-1');

      expect(summarise(review)).toEqual({
        autoConfirmed: ['s1→l1'],
        toApprove: [],
        toReview: ['s2→l2 (tier 2)', 's3→l3 (tier 3)', 's4→none (tier null)'],
        confirmedMissing: [],
      });
      expect(review.autoConfirmed[0].trackMatchId).toBeNull();
      expect(review.toReview[1].similarity).toBeGreaterThanOrEqual(85);
      expect(review.toReview[0]).not.toHaveProperty('similarity');
    });

    it('leaves a Spotify track with a confirmed row out of toReview', async () => {
      mockSupabase({
        ...LIBRARY,
        track_matches: [
          decision('tm1', 's2', 'l2', true, { match_method: 'tier2_core' }),
          decision('tm2', 's4', 'l4', true),                    // a person's pick for a no-match
          decision('tm3', 's1', 'l1', true, { source: 'engine', reviewed_at: null }),
        ],
      });

      const review = await ManualMatchService.getCandidatesForReview('user-1');

      expect(summarise(review)).toEqual({
        autoConfirmed: ['s1→l1'],
        toApprove: [],
        toReview: ['s3→l3 (tier 3)'],
        confirmedMissing: [],
      });
      expect(review.autoConfirmed[0].trackMatchId).toBe('tm3');
    });

    it('does not suggest a rejected pair again', async () => {
      mockSupabase({
        ...LIBRARY,
        track_matches: [
          decision('tm1', 's1', 'l1', false, { match_method: 'tier1_exact' }),
          decision('tm2', 's2', 'l2', false, { match_method: 'tier2_core' }),
        ],
      });

      const review = await ManualMatchService.getCandidatesForReview('user-1');

      // Both tracks stay in the queue with no candidate, so the person can pick or confirm missing.
      expect(summarise(review)).toEqual({
        autoConfirmed: [],
        toApprove: [],
        toReview: ['s1→none (tier null)', 's2→none (tier null)', 's3→l3 (tier 3)', 's4→none (tier null)'],
        confirmedMissing: [],
      });
      expect(review.toReview[0].rejectedMp3Ids).toEqual(['l1']);
      expect(review.toReview[1].rejectedMp3Ids).toEqual(['l2']);
    });

    it('lists tracks confirmed as missing in confirmedMissing, not toReview or autoConfirmed', async () => {
      mockSupabase({
        ...LIBRARY,
        track_matches: [
          decision('tm1', 's4', null, true, { failure_category: 'unknown', notes: 'not released' }),
          decision('tm2', 's1', null, true),  // the exact match was the wrong song
        ],
      });

      const review = await ManualMatchService.getCandidatesForReview('user-1');

      expect(summarise(review)).toEqual({
        autoConfirmed: [],
        toApprove: [],
        toReview: ['s2→l2 (tier 2)', 's3→l3 (tier 3)'],
        confirmedMissing: ['s1', 's4'],
      });
      expect(review.confirmedMissing[1]).toEqual({
        trackMatchId: 'tm1',
        spotifyTrack: LIBRARY.spotify_liked[3],
        failureCategory: 'unknown',
        notes: 'not released',
        reviewedAt: '2026-11-01T00:00:00.000Z',
      });
    });

    it('keeps an unreviewed engine suggestion in the queue', async () => {
      mockSupabase({
        ...LIBRARY,
        track_matches: [decision('tm1', 's2', 'l2', null, { source: 'engine', reviewed_at: null })],
      });

      const review = await ManualMatchService.getCandidatesForReview('user-1');

      expect(summarise(review).toReview).toContain('s2→l2 (tier 2)');
    });

    it('returns every local track for search-and-pick, including artists outside the Spotify subset', async () => {
      mockSupabase({
        local_mp3s: [...LIBRARY.local_mp3s, local('l9', 'Heroes', 'David Bowie')],
        spotify_liked: LIBRARY.spotify_liked,
        track_matches: [],
      });

      const review = await ManualMatchService.getCandidatesForReview('user-1');

      expect(review.localTracks.map(t => t.id)).toEqual(['l1', 'l2', 'l3', 'l4', 'l9']);
    });

    it("reads the user's decisions through spotify_liked, past the first 1000 rows", async () => {
      const spotifyTracks = Array.from({ length: 1500 }, (_, i) => spotify(`s${i}`, `Track ${i}`, `Artist ${i}`));
      const decisions = spotifyTracks.map((track, i) => decision(`tm${i}`, track.id, null, true));
      const calls = mockSupabase({ local_mp3s: [], spotify_liked: spotifyTracks, track_matches: decisions });

      const review = await ManualMatchService.getCandidatesForReview('user-1');

      expect(review.confirmedMissing).toHaveLength(1500);
      const reads = queriesWith(calls, 'range');
      expect(reads.map(read => argsOf(read, 'range')[0])).toEqual([[0, 999], [1000, 1999]]);
      for (const read of reads) {
        expect(argsOf(read, 'select')[0][0]).toContain('spotify_liked!inner(user_id)');
        expect(argsOf(read, 'eq')).toEqual([['spotify_liked.user_id', 'user-1']]);
        expect(argsOf(read, 'order')).toEqual([['id']]);
      }
    });

    it('ignores decisions for Spotify tracks outside the filtered subset', async () => {
      mockSupabase({
        ...LIBRARY,
        track_matches: [decision('tm1', 'other-genre-track', null, true)],
      });

      const review = await ManualMatchService.getCandidatesForReview('user-1', { superGenre: 'House' });

      expect(review.confirmedMissing).toEqual([]);
    });

    it('does not read track_matches when the filtered subset is empty', async () => {
      const calls = mockSupabase({ local_mp3s: [], spotify_liked: [], track_matches: [] });

      const review = await ManualMatchService.getCandidatesForReview('user-1');

      expect(review).toEqual({ autoConfirmed: [], toApprove: [], toReview: [], confirmedMissing: [], localTracks: [] });
      expect(calls.filter(call => call.table === 'track_matches')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // New downloads
  // ---------------------------------------------------------------------------

  describe('new downloads', () => {
    /** LIBRARY, imported a year ago, with l1 and l3 downloaded in the last few days. */
    const withDownloads = () => ({
      ...LIBRARY,
      local_mp3s: LIBRARY.local_mp3s.map(track => ({
        ...track,
        created_at:
          track.id === 'l1' ? '2026-11-05T00:00:00.000Z'
          : track.id === 'l3' ? '2026-11-07T00:00:00.000Z'
          : '2025-11-01T00:00:00.000Z',
      })),
      track_matches: [],
    });

    it('puts matches for new downloads in toApprove at every tier, newest file first', async () => {
      mockSupabase(withDownloads());

      const review = summarise(await ManualMatchService.getCandidatesForReview('user-1'));

      expect(review.toApprove).toEqual(['s3→l3 (tier 3)', 's1→l1 (tier 1)']);
      expect(review.autoConfirmed).toEqual([]);
      expect(review.toReview).toEqual(['s2→l2 (tier 2)', 's4→none (tier null)']);
    });

    it('does not auto-confirm a Tier 1 match for a new download', async () => {
      const calls = mockSupabase(withDownloads());

      const written = await ManualMatchService.bulkAutoConfirmTier1('user-1');

      expect(written).toBe(0);
      expect(queriesWith(calls, 'upsert')).toEqual([]);
    });

    it('leaves a confirmed new download out of toApprove', async () => {
      mockSupabase({
        ...withDownloads(),
        track_matches: [decision('tm-1', 's1', 'l1', true, { match_method: 'tier1_exact' })],
      });

      const review = summarise(await ManualMatchService.getCandidatesForReview('user-1'));

      expect(review.toApprove).toEqual(['s3→l3 (tier 3)']);
      expect(review.autoConfirmed).toEqual(['s1→l1']);
    });
  });

  describe('findNewDownloadIds', () => {
    const now = new Date(NOW);
    const at = (id: string, createdAt: string | null) => ({ ...local(id, id, 'Artist'), created_at: createdAt });

    it('treats the initial import as not new, even when it was recent', () => {
      const ids = findNewDownloadIds(
        [
          at('import-1', '2026-11-01T10:00:00.000Z'),
          at('import-2', '2026-11-01T20:00:00.000Z'),
          at('download', '2026-11-04T00:00:00.000Z'),
        ],
        now
      );

      expect([...ids]).toEqual(['download']);
    });

    it('only counts files added in the last 30 days', () => {
      const ids = findNewDownloadIds(
        [
          at('import', '2025-01-01T00:00:00.000Z'),
          at('old', '2026-10-01T00:00:00.000Z'),
          at('recent', '2026-10-20T00:00:00.000Z'),
        ],
        now
      );

      expect([...ids]).toEqual(['recent']);
    });

    it('ignores files with no scan time', () => {
      expect(findNewDownloadIds([at('a', null), local('b', 'b', 'Artist')], now).size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // bulkAutoConfirmTier1
  // ---------------------------------------------------------------------------

  describe('bulkAutoConfirmTier1', () => {
    it('makes 3 upsert calls for 250 Tier 1 candidates', async () => {
      const count = 250;
      const calls = mockSupabase({
        local_mp3s: Array.from({ length: count }, (_, i) => local(`l${i}`, `Track ${i}`, `Artist ${i}`)),
        spotify_liked: Array.from({ length: count }, (_, i) => spotify(`s${i}`, `Track ${i}`, `Artist ${i}`)),
        track_matches: [],
      });

      const written = await ManualMatchService.bulkAutoConfirmTier1('user-1');

      expect(written).toBe(count);
      const upserts = queriesWith(calls, 'upsert');
      expect(upserts).toHaveLength(3);
      const batches = upserts.map(call => argsOf(call, 'upsert')[0]);
      expect(batches.map(([rows]) => (rows as unknown[]).length)).toEqual([DB_BATCH_SIZE, DB_BATCH_SIZE, 50]);
      expect(batches.every(([, options]) => (options as { onConflict: string }).onConflict === 'spotify_track_id,mp3_id')).toBe(true);
      expect((batches[0][0] as unknown[])[0]).toEqual({
        spotify_track_id: 's0',
        mp3_id: 'l0',
        is_confirmed: true,
        match_method: 'tier1_exact',
        match_confidence: null,
        source: 'engine',
      });
    });

    it('skips tracks that already have a confirmed row and pairs the person rejected', async () => {
      const calls = mockSupabase({
        local_mp3s: [local('l1', 'One', 'A'), local('l2', 'Two', 'A'), local('l3', 'Three', 'A'), local('l4', 'Four', 'A')],
        spotify_liked: [spotify('s1', 'One', 'A'), spotify('s2', 'Two', 'A'), spotify('s3', 'Three', 'A'), spotify('s4', 'Four', 'A')],
        track_matches: [
          decision('tm1', 's1', 'l1', true, { source: 'engine', reviewed_at: null }), // already confirmed
          decision('tm2', 's2', null, true),                                         // confirmed missing
          decision('tm3', 's3', 'l3', false, { match_method: 'tier1_exact' }),       // rejected pair
        ],
      });

      const written = await ManualMatchService.bulkAutoConfirmTier1('user-1');

      expect(written).toBe(1);
      const [upsert] = queriesWith(calls, 'upsert');
      expect((argsOf(upsert, 'upsert')[0][0] as { spotify_track_id: string }[]).map(r => r.spotify_track_id)).toEqual(['s4']);
    });

    it('writes nothing when there are no Tier 1 results', async () => {
      const calls = mockSupabase({ ...LIBRARY, local_mp3s: [], track_matches: [] });

      expect(await ManualMatchService.bulkAutoConfirmTier1('user-1')).toBe(0);
      expect(queriesWith(calls, 'upsert')).toEqual([]);
    });

    it('throws when a batch fails', async () => {
      mockSupabase({ ...LIBRARY, track_matches: [] }, { writeErrors: { upsert: { message: 'RLS denied' } } });

      await expect(ManualMatchService.bulkAutoConfirmTier1('user-1'))
        .rejects.toThrow('Failed to auto-confirm Tier 1 matches after 0 rows: RLS denied');
    });
  });

  // ---------------------------------------------------------------------------
  // confirmMatch
  // ---------------------------------------------------------------------------

  describe('confirmMatch', () => {
    it('upserts a confirmed row with reviewed_at and returns its id', async () => {
      const calls = mockSupabase({});

      const id = await ManualMatchService.confirmMatch('s3', 'l3', { method: 'tier3_fuzzy', confidence: 91.7, source: 'human' });

      expect(id).toBe('tm-new-1');
      const [upsert] = queriesWith(calls, 'upsert');
      expect(argsOf(upsert, 'upsert')[0]).toEqual([
        {
          spotify_track_id: 's3',
          mp3_id: 'l3',
          is_confirmed: true,
          match_method: 'tier3_fuzzy',
          match_confidence: 91.7,
          source: 'human',
          reviewed_at: NOW,
        },
        { onConflict: 'spotify_track_id,mp3_id' },
      ]);
      expect(argsOf(upsert, 'select')).toEqual([['id']]);
    });

    it('sets the other unreviewed rows for that track to false', async () => {
      const calls = mockSupabase({});

      await ManualMatchService.confirmMatch('s2', 'l9', { method: 'manual', source: 'human' });

      const trackMatchCalls = calls.filter(call => call.table === 'track_matches');
      expect(trackMatchCalls.map(call => call.ops[0].method)).toEqual(['upsert', 'update']);
      const update = trackMatchCalls[1];
      expect(argsOf(update, 'update')).toEqual([[{ is_confirmed: false, reviewed_at: NOW }]]);
      expect(argsOf(update, 'eq')).toEqual([['spotify_track_id', 's2']]);
      expect(argsOf(update, 'is')).toEqual([['is_confirmed', null]]);
    });

    it('saves a manual pick with no confidence', async () => {
      const calls = mockSupabase({});

      await ManualMatchService.confirmMatch('s4', 'l4', { method: 'manual', source: 'human' });

      const [upsert] = queriesWith(calls, 'upsert');
      expect(argsOf(upsert, 'upsert')[0][0]).toMatchObject({ match_method: 'manual', match_confidence: null });
    });

    it('throws when the upsert fails, without touching other rows', async () => {
      const calls = mockSupabase({}, {
        writeErrors: { upsert: { message: 'duplicate key value violates unique constraint "track_matches_one_confirmed_per_spotify_track"' } },
      });

      await expect(ManualMatchService.confirmMatch('s1', 'l1', { method: 'tier1_exact', source: 'human' }))
        .rejects.toThrow('Failed to confirm match: duplicate key value');
      expect(queriesWith(calls, 'update')).toEqual([]);
    });

    it('says the match was saved when rejecting the other suggestions fails', async () => {
      mockSupabase({}, { writeErrors: { update: { message: 'timeout' } } });

      await expect(ManualMatchService.confirmMatch('s1', 'l1', { method: 'tier1_exact', source: 'human' }))
        .rejects.toThrow('Saved the decision, but failed to reject the other suggestions: timeout');
    });
  });

  // ---------------------------------------------------------------------------
  // rejectCandidate
  // ---------------------------------------------------------------------------

  describe('rejectCandidate', () => {
    it('upserts a rejected human row and returns its id', async () => {
      const calls = mockSupabase({});

      const id = await ManualMatchService.rejectCandidate('s2', 'l2', {
        method: 'tier2_core',
        failureCategory: 'title-version-confusion',
        notes: 'radio edit, not the extended mix',
      });

      expect(id).toBe('tm-new-1');
      const [upsert] = queriesWith(calls, 'upsert');
      expect(argsOf(upsert, 'upsert')[0]).toEqual([
        {
          spotify_track_id: 's2',
          mp3_id: 'l2',
          is_confirmed: false,
          match_method: 'tier2_core',
          source: 'human',
          reviewed_at: NOW,
          failure_category: 'title-version-confusion',
          notes: 'radio edit, not the extended mix',
        },
        { onConflict: 'spotify_track_id,mp3_id' },
      ]);
    });

    it('stores null category and notes when they are left out', async () => {
      const calls = mockSupabase({});

      await ManualMatchService.rejectCandidate('s3', 'l3', { method: 'tier3_fuzzy' });

      const [upsert] = queriesWith(calls, 'upsert');
      expect(argsOf(upsert, 'upsert')[0][0]).toMatchObject({ failure_category: null, notes: null });
    });

    it('throws when the upsert fails', async () => {
      mockSupabase({}, { writeErrors: { upsert: { message: 'RLS denied' } } });

      await expect(ManualMatchService.rejectCandidate('s2', 'l2', { method: 'tier2_core' }))
        .rejects.toThrow('Failed to reject candidate: RLS denied');
    });
  });

  // ---------------------------------------------------------------------------
  // confirmTrueMissing
  // ---------------------------------------------------------------------------

  describe('confirmTrueMissing', () => {
    it('writes mp3_id: null as a confirmed manual row and returns its id', async () => {
      const calls = mockSupabase({});

      const id = await ManualMatchService.confirmTrueMissing('s4', { notes: 'only on vinyl' });

      expect(id).toBe('tm-new-1');
      const [insert] = queriesWith(calls, 'insert');
      expect(argsOf(insert, 'insert')).toEqual([[
        {
          spotify_track_id: 's4',
          mp3_id: null,
          is_confirmed: true,
          match_method: 'manual',
          source: 'human',
          reviewed_at: NOW,
          failure_category: null,
          notes: 'only on vinyl',
        },
      ]]);
      expect(queriesWith(calls, 'upsert')).toEqual([]);
    });

    it('sets the unreviewed rows for that track to false', async () => {
      const calls = mockSupabase({});

      await ManualMatchService.confirmTrueMissing('s4');

      const [update] = queriesWith(calls, 'update');
      expect(argsOf(update, 'eq')).toEqual([['spotify_track_id', 's4']]);
      expect(argsOf(update, 'is')).toEqual([['is_confirmed', null]]);
    });

    it('throws when the insert fails, without touching other rows', async () => {
      const calls = mockSupabase({}, { writeErrors: { insert: { message: 'duplicate key value' } } });

      await expect(ManualMatchService.confirmTrueMissing('s4'))
        .rejects.toThrow('Failed to confirm missing: duplicate key value');
      expect(queriesWith(calls, 'update')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // undoDecision
  // ---------------------------------------------------------------------------

  describe('undoDecision', () => {
    it('deletes the row by id, only if a person reviewed it', async () => {
      const calls = mockSupabase({});

      await ManualMatchService.undoDecision('tm1');

      const [del] = queriesWith(calls, 'delete');
      expect(argsOf(del, 'delete')).toEqual([[{ count: 'exact' }]]);
      expect(argsOf(del, 'eq')).toEqual([['id', 'tm1']]);
      expect(argsOf(del, 'not')).toEqual([['reviewed_at', 'is', null]]);
    });

    it('throws when no reviewed row was deleted', async () => {
      mockSupabase({}, { deleteCount: 0 });

      await expect(ManualMatchService.undoDecision('tm-engine'))
        .rejects.toThrow('No reviewed decision found with id tm-engine');
    });

    it('throws when the delete fails', async () => {
      mockSupabase({}, { writeErrors: { delete: { message: 'RLS denied' } } });

      await expect(ManualMatchService.undoDecision('tm1')).rejects.toThrow('Failed to undo decision: RLS denied');
    });
  });
});
