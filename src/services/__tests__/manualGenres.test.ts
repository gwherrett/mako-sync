import { describe, it, expect, vi } from 'vitest';

import {
  applyManualGenres,
  loadManualGenreMap,
} from '../../../supabase/functions/spotify-sync-liked/manual-genres';

type Row = { spotify_id: string; super_genre: string | null };

/** Minimal chainable stand-in for the Supabase query builder used by loadManualGenreMap. */
function makeClient(rows: Row[], error: { message: string } | null = null) {
  const inCalls: string[][] = [];
  const client = {
    from: vi.fn(() => {
      let ids: string[] = [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: (_col: string, values: string[]) => {
          ids = values;
          inCalls.push(values);
          return builder;
        },
        then: (resolve: (r: unknown) => unknown) =>
          resolve(
            error
              ? { data: null, error }
              : { data: rows.filter(r => ids.includes(r.spotify_id)), error: null },
          ),
      };
      return builder;
    }),
  };
  return { client, inCalls };
}

describe('loadManualGenreMap', () => {
  it('maps overridden tracks to their manual super_genre and skips null genres', async () => {
    const { client } = makeClient([
      { spotify_id: 'a', super_genre: 'House' },
      { spotify_id: 'b', super_genre: null },
    ]);

    const map = await loadManualGenreMap(client, 'user-1', ['a', 'b', 'c']);

    expect(Object.fromEntries(map)).toEqual({ a: 'House' });
  });

  it('splits large id lists into batches of 100', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const { client, inCalls } = makeClient([{ spotify_id: 'id-249', super_genre: 'Jazz' }]);

    const map = await loadManualGenreMap(client, 'user-1', ids);

    expect(inCalls.map(c => c.length)).toEqual([100, 100, 50]);
    expect(map.get('id-249')).toBe('Jazz');
  });

  it('throws on a query error instead of letting the upsert overwrite overrides', async () => {
    const { client } = makeClient([], { message: 'boom' });

    await expect(loadManualGenreMap(client, 'user-1', ['a'])).rejects.toThrow(
      'Failed to load manual genre overrides: boom',
    );
  });

  it('makes no queries for an empty batch', async () => {
    const { client } = makeClient([]);

    const map = await loadManualGenreMap(client, 'user-1', []);

    expect(map.size).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('applyManualGenres', () => {
  it('replaces the auto-mapped genre and pins the override flag only for overridden tracks', () => {
    const songs = [
      { spotify_id: 'a', super_genre: 'Pop', super_genre_manual_override: false },
      { spotify_id: 'b', super_genre: 'Rock', super_genre_manual_override: false },
    ];

    const result = applyManualGenres(songs, new Map([['a', 'House']]));

    expect(result).toEqual([
      { spotify_id: 'a', super_genre: 'House', super_genre_manual_override: true },
      { spotify_id: 'b', super_genre: 'Rock', super_genre_manual_override: false },
    ]);
  });
});
