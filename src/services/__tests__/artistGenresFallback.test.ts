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

    const result = await fetchArtistGenres(TOKEN, ['artist1', 'artist2', 'artist3']);

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

    const result = await fetchArtistGenres(TOKEN, ['good-artist', 'bad-artist']);

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

    const result = await fetchArtistGenres(TOKEN, []);

    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults genres to empty array when response omits genres field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'artist1' /* no genres field */ }),
    }));

    const result = await fetchArtistGenres(TOKEN, ['artist1']);

    expect(result.get('artist1')).toEqual([]);
  });
});
