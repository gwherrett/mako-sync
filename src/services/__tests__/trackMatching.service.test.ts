import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackMatchingService } from '../trackMatching.service';
import type { LocalTrack, SpotifyTrack } from '../trackMatchingEngine';
import { supabase } from '@/integrations/supabase/client';
import { DANCE_ALL_VALUE, DANCE_SUPER_GENRES } from '@/types/genreMapping';

type QueryCall = { table: string; method: string; args: unknown[] };

/**
 * Stand-in for the supabase query builder. Filter calls are recorded, not applied: each test
 * passes the rows the database would return for its filters. `range()` serves those rows one
 * page at a time, like PostgREST.
 */
function mockTables(
  rowsByTable: Record<string, unknown[]>,
  errorByTable: Record<string, { message: string }> = {}
): QueryCall[] {
  const calls: QueryCall[] = [];
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const rows = rowsByTable[table] ?? [];
    const error = errorByTable[table];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'order']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    builder.range = (from: number, to: number) => {
      calls.push({ table, method: 'range', args: [from, to] });
      return Promise.resolve(
        error ? { data: null, error } : { data: rows.slice(from, to + 1), error: null }
      );
    };
    return builder;
  }) as unknown as typeof supabase.from);
  return calls;
}

function argsOf(calls: QueryCall[], table: string, method: string): unknown[][] {
  return calls.filter(c => c.table === table && c.method === method).map(c => c.args);
}

function local(id: string, title: string | null, artist: string | null, extra: Partial<LocalTrack> = {}): LocalTrack {
  return { id, title, artist, primary_artist: artist, album: 'Album', genre: null, file_path: `/music/${id}.mp3`, ...extra };
}

function spotify(id: string, title: string, artist: string, extra: Partial<SpotifyTrack> = {}): SpotifyTrack {
  return {
    id, spotify_id: `sp-${id}`, title, artist, primary_artist: artist, album: 'Album', genre: null,
    super_genre: 'House', super_genre_manual_override: false, ...extra,
  };
}

function manySpotify(count: number): SpotifyTrack[] {
  return Array.from({ length: count }, (_, i) => spotify(`s${i}`, `Track ${i}`, `Artist ${i}`));
}

