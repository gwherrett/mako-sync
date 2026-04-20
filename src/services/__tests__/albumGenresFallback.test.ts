import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// spotify-auth.ts uses Deno https:// imports — stub it out so the Node loader
// doesn't try to fetch remote modules. fetchWithTokenRetry is not called in
// these tests (no tokenRefresher is passed), so a no-op stub is sufficient.
vi.mock('../../../supabase/functions/spotify-sync-liked/spotify-auth.ts', () => ({
  fetchWithTokenRetry: vi.fn(),
  getValidAccessToken: vi.fn(),
  refreshSpotifyToken: vi.fn(),
  validateVaultSecrets: vi.fn(),
}));

import { fetchAlbumGenres, cacheAlbumGenres } from '../../../supabase/functions/spotify-sync-liked/album-genres';

describe('fetchAlbumGenres (single-album endpoint)', () => {
  const TOKEN = 'test-access-token';

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a genres map from single-album responses', async () => {
    const albums = [
      { id: 'album1', genres: ['jazz', 'blues'] },
      { id: 'album2', genres: ['classical'] },
      { id: 'album3', genres: [] },
    ];

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const id = url.split('/').pop();
      const album = albums.find(a => a.id === id);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(album ?? {}),
      });
    }));

    const result = await fetchAlbumGenres(TOKEN, ['album1', 'album2', 'album3']);

    expect(result.get('album1')).toEqual(['jazz', 'blues']);
    expect(result.get('album2')).toEqual(['classical']);
    expect(result.get('album3')).toEqual([]);
    expect(result.size).toBe(3);
  });

  it('calls individual /v1/albums/{id} endpoints, not the batch endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'album1', genres: ['rock'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchAlbumGenres(TOKEN, ['album1']);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/\/v1\/albums\/album1$/);
    expect(calledUrl).not.toContain('?ids=');
  });

  it('passes Authorization header with Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'album1', genres: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchAlbumGenres(TOKEN, ['album1']);

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

    const ids = Array.from({ length: 12 }, (_, i) => `album${i}`);
    await fetchAlbumGenres(TOKEN, ids);

    expect(maxActive).toBeLessThanOrEqual(5);
  });

  it('skips albums that return non-auth errors and continues', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const id = url.split('/').pop();
      if (id === 'bad-album') {
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found', text: () => Promise.resolve('not found') });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id, genres: ['pop'] }),
      });
    }));

    const result = await fetchAlbumGenres(TOKEN, ['good-album', 'bad-album']);

    expect(result.get('good-album')).toEqual(['pop']);
    expect(result.has('bad-album')).toBe(false);
  });

  it('throws Spotify token invalid on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('Unauthorized'),
    }));

    await expect(fetchAlbumGenres(TOKEN, ['album1'])).rejects.toThrow('Spotify token invalid');
  });

  it('returns empty map when given empty album list', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAlbumGenres(TOKEN, []);

    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults genres to empty array when response omits genres field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'album1' /* no genres field */ }),
    }));

    const result = await fetchAlbumGenres(TOKEN, ['album1']);

    expect(result.get('album1')).toEqual([]);
  });

  it('logs a warning when all albums return empty genre arrays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'album1', genres: [] }),
    }));

    await fetchAlbumGenres(TOKEN, ['album1']);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('empty genre arrays'));
  });

  it('does not warn when at least one album has genres', async () => {
    const albums = [
      { id: 'album1', genres: ['folk'] },
      { id: 'album2', genres: [] },
    ];

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const id = url.split('/').pop();
      const album = albums.find(a => a.id === id);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(album ?? {}) });
    }));

    await fetchAlbumGenres(TOKEN, ['album1', 'album2']);

    const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
    const emptyArrayWarn = warnCalls.find((args: unknown[]) =>
      typeof args[0] === 'string' && args[0].includes('empty genre arrays')
    );
    expect(emptyArrayWarn).toBeUndefined();
  });
});

describe('cacheAlbumGenres (empty-genres safeguard)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips DB write when all genres are empty and logs a warning', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const supabaseClient = {
      from: () => ({ upsert: upsertMock }),
    };

    const genreMap = new Map([['album1', [] as string[]], ['album2', [] as string[]]]);
    await cacheAlbumGenres(genreMap, supabaseClient);

    expect(upsertMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping album genre cache write'));
  });

  it('writes to DB when at least one album has genres', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const supabaseClient = {
      from: () => ({ upsert: upsertMock }),
    };

    const genreMap = new Map([['album1', ['rock']], ['album2', [] as string[]]]);
    await cacheAlbumGenres(genreMap, supabaseClient);

    expect(upsertMock).toHaveBeenCalledOnce();
  });

  it('does nothing when given an empty map', async () => {
    const upsertMock = vi.fn();
    const supabaseClient = {
      from: () => ({ upsert: upsertMock }),
    };

    await cacheAlbumGenres(new Map(), supabaseClient);

    expect(upsertMock).not.toHaveBeenCalled();
  });
});
