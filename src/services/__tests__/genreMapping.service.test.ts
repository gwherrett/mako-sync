import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenreMappingService } from '../genreMapping.service';
import { supabase } from '@/integrations/supabase/client';

// Mock console to reduce noise
vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock fetch for exportToCSV
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('GenreMappingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEffectiveMapping', () => {
    it('should return mapped genres from edge function', async () => {
      const mockMappings = [
        { spotify_genre: 'rock', super_genre: 'Rock', is_overridden: false },
        { spotify_genre: 'pop', super_genre: 'Pop', is_overridden: true }
      ];

      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: mockMappings, error: null });
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      } as any);

      const result = await GenreMappingService.getEffectiveMapping();

      expect(result).toEqual(mockMappings);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('genre-mapping', { method: 'GET' });
    });

    it('should throw error when edge function fails', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: null,
        error: { message: 'Edge function error' }
      });

      await expect(GenreMappingService.getEffectiveMapping()).rejects.toThrow('Failed to fetch genre mapping');
    });

    it('should include unmapped genres from user library', async () => {
      const mockMappings = [
        { spotify_genre: 'rock', super_genre: 'Rock', is_overridden: false }
      ];

      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: mockMappings, error: null });
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue({
            data: [{ genre: 'jazz' }, { genre: 'blues' }],
            error: null
          })
        })
      } as any);

      const result = await GenreMappingService.getEffectiveMapping();

      expect(result).toHaveLength(3);
      expect(result).toContainEqual({ spotify_genre: 'jazz', super_genre: null, is_overridden: false });
      expect(result).toContainEqual({ spotify_genre: 'blues', super_genre: null, is_overridden: false });
    });

    it('should handle user genres fetch error gracefully', async () => {
      const mockMappings = [
        { spotify_genre: 'rock', super_genre: 'Rock', is_overridden: false }
      ];

      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: mockMappings, error: null });
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database error' }
          })
        })
      } as any);

      const result = await GenreMappingService.getEffectiveMapping();

      expect(result).toEqual(mockMappings);
    });

    it('should handle null data from edge function', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      } as any);

      const result = await GenreMappingService.getEffectiveMapping();

      expect(result).toEqual([]);
    });

    it('should deduplicate genres already in mapping', async () => {
      const mockMappings = [
        { spotify_genre: 'rock', super_genre: 'Rock', is_overridden: false }
      ];

      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: mockMappings, error: null });
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue({
            data: [{ genre: 'rock' }, { genre: 'jazz' }],
            error: null
          })
        })
      } as any);

      const result = await GenreMappingService.getEffectiveMapping();

      expect(result).toHaveLength(2);
      expect(result.filter(m => m.spotify_genre === 'rock')).toHaveLength(1);
    });
  });

  describe('setOverride', () => {
    it('should set genre override successfully', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: null });

      await expect(GenreMappingService.setOverride('rock', 'Alternative')).resolves.not.toThrow();

      expect(supabase.functions.invoke).toHaveBeenCalledWith('genre-mapping', {
        method: 'POST',
        body: {
          spotify_genre: 'rock',
          super_genre: 'Alternative'
        }
      });
    });

    it('should throw error when setting override fails', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: null,
        error: { message: 'Override failed' }
      });

      await expect(GenreMappingService.setOverride('rock', 'Alternative')).rejects.toThrow('Failed to set override');
    });
  });

  describe('removeOverride', () => {
    it('should remove genre override successfully', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: null });

      await expect(GenreMappingService.removeOverride('rock')).resolves.not.toThrow();

      expect(supabase.functions.invoke).toHaveBeenCalledWith('genre-mapping', {
        method: 'DELETE',
        body: {
          spotify_genre: 'rock'
        }
      });
    });

    it('should throw error when removing override fails', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: null,
        error: { message: 'Remove failed' }
      });

      await expect(GenreMappingService.removeOverride('rock')).rejects.toThrow('Failed to remove override');
    });
  });

  describe('exportToCSV', () => {
    it('should export mapping as CSV blob', async () => {
      const mockSession = {
        access_token: 'test-token'
      };
      const mockBlob = new Blob(['genre,super_genre\nrock,Rock'], { type: 'text/csv' });

      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: mockSession },
        error: null
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob)
      });

      const result = await GenreMappingService.exportToCSV();

      expect(result).toBeInstanceOf(Blob);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('genre-mapping?export=csv'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      );
    });

    it('should throw error when no session exists', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: null },
        error: null
      } as any);

      await expect(GenreMappingService.exportToCSV()).rejects.toThrow('No active session');
    });

    it('should throw error when fetch fails', async () => {
      const mockSession = { access_token: 'test-token' };

      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: mockSession },
        error: null
      } as any);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500
      });

      await expect(GenreMappingService.exportToCSV()).rejects.toThrow('Failed to export mapping');
    });
  });

  describe('exportForMediaMonkey', () => {
    it('requests the JSON export with the session token', async () => {
      const mockBlob = new Blob(['{"version":1,"mappings":[]}'], { type: 'application/json' });

      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob)
      });

      const result = await GenreMappingService.exportForMediaMonkey();

      expect(result).toBe(mockBlob);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('genre-mapping?export=json'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'Authorization': 'Bearer test-token' })
        })
      );
    });

    it('throws when the export fails', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null
      } as any);
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(GenreMappingService.exportForMediaMonkey()).rejects.toThrow('Failed to export mapping');
    });
  });

  describe('setBulkOverrides', () => {
    it('should set multiple overrides in bulk', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: null });

      const overrides = [
        { spotifyGenre: 'rock', superGenre: 'Rock' as const },
        { spotifyGenre: 'pop', superGenre: 'Pop' as const }
      ];

      await expect(GenreMappingService.setBulkOverrides(overrides)).resolves.not.toThrow();

      expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
    });

    it('should handle empty array', async () => {
      await expect(GenreMappingService.setBulkOverrides([])).resolves.not.toThrow();
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('should fail if any override fails', async () => {
      vi.mocked(supabase.functions.invoke)
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'Failed' } });

      const overrides = [
        { spotifyGenre: 'rock', superGenre: 'Rock' as const },
        { spotifyGenre: 'pop', superGenre: 'Pop' as const }
      ];

      await expect(GenreMappingService.setBulkOverrides(overrides)).rejects.toThrow();
    });
  });

  describe('getNoGenreCount', () => {
    it('should return count of tracks with no genre', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({ count: 42, error: null })
            })
          })
        })
      } as any);

      const result = await GenreMappingService.getNoGenreCount();

      expect(result).toBe(42);
    });

    it('should return 0 when count is null', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({ count: null, error: null })
            })
          })
        })
      } as any);

      const result = await GenreMappingService.getNoGenreCount();

      expect(result).toBe(0);
    });

    it('should return 0 on error', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({ count: null, error: { message: 'Error' } })
            })
          })
        })
      } as any);

      const result = await GenreMappingService.getNoGenreCount();

      expect(result).toBe(0);
    });
  });
});