describe('TrackMatchingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('fetchLocalTracks', () => {
    it('should fetch local tracks for a user', async () => {
      const tracks = [local('1', 'Track 1', 'Artist 1'), local('2', 'Track 2', 'Artist 2')];
      const calls = mockTables({ local_mp3s: tracks });

      const result = await TrackMatchingService.fetchLocalTracks('user-123');

      expect(result).toEqual(tracks);
      expect(supabase.from).toHaveBeenCalledWith('local_mp3s');
      expect(argsOf(calls, 'local_mp3s', 'eq')).toEqual([['user_id', 'user-123']]);
    });

    it('pages past the 1000-row cap, ordered by id', async () => {
      const tracks = Array.from({ length: 2500 }, (_, i) => local(`l${i}`, `Track ${i}`, 'Artist'));
      const calls = mockTables({ local_mp3s: tracks });

      const result = await TrackMatchingService.fetchLocalTracks('user-123');

      expect(result).toHaveLength(2500);
      expect(argsOf(calls, 'local_mp3s', 'range')).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
      expect(argsOf(calls, 'local_mp3s', 'order')).toEqual([['id'], ['id'], ['id']]);
    });

    it('asks for one more page after a full last page', async () => {
      const tracks = Array.from({ length: 1000 }, (_, i) => local(`l${i}`, `Track ${i}`, 'Artist'));
      const calls = mockTables({ local_mp3s: tracks });

      const result = await TrackMatchingService.fetchLocalTracks('user-123');

      expect(result).toHaveLength(1000);
      expect(argsOf(calls, 'local_mp3s', 'range')).toEqual([[0, 999], [1000, 1999]]);
    });

    it('should return empty array when no tracks found', async () => {
      mockTables({ local_mp3s: [] });

      const result = await TrackMatchingService.fetchLocalTracks('user-123');

      expect(result).toEqual([]);
    });

    it('should throw error when fetch fails', async () => {
      mockTables({}, { local_mp3s: { message: 'Database error' } });

      await expect(TrackMatchingService.fetchLocalTracks('user-123'))
        .rejects.toThrow('Failed to fetch local tracks: Database error');
    });
  });

  describe('fetchSpotifyTracks', () => {
    it('should fetch spotify tracks for a user', async () => {
      const tracks = [spotify('1', 'Spotify Track 1', 'Artist 1')];
      const calls = mockTables({ spotify_liked: tracks });

      const result = await TrackMatchingService.fetchSpotifyTracks('user-123');

      expect(result).toEqual(tracks);
      expect(supabase.from).toHaveBeenCalledWith('spotify_liked');
      expect(argsOf(calls, 'spotify_liked', 'eq')).toEqual([['user_id', 'user-123']]);
    });

    it('applies the supergenre → genre → artist cascade', async () => {
      const calls = mockTables({ spotify_liked: [spotify('1', 'Track', 'Kerri Chandler')] });

      await TrackMatchingService.fetchSpotifyTracks('user-123', 'House', 'deep house', 'Kerri Chandler');

      expect(argsOf(calls, 'spotify_liked', 'eq')).toEqual([
        ['user_id', 'user-123'],
        ['super_genre', 'House'],
        ['genre', 'deep house'],
        ['artist', 'Kerri Chandler'],
      ]);
    });

    it('should not filter when filters are "all"', async () => {
      const calls = mockTables({ spotify_liked: [spotify('1', 'Track', 'Artist')] });

      const result = await TrackMatchingService.fetchSpotifyTracks('user-123', 'all', 'all', 'all');

      expect(result).toHaveLength(1);
      expect(argsOf(calls, 'spotify_liked', 'eq')).toEqual([['user_id', 'user-123']]);
    });

    it('expands the SuperDJ filter to every dance supergenre', async () => {
      const calls = mockTables({ spotify_liked: [] });

      await TrackMatchingService.fetchSpotifyTracks('user-123', DANCE_ALL_VALUE);

      expect(argsOf(calls, 'spotify_liked', 'in')).toEqual([['super_genre', DANCE_SUPER_GENRES]]);
    });

    it('pages past the 1000-row cap and keeps the filters on every page', async () => {
      const calls = mockTables({ spotify_liked: manySpotify(5482) });

      const result = await TrackMatchingService.fetchSpotifyTracks('user-123', 'House');

      expect(result).toHaveLength(5482);
      expect(argsOf(calls, 'spotify_liked', 'range')).toEqual([
        [0, 999], [1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999], [5000, 5999],
      ]);
      expect(argsOf(calls, 'spotify_liked', 'eq').filter(([column]) => column === 'super_genre')).toHaveLength(6);
      expect(argsOf(calls, 'spotify_liked', 'order')).toEqual(Array(6).fill(['id']));
    });

    it('should throw error when fetch fails', async () => {
      mockTables({}, { spotify_liked: { message: 'API error' } });

      await expect(TrackMatchingService.fetchSpotifyTracks('user-123'))
        .rejects.toThrow('Failed to fetch Spotify tracks: API error');
    });
  });

  describe('fetchGenreArtistPairs', () => {
    it('returns each genre and artist pair once', async () => {
      const calls = mockTables({
        spotify_liked: [
          { genre: 'deep house', artist: 'Kerri Chandler' },
          { genre: 'deep house', artist: 'Kerri Chandler' },
          { genre: 'garage house', artist: 'Kerri Chandler' },
          { genre: null, artist: 'Moodymann' },
        ],
      });

      const pairs = await TrackMatchingService.fetchGenreArtistPairs('user-123', 'House');

      expect(pairs).toEqual([
        { genre: 'deep house', artist: 'Kerri Chandler' },
        { genre: 'garage house', artist: 'Kerri Chandler' },
        { genre: null, artist: 'Moodymann' },
      ]);
      expect(argsOf(calls, 'spotify_liked', 'eq')).toEqual([
        ['user_id', 'user-123'],
        ['super_genre', 'House'],
      ]);
    });

    it('pages past the 1000-row cap', async () => {
      const rows = Array.from({ length: 2500 }, (_, i) => ({ genre: 'house', artist: `Artist ${i}` }));
      const calls = mockTables({ spotify_liked: rows });

      const pairs = await TrackMatchingService.fetchGenreArtistPairs('user-123');

      expect(pairs).toHaveLength(2500);
      expect(argsOf(calls, 'spotify_liked', 'range')).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    });

    it('throws when the fetch fails', async () => {
      mockTables({}, { spotify_liked: { message: 'API error' } });

      await expect(TrackMatchingService.fetchGenreArtistPairs('user-123'))
        .rejects.toThrow('Failed to fetch filter options: API error');
    });
  });

  describe('fetchSuperGenres', () => {
    it('should fetch unique super genres for a user', async () => {
      const mockData = [
        { super_genre: 'Rock' },
        { super_genre: 'Pop' },
        { super_genre: 'Rock' }, // Duplicate
        { super_genre: 'Jazz' },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: mockData, error: null })
            })
          })
        })
      } as unknown as ReturnType<typeof supabase.from>);

      const result = await TrackMatchingService.fetchSuperGenres('user-123');

      expect(result).toEqual(['Jazz', 'Pop', 'Rock']); // Sorted and unique
    });

    it('should return empty array when no genres found', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      } as unknown as ReturnType<typeof supabase.from>);

      const result = await TrackMatchingService.fetchSuperGenres('user-123');

      expect(result).toEqual([]);
    });

    it('should throw error when fetch fails', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'Query failed' } })
            })
          })
        })
      } as unknown as ReturnType<typeof supabase.from>);

      await expect(TrackMatchingService.fetchSuperGenres('user-123'))
        .rejects.toThrow('Failed to fetch super genres: Query failed');
    });
  });

  // ---------------------------------------------------------------------------
  // getMatchCandidates
  // ---------------------------------------------------------------------------

  describe('getMatchCandidates', () => {
    it('returns matched and unmatched results, one per Spotify track, in order', async () => {
      mockTables({
        local_mp3s: [
          local('l1', 'Track One', 'Artist A'),
          local('l2', 'Track Name (Original Mix)', 'Artist A'),
          local('l3', 'Another Song', 'Artist B'),
        ],
        spotify_liked: [
          spotify('s1', 'Track One', 'Artist A'),
          spotify('s2', 'Track Name (Extended Mix)', 'Artist A'),
          spotify('s3', 'Anothr Song', 'Artist B'),
          spotify('s4', 'Missing Track', 'Artist A'),
        ],
      });

      const { results } = await TrackMatchingService.getMatchCandidates('user-123');

      expect(results.map(r => ({
        spotify: r.spotifyTrack.id,
        matched: r.matched,
        tier: r.tier,
        local: r.matchedLocalTrack?.id,
      }))).toEqual([
        { spotify: 's1', matched: true, tier: 1, local: 'l1' },
        { spotify: 's2', matched: true, tier: 2, local: 'l2' },
        { spotify: 's3', matched: true, tier: 3, local: 'l3' },
        { spotify: 's4', matched: false, tier: null, local: undefined },
      ]);
    });

    it('leaves out local tracks whose artist is not in the Spotify subset', async () => {
      mockTables({
        local_mp3s: [
          local('l1', 'Track One', 'Artist A'),
          local('l2', 'Heroes', 'David Bowie'),
          local('l3', 'Other Track', 'Artist A'),
        ],
        spotify_liked: [spotify('s1', 'Track One', 'Artist A')],
      });

      const { localTracks } = await TrackMatchingService.getMatchCandidates('user-123');

      expect(localTracks.map(t => t.id)).toEqual(['l1', 'l3']);
    });

    it('also returns every local track, whatever its artist', async () => {
      mockTables({
        local_mp3s: [
          local('l1', 'Track One', 'Artist A'),
          local('l2', 'Heroes', 'David Bowie'),
          local('l3', 'Untagged', null),
        ],
        spotify_liked: [spotify('s1', 'Track One', 'Artist A')],
      });

      const { allLocalTracks } = await TrackMatchingService.getMatchCandidates('user-123');

      expect(allLocalTracks.map(t => t.id)).toEqual(['l1', 'l2', 'l3']);
    });

    it('compares artists the same way the engine does', async () => {
      mockTables({
        local_mp3s: [
          local('l1', 'Song', 'The Beatles'),
          local('l2', 'Song C', 'Artist C', { primary_artist: null }),
          local('l3', 'Song D', 'Artist D feat. Someone', { primary_artist: 'Artist D' }),
          local('l4', 'Untagged', null),
        ],
        spotify_liked: [
          spotify('s1', 'Song', 'Beatles'),
          spotify('s2', 'Song C', 'ARTIST C', { primary_artist: null }),
          spotify('s3', 'Song D', 'Artist D'),
        ],
      });

      const { results, localTracks } = await TrackMatchingService.getMatchCandidates('user-123');

      expect(localTracks.map(t => t.id)).toEqual(['l1', 'l2', 'l3']);
      expect(results.every(r => r.matched)).toBe(true);
    });

    it('passes the filters to the Spotify fetch', async () => {
      const calls = mockTables({ local_mp3s: [], spotify_liked: [] });

      await TrackMatchingService.getMatchCandidates('user-123', {
        superGenre: 'House',
        genre: 'deep house',
        artist: 'Kerri Chandler',
      });

      expect(argsOf(calls, 'spotify_liked', 'eq')).toEqual([
        ['user_id', 'user-123'],
        ['super_genre', 'House'],
        ['genre', 'deep house'],
        ['artist', 'Kerri Chandler'],
      ]);
    });

    it('returns no results and no in-scope local tracks for an empty Spotify subset', async () => {
      const library = [local('l1', 'Track', 'Artist')];
      mockTables({ local_mp3s: library, spotify_liked: [] });

      const candidates = await TrackMatchingService.getMatchCandidates('user-123');

      expect(candidates).toEqual({ results: [], localTracks: [], allLocalTracks: library });
    });

    it('matches Spotify tracks past the first 1000 rows', async () => {
      const spotifyTracks = manySpotify(1500);
      mockTables({
        local_mp3s: [local('l1', 'Track 1400', 'Artist 1400')],
        spotify_liked: spotifyTracks,
      });

      const { results } = await TrackMatchingService.getMatchCandidates('user-123');

      expect(results).toHaveLength(1500);
      expect(results.filter(r => r.matched).map(r => r.spotifyTrack.id)).toEqual(['s1400']);
    });
  });

  describe('findMissingTracks', () => {
    it('returns the same misses as the old inline tier logic for a mixed library', async () => {
      // Expected misses were recorded by running this fixture against the inline tier logic
      // this service had before it called the engine.
      mockTables({
        local_mp3s: [
          local('l1', 'Track One', 'Artist A'),
          local('l2', 'Track Name (Original Mix)', 'Artist A'),
          local('l3', 'Another Song', 'Artist B'),
          local('l4', 'Song', 'The Beatles'),
          local('l5', 'Heroes', 'David Bowie'),
          local('l6', null, null),
          local('l7', 'Song C', 'Artist C', { primary_artist: null }),
        ],
        spotify_liked: [
          spotify('s1', 'Track One', 'Artist A'),                // tier 1
          spotify('s2', 'Track Name (Extended Mix)', 'Artist A'), // tier 2
          spotify('s3', 'Anothr Song', 'Artist B'),              // tier 3
          spotify('s4', 'Song', 'Beatles'),                      // tier 1, "The" stripped
          spotify('s5', 'Heroes', 'Peter Gabriel'),              // same title, other artist
          spotify('s6', 'Missing Track', 'Artist A'),
          spotify('s7', 'Some Track', 'Unknown Artist'),
          spotify('s8', 'Song C', 'Artist C', { primary_artist: null }),
        ],
      });

      const result = await TrackMatchingService.findMissingTracks('user-123');

      expect(result.map(r => r.spotifyTrack.id)).toEqual(['s5', 's6', 's7']);
      expect(result.every(r => r.reason === 'No matching local track found')).toBe(true);
    });

    it('returns the MissingTrack shape', async () => {
      const missing = spotify('s2', 'Missing Track', 'Artist Two');
      mockTables({
        local_mp3s: [local('1', 'Local Track', 'Artist One')],
        spotify_liked: [spotify('s1', 'Local Track', 'Artist One'), missing],
      });

      const result = await TrackMatchingService.findMissingTracks('user-123');

      expect(result).toEqual([{ spotifyTrack: missing, reason: 'No matching local track found' }]);
    });

    it('should return empty array when all tracks match', async () => {
      mockTables({
        local_mp3s: [local('1', 'Track One', 'Artist')],
        spotify_liked: [spotify('s1', 'Track One', 'Artist')],
      });

      expect(await TrackMatchingService.findMissingTracks('user-123')).toHaveLength(0);
    });

    it('should handle case-insensitive matching', async () => {
      mockTables({
        local_mp3s: [local('1', 'TRACK ONE', 'ARTIST')],
        spotify_liked: [spotify('s1', 'track one', 'artist')],
      });

      expect(await TrackMatchingService.findMissingTracks('user-123')).toHaveLength(0);
    });

    it('should handle null titles and artists', async () => {
      mockTables({
        local_mp3s: [local('1', null, null)],
        spotify_liked: [spotify('s1', 'Some Track', 'Some Artist')],
      });

      // Won't match null with actual values
      expect(await TrackMatchingService.findMissingTracks('user-123')).toHaveLength(1);
    });

    it('should normalize special characters in matching', async () => {
      mockTables({
        local_mp3s: [local('1', 'Track: One!', "Artist's Name")],
        spotify_liked: [spotify('s1', 'Track One', 'Artists Name')],
      });

      expect(await TrackMatchingService.findMissingTracks('user-123')).toHaveLength(0);
    });

    it('matches a cross-compared mix title (Tier 2b) that the old inline logic missed', async () => {
      // The inline tier logic had no Tier 2b, so it listed this track as missing.
      // The engine matches the Spotify full title against the local core title.
      mockTables({
        local_mp3s: [local('l1', 'Zombie Herd Mix (Extended)', 'Fela Kuti')],
        spotify_liked: [spotify('s1', 'Zombie (Herd Mix)', 'Fela Kuti')],
      });

      expect(await TrackMatchingService.findMissingTracks('user-123')).toHaveLength(0);
    });

    it('passes all filters to the Spotify fetch', async () => {
      const calls = mockTables({
        local_mp3s: [],
        spotify_liked: [spotify('s1', 'Rock Track', 'Artist', { super_genre: 'Rock' })],
      });

      const result = await TrackMatchingService.findMissingTracks('user-123', 'Rock', 'rock', 'Artist');

      expect(result).toHaveLength(1);
      expect(argsOf(calls, 'spotify_liked', 'eq')).toEqual([
        ['user_id', 'user-123'],
        ['super_genre', 'Rock'],
        ['genre', 'rock'],
        ['artist', 'Artist'],
      ]);
    });

    it('should use fuzzy matching for minor typos', async () => {
      mockTables({
        local_mp3s: [local('1', 'Track Nme', 'Artist')],
        spotify_liked: [spotify('s1', 'Track Name', 'Artist')],
      });

      expect(await TrackMatchingService.findMissingTracks('user-123')).toHaveLength(0);
    });

    it('should propagate fetch errors', async () => {
      mockTables({ spotify_liked: [] }, { local_mp3s: { message: 'Database error' } });

      await expect(TrackMatchingService.findMissingTracks('user-123'))
        .rejects.toThrow('Failed to fetch local tracks: Database error');
    });
  });

  // ---------------------------------------------------------------------------
  // matchTracklistAgainstLocal
  // ---------------------------------------------------------------------------

  describe('matchTracklistAgainstLocal', () => {
    function mockLocalTracks(tracks: LocalTrack[]) {
      mockTables({ local_mp3s: tracks });
    }

    it('returns all matched when every tracklist title has a local file', async () => {
      const localTracks = [
        { id: '1', title: 'Bohemian Rhapsody', artist: 'Queen', primary_artist: 'Queen', album: 'A Night at the Opera', genre: 'Rock', file_path: '/music/bohem.mp3' },
        { id: '2', title: 'Killer Queen', artist: 'Queen', primary_artist: 'Queen', album: 'Sheer Heart Attack', genre: 'Rock', file_path: '/music/killer.mp3' },
      ];
      mockLocalTracks(localTracks);

      const tracklist = [
        { position: 'A1', title: 'Bohemian Rhapsody' },
        { position: 'A2', title: 'Killer Queen' },
      ];

      const { matched, missing } = await TrackMatchingService.matchTracklistAgainstLocal('user-1', tracklist, 'Queen');

      expect(matched).toHaveLength(2);
      expect(missing).toHaveLength(0);
    });

    it('places unmatched titles in the missing array with position + title', async () => {
      mockLocalTracks([
        { id: '1', title: 'Bohemian Rhapsody', artist: 'Queen', primary_artist: 'Queen', album: 'Album', genre: 'Rock', file_path: '/music/bohem.mp3' },
      ]);

      const tracklist = [
        { position: 'A1', title: 'Bohemian Rhapsody' },
        { position: 'B1', title: 'We Will Rock You' },
      ];

      const { matched, missing } = await TrackMatchingService.matchTracklistAgainstLocal('user-1', tracklist, 'Queen');

      expect(matched).toHaveLength(1);
      expect(missing).toHaveLength(1);
      expect(missing[0]).toEqual({ position: 'B1', title: 'We Will Rock You' });
    });

    it('returns empty matched and missing for an empty tracklist', async () => {
      mockLocalTracks([]);

      const { matched, missing } = await TrackMatchingService.matchTracklistAgainstLocal('user-1', [], 'Artist');

      expect(matched).toHaveLength(0);
      expect(missing).toHaveLength(0);
    });

    it('skips tracklist entries with empty title (side headings)', async () => {
      mockLocalTracks([
        { id: '1', title: 'Track A', artist: 'Artist', primary_artist: 'Artist', album: 'Album', genre: 'Rock', file_path: '/music/a.mp3' },
      ]);

      const tracklist = [
        { position: 'Side A', title: '' },
        { position: 'A1', title: 'Track A' },
      ];

      const { matched, missing } = await TrackMatchingService.matchTracklistAgainstLocal('user-1', tracklist, 'Artist');

      expect(matched).toHaveLength(1);
      expect(missing).toHaveLength(0);
    });

    it('matches via core title when Discogs track has a different mix suffix', async () => {
      mockLocalTracks([
        { id: '1', title: 'Acid Rain (Original Mix)', artist: 'Objekt', primary_artist: 'Objekt', album: 'Flatland', genre: 'Techno', file_path: '/music/acid.mp3' },
      ]);

      const tracklist = [
        { position: 'A1', title: 'Acid Rain (Dub Mix)' },
      ];

      const { matched, missing } = await TrackMatchingService.matchTracklistAgainstLocal('user-1', tracklist, 'Objekt');

      expect(matched).toHaveLength(1);
      expect(missing).toHaveLength(0);
    });

    it('matches via fuzzy tier for high-similarity titles', async () => {
      mockLocalTracks([
        { id: '1', title: 'Blue in Green', artist: 'Miles Davis', primary_artist: 'Miles Davis', album: 'Kind of Blue', genre: 'Jazz', file_path: '/music/big.mp3' },
      ]);

      const tracklist = [{ position: 'B2', title: 'Blue In Green' }];

      const { matched, missing } = await TrackMatchingService.matchTracklistAgainstLocal('user-1', tracklist, 'Miles Davis');

      expect(matched).toHaveLength(1);
      expect(missing).toHaveLength(0);
    });

    it('does not cross-match tracks from a different artist', async () => {
      mockLocalTracks([
        { id: '1', title: 'Heroes', artist: 'David Bowie', primary_artist: 'David Bowie', album: 'Heroes', genre: 'Rock', file_path: '/music/heroes.mp3' },
      ]);

      const tracklist = [{ position: 'A1', title: 'Heroes' }];

      const { matched, missing } = await TrackMatchingService.matchTracklistAgainstLocal('user-1', tracklist, 'Peter Gabriel');

      expect(matched).toHaveLength(0);
      expect(missing).toHaveLength(1);
    });

    it('returns empty results when local library is empty', async () => {
      mockLocalTracks([]);

      const tracklist = [
        { position: 'A1', title: 'Some Track' },
        { position: 'A2', title: 'Another Track' },
      ];

      const { matched, missing } = await TrackMatchingService.matchTracklistAgainstLocal('user-1', tracklist, 'Artist');

      expect(matched).toHaveLength(0);
      expect(missing).toHaveLength(2);
    });
  });
});
