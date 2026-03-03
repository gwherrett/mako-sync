import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getArtistGenresWithCache } from '../../../supabase/functions/spotify-sync-liked/artist-genres';

const TOKEN = 'test-access-token';

function makeSupabaseMock(cachedRows: { spotify_artist_id: string; genres: string[] }[]) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: cachedRows, error: null }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }),
  };
}

describe('getArtistGenresWithCache — cache-first priority', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call Spotify when all artists are cached', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const supabase = makeSupabaseMock([
      { spotify_artist_id: 'artist1', genres: ['rock'] },
      { spotify_artist_id: 'artist2', genres: ['pop'] },
    ]);

    const result = await getArtistGenresWithCache(TOKEN, ['artist1', 'artist2'], supabase);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.get('artist1')).toEqual(['rock']);
    expect(result.get('artist2')).toEqual(['pop']);
  });

  it('only fetches uncached artists from Spotify', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const id = url.split('/').pop();
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id, genres: ['electronic'] }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const supabase = makeSupabaseMock([
      { spotify_artist_id: 'cached-artist', genres: ['jazz'] },
    ]);

    const result = await getArtistGenresWithCache(
      TOKEN,
      ['cached-artist', 'uncached-artist'],
      supabase,
    );

    // Only the uncached artist should trigger a Spotify fetch
    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/\/v1\/artists\/uncached-artist$/);
    expect(calledUrl).not.toMatch(/\/v1\/artists\/cached-artist$/);

    expect(result.get('cached-artist')).toEqual(['jazz']);
    expect(result.get('uncached-artist')).toEqual(['electronic']);
  });

  it('returns combined map of cached + fresh genres', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const id = url.split('/').pop();
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id, genres: ['classical'] }),
      });
    }));

    const supabase = makeSupabaseMock([
      { spotify_artist_id: 'a1', genres: ['blues'] },
    ]);

    const result = await getArtistGenresWithCache(TOKEN, ['a1', 'a2'], supabase);

    expect(result.size).toBe(2);
    expect(result.get('a1')).toEqual(['blues']);
    expect(result.get('a2')).toEqual(['classical']);
  });

  it('deduplicates artist IDs before querying cache or Spotify', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'artist1', genres: ['funk'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // Cache returns nothing so Spotify is called for the unique uncached ID
    const supabase = makeSupabaseMock([]);

    await getArtistGenresWithCache(TOKEN, ['artist1', 'artist1', 'artist1'], supabase);

    // Should only fetch once despite three duplicates
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('caches freshly fetched genres back to the database', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const id = url.split('/').pop();
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id, genres: ['soul'] }),
      });
    }));

    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
        upsert: upsertMock,
      }),
    };

    await getArtistGenresWithCache(TOKEN, ['new-artist'], supabase);

    expect(upsertMock).toHaveBeenCalledOnce();
    const upsertArg = upsertMock.mock.calls[0][0] as { spotify_artist_id: string; genres: string[] }[];
    expect(upsertArg[0].spotify_artist_id).toBe('new-artist');
    expect(upsertArg[0].genres).toEqual(['soul']);
  });

  it('returns cached genres without Spotify call even for a large cached set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const cachedRows = Array.from({ length: 100 }, (_, i) => ({
      spotify_artist_id: `artist${i}`,
      genres: ['genre'],
    }));
    const supabase = makeSupabaseMock(cachedRows);
    const ids = cachedRows.map(r => r.spotify_artist_id);

    const result = await getArtistGenresWithCache(TOKEN, ids, supabase);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.size).toBe(100);
  });
});
