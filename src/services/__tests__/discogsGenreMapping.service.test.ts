import { describe, it, expect, vi } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { DiscogsGenreMappingService } from '../discogsGenreMapping.service';

const invoke = vi.mocked(supabase.functions.invoke);

describe('DiscogsGenreMappingService', () => {
  describe('getEffectiveMapping', () => {
    it('returns the mapping rows from the edge function', async () => {
      const rows = [
        { discogs_term: 'Deep House', term_type: 'style', super_genre: 'House', is_overridden: false },
      ];
      invoke.mockResolvedValue({ data: rows, error: null });

      await expect(DiscogsGenreMappingService.getEffectiveMapping()).resolves.toEqual(rows);
      expect(invoke).toHaveBeenCalledWith('discogs-genre-mapping', { method: 'GET' });
    });

    it('returns an empty list when the function returns no data', async () => {
      invoke.mockResolvedValue({ data: null, error: null });

      await expect(DiscogsGenreMappingService.getEffectiveMapping()).resolves.toEqual([]);
    });

    it('throws with the function error message', async () => {
      invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });

      await expect(DiscogsGenreMappingService.getEffectiveMapping())
        .rejects.toThrow('Failed to fetch Discogs mapping: boom');
    });
  });

  describe('setOverride', () => {
    it('posts the term and SuperGenre', async () => {
      invoke.mockResolvedValue({ data: null, error: null });

      await DiscogsGenreMappingService.setOverride('Deep House', 'House');

      expect(invoke).toHaveBeenCalledWith('discogs-genre-mapping', {
        method: 'POST',
        body: { discogs_term: 'Deep House', super_genre: 'House' },
      });
    });

    it('throws with the function error message', async () => {
      invoke.mockResolvedValue({ data: null, error: { message: 'denied' } });

      await expect(DiscogsGenreMappingService.setOverride('Deep House', 'House'))
        .rejects.toThrow('Failed to set override: denied');
    });
  });

  describe('removeOverride', () => {
    it('sends a DELETE for the term', async () => {
      invoke.mockResolvedValue({ data: null, error: null });

      await DiscogsGenreMappingService.removeOverride('Deep House');

      expect(invoke).toHaveBeenCalledWith('discogs-genre-mapping', {
        method: 'DELETE',
        body: { discogs_term: 'Deep House' },
      });
    });

    it('throws with the function error message', async () => {
      invoke.mockResolvedValue({ data: null, error: { message: 'missing' } });

      await expect(DiscogsGenreMappingService.removeOverride('Deep House'))
        .rejects.toThrow('Failed to remove override: missing');
    });
  });

  describe('recomputeAll', () => {
    it('posts the recompute_all action', async () => {
      invoke.mockResolvedValue({ data: null, error: null });

      await DiscogsGenreMappingService.recomputeAll();

      expect(invoke).toHaveBeenCalledWith('discogs-genre-mapping', {
        method: 'POST',
        body: { action: 'recompute_all' },
      });
    });

    it('throws with the function error message', async () => {
      invoke.mockResolvedValue({ data: null, error: { message: 'timeout' } });

      await expect(DiscogsGenreMappingService.recomputeAll())
        .rejects.toThrow('Failed to recompute: timeout');
    });
  });
});
