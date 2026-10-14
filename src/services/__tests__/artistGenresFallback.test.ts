import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../supabase/functions/spotify-sync-liked/spotify-auth.ts', () => ({
  fetchWithTokenRetry: vi.fn(),
  getValidAccessToken: vi.fn(),
  refreshSpotifyToken: vi.fn(),
  validateVaultSecrets: vi.fn(),
}));

import { fetchArtistGenres } from '../../../supabase/functions/spotify-sync-liked/artist-genres';

describe('fetchArtistGenres (single-artist endpoint)', () => {
  const TOKEN = 'test-access-token';

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a genres map from single-artist responses', async () => {
    const artists = [
      { id: 'artist1', genres: ['rock', 'alternative rock'] },
      { id: 'artist2', genres: ['pop'] },
      { id: 'artist3', genres: [] },
    ];

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const id = url.split('/').pop();
      const artist = artists.find(a => a.id === id);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(artist ?? {}),
      });
    }));

    const { genreMap: result } = await fetchArtistGenres(TOKEN, ['artist1', 'artist2', 'artist3']);

    expect(result.get('artist1')).toEqual(['rock', 'alternative rock']);
    expect(result.get('artist2')).toEqual(['pop']);
    expect(result.get('artist3')).toEqual([]);
    expect(result.size).toBe(3);
  });

  it('calls individual /v1/artists/{id} endpoints, not the batch endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'artist1', genres: ['jazz'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchArtistGenres(TOKEN, ['artist1']);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/\/v1\/artists\/artist1$/);
    expect(calledUrl).not.toContain('?ids=');
  });

  it('passes Authorization header with Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'artist1', genres: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchArtistGenres(TOKEN, ['artist1']);

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect((options.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('respects concurrency cap — never more than 5 in-flight at once', async () => {
    let activeCount = 0;
    let maxActive = 0;

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise(resolve => setTimeout(resolve, 10));
      activeCount--;
      const id = url.split('/').pop();
      return { ok: true, json: () => Promise.resolve({ id, genres: [] }) };
    }));

    const ids = Array.from({ length: 12 }, (_, i) => `artist${i}`);
    await fetchArtistGenres(TOKEN, ids);

    expect(maxActive).toBeLessThanOrEqual(5);
  });

  it('skips artists that return non-auth errors and continues', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const id = url.split('/').pop();
      if (id === 'bad-artist') {
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found', text: () => Promise.resolve('not found') });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id, genres: ['hip-hop'] }),
      });
    }));

    const { genreMap: result } = await fetchArtistGenres(TOKEN, ['good-artist', 'bad-artist']);

    expect(result.get('good-artist')).toEqual(['hip-hop']);
    expect(result.has('bad-artist')).toBe(false);
  });

  it('throws Spotify token invalid on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('Unauthorized'),
    }));

    await expect(fetchArtistGenres(TOKEN, ['artist1'])).rejects.toThrow('Spotify token invalid');
  });

  it('returns empty map when given empty artist list', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { genreMap: result } = await fetchArtistGenres(TOKEN, []);

    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults genres to empty array when response omits genres field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'artist1' /* no genres field */ }),
    }));

    const { genreMap: result } = await fetchArtistGenres(TOKEN, ['artist1']);

    expect(result.get('artist1')).toEqual([]);
  });
});

describe('fetchArtistGenres — deadline and per-window results', () => {
  const TOKEN = 'test-access-token';
  const ids = Array.from({ length: 12 }, (_, i) => `artist${i}`);

  function okFetch(onRequest?: () => void) {
    return vi.fn().mockImplementation((url: string) => {
      onRequest?.();
      const id = url.split('/').pop();
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id, genres: [] }) });
    });
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is complete when no deadline is given', async () => {
    vi.stubGlobal('fetch', okFetch());

    const { genreMap, complete } = await fetchArtistGenres(TOKEN, ['a1', 'a2']);

    expect(complete).toBe(true);
    expect(genreMap.size).toBe(2);
  });

  it('makes no requests when the deadline has already passed', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { genreMap, complete } = await fetchArtistGenres(TOKEN, ['a1', 'a2'], undefined, { deadlineAt: Date.now() - 1 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(complete).toBe(false);
    expect(genreMap.size).toBe(0);
  });

  it('stops before the next window once the deadline passes', async () => {
    // Each request advances the clock 1s, so the deadline passes during the first window
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.stubGlobal('fetch', okFetch(() => { now += 1000; }));

    const { genreMap, complete } = await fetchArtistGenres(TOKEN, ids, undefined, { deadlineAt: now + 2500 });

    expect(complete).toBe(false);
    expect(genreMap.size).toBe(5);
  });

  it('stops instead of waiting out a Retry-After that would pass the deadline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, headers: { get: () => '30' } });
    vi.stubGlobal('fetch', fetchMock);
    const startedAt = Date.now();

    const { genreMap, complete } = await fetchArtistGenres(TOKEN, ['a1'], undefined, { deadlineAt: Date.now() + 5000 });

    expect(complete).toBe(false);
    expect(genreMap.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("hands each window's results to onWindow as it completes", async () => {
    vi.stubGlobal('fetch', okFetch());
    const windows: string[][] = [];

    await fetchArtistGenres(TOKEN, ids, undefined, {
      onWindow: async windowGenres => { windows.push([...windowGenres.keys()]); },
    });

    expect(windows.map(w => w.length)).toEqual([5, 5, 2]);
    expect(windows.flat().sort()).toEqual([...ids].sort());
  });
});
