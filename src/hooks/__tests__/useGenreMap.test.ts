import { describe, it, expect, vi, beforeEach } from 'vitest';

const order = vi.fn();
const range = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ order })),
    })),
  },
}));

import { getGenreMap } from '../useGenreMap';

function page(rows: { spotify_genre: string; super_genre: string }[]) {
  return { then: (fn: (r: unknown) => unknown) => Promise.resolve(fn({ data: rows, error: null })) };
}

describe('getGenreMap', () => {
  beforeEach(() => {
    order.mockReset();
    range.mockReset();
    order.mockReturnValue({ range });
  });

  it('orders by spotify_genre and normalizes keys, keeping that order', async () => {
    range.mockReturnValueOnce(page([
      { spotify_genre: 'Acid House', super_genre: 'House' },
      { spotify_genre: ' disco ', super_genre: 'Disco' },
    ]));

    const map = await getGenreMap();

    expect(order).toHaveBeenCalledWith('spotify_genre');
    expect([...map.entries()]).toEqual([
      ['acid house', 'House'],
      ['disco', 'Disco'],
    ]);
  });

  it('reads past the 1000-row page limit', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({
      spotify_genre: `genre ${String(i).padStart(4, '0')}`,
      super_genre: 'Other',
    }));
    range
      .mockReturnValueOnce(page(first))
      .mockReturnValueOnce(page([{ spotify_genre: 'zouk', super_genre: 'World' }]));

    const map = await getGenreMap();

    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(map.size).toBe(1001);
    expect(map.get('zouk')).toBe('World');
  });

  it('throws when the query fails', async () => {
    range.mockReturnValueOnce({
      then: (fn: (r: unknown) => unknown) =>
        Promise.resolve(fn({ data: null, error: { message: 'boom' } })),
    });

    await expect(getGenreMap()).rejects.toThrow('Failed to fetch genre map: boom');
  });
});
