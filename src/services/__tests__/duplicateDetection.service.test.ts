import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DuplicateDetectionService } from '../duplicateDetection.service';
import { supabase } from '@/integrations/supabase/client';

describe('DuplicateDetectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ---------------------------------------------------------------------------
  // findDuplicates
  // ---------------------------------------------------------------------------
  describe('findDuplicates', () => {
    it('returns grouped duplicates ordered by bitrate DESC', async () => {
      const mockRows = [
        { id: '1', file_path: '/a/track.mp3', title: 'Track', artist: 'Artist', normalized_title: 'track', normalized_artist: 'artist', bitrate: 320, file_size: 10000, audio_format: 'mp3' },
        { id: '2', file_path: '/b/track.mp3', title: 'Track', artist: 'Artist', normalized_title: 'track', normalized_artist: 'artist', bitrate: 128, file_size: 4000, audio_format: 'mp3' },
        { id: '3', file_path: '/c/other.mp3', title: 'Other', artist: 'Artist', normalized_title: 'other', normalized_artist: 'artist', bitrate: 256, file_size: 8000, audio_format: 'mp3' },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: mockRows, error: null })
                  })
                })
              })
            })
          })
        })
      } as any);

      const result = await DuplicateDetectionService.findDuplicates('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].normalized_title).toBe('track');
      expect(result[0].normalized_artist).toBe('artist');
      expect(result[0].tracks).toHaveLength(2);
      // highest bitrate first (order comes from DB query, preserved in insertion order)
      expect(result[0].tracks[0].id).toBe('1');
      expect(result[0].tracks[1].id).toBe('2');
    });

    it('returns empty array when no duplicates exist', async () => {
      const mockRows = [
        { id: '1', file_path: '/a/track.mp3', title: 'Track A', artist: 'Artist', normalized_title: 'track a', normalized_artist: 'artist', bitrate: 320, file_size: 10000, audio_format: 'mp3' },
        { id: '2', file_path: '/b/track.mp3', title: 'Track B', artist: 'Artist', normalized_title: 'track b', normalized_artist: 'artist', bitrate: 256, file_size: 8000, audio_format: 'mp3' },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: mockRows, error: null })
                  })
                })
              })
            })
          })
        })
      } as any);

      const result = await DuplicateDetectionService.findDuplicates('user-1');

      expect(result).toHaveLength(0);
    });

    it('returns empty array when no data returned', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: null, error: null })
                  })
                })
              })
            })
          })
        })
      } as any);

      const result = await DuplicateDetectionService.findDuplicates('user-1');

      expect(result).toHaveLength(0);
    });

    it('throws when DB returns an error', async () => {
      const mockError = { message: 'DB error', code: '500' };

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: null, error: mockError })
                  })
                })
              })
            })
          })
        })
      } as any);

      await expect(DuplicateDetectionService.findDuplicates('user-1')).rejects.toEqual(mockError);
    });

    it('groups duplicates across multiple artists independently', async () => {
      const mockRows = [
        { id: '1', file_path: '/a.mp3', title: 'Song', artist: 'Artist A', normalized_title: 'song', normalized_artist: 'artist a', bitrate: 320, file_size: 10000, audio_format: 'mp3' },
        { id: '2', file_path: '/b.mp3', title: 'Song', artist: 'Artist A', normalized_title: 'song', normalized_artist: 'artist a', bitrate: 128, file_size: 4000, audio_format: 'mp3' },
        { id: '3', file_path: '/c.mp3', title: 'Song', artist: 'Artist B', normalized_title: 'song', normalized_artist: 'artist b', bitrate: 256, file_size: 8000, audio_format: 'mp3' },
        { id: '4', file_path: '/d.mp3', title: 'Song', artist: 'Artist B', normalized_title: 'song', normalized_artist: 'artist b', bitrate: 192, file_size: 6000, audio_format: 'mp3' },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: mockRows, error: null })
                  })
                })
              })
            })
          })
        })
      } as any);

      const result = await DuplicateDetectionService.findDuplicates('user-1');

      expect(result).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // findSpotifyDuplicates
  // ---------------------------------------------------------------------------
  describe('findSpotifyDuplicates', () => {
    function mockSpotifyFromChain(resolvedValue: { data: unknown; error: unknown }) {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue(resolvedValue)
                  })
                })
              })
            })
          })
        })
      } as any);
    }

    it('returns empty array when no duplicates exist (all tracks have unique normalized keys)', async () => {
      const mockRows = [
        { id: 's1', spotify_id: 'sp1', title: 'Song A', artist: 'Artist', album: 'Album', normalized_title: 'song a', normalized_artist: 'artist', added_at: '2024-01-01' },
        { id: 's2', spotify_id: 'sp2', title: 'Song B', artist: 'Artist', album: 'Album', normalized_title: 'song b', normalized_artist: 'artist', added_at: '2024-01-02' },
      ];

      mockSpotifyFromChain({ data: mockRows, error: null });

      const result = await DuplicateDetectionService.findSpotifyDuplicates('user-1');

      expect(result).toHaveLength(0);
    });

    it('groups tracks sharing same normalized_title + normalized_artist', async () => {
      const mockRows = [
        { id: 's1', spotify_id: 'sp1', title: 'Song', artist: 'Artist', album: 'Album 1', normalized_title: 'song', normalized_artist: 'artist', added_at: '2024-01-03' },
        { id: 's2', spotify_id: 'sp2', title: 'Song', artist: 'Artist', album: 'Album 2', normalized_title: 'song', normalized_artist: 'artist', added_at: '2024-01-01' },
      ];

      mockSpotifyFromChain({ data: mockRows, error: null });

      const result = await DuplicateDetectionService.findSpotifyDuplicates('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].normalized_title).toBe('song');
      expect(result[0].normalized_artist).toBe('artist');
      expect(result[0].tracks).toHaveLength(2);
      expect(result[0].tracks[0].id).toBe('s1');
      expect(result[0].tracks[1].id).toBe('s2');
    });

    it('excludes single-track groups (only returns groups with 2+ tracks)', async () => {
      const mockRows = [
        { id: 's1', spotify_id: 'sp1', title: 'Duplicate', artist: 'Artist', album: 'Album', normalized_title: 'duplicate', normalized_artist: 'artist', added_at: '2024-01-02' },
        { id: 's2', spotify_id: 'sp2', title: 'Duplicate', artist: 'Artist', album: 'Album', normalized_title: 'duplicate', normalized_artist: 'artist', added_at: '2024-01-01' },
        { id: 's3', spotify_id: 'sp3', title: 'Unique', artist: 'Artist', album: 'Album', normalized_title: 'unique', normalized_artist: 'artist', added_at: '2024-01-03' },
      ];

      mockSpotifyFromChain({ data: mockRows, error: null });

      const result = await DuplicateDetectionService.findSpotifyDuplicates('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].normalized_title).toBe('duplicate');
      expect(result[0].tracks).toHaveLength(2);
    });

    it('throws when DB returns an error', async () => {
      const mockError = { message: 'Spotify DB error', code: '500' };

      mockSpotifyFromChain({ data: null, error: mockError });

      await expect(DuplicateDetectionService.findSpotifyDuplicates('user-1')).rejects.toEqual(mockError);
    });
  });

  // ---------------------------------------------------------------------------
  // resolveSpotifyDuplicate
  // ---------------------------------------------------------------------------
  describe('resolveSpotifyDuplicate', () => {
    it('throws when keepId appears in deleteIds', async () => {
      await expect(
        DuplicateDetectionService.resolveSpotifyDuplicate('keep-1', ['keep-1', 'del-1'], 'user-1')
      ).rejects.toThrow('keepId must not appear in deleteIds');
    });

    it('returns { removed: 0, errors: [] } without DB calls when deleteIds is empty', async () => {
      const result = await DuplicateDetectionService.resolveSpotifyDuplicate('keep-1', [], 'user-1');

      expect(result).toEqual({ removed: 0, errors: [] });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('calls supabase.functions.invoke with correct spotifyIds', async () => {
      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ id: 'del-1', spotify_id: 'spot-1' }], error: null })
          })
        })
      } as any);

      vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: { removed: 1, errors: [] }, error: null } as any);

      vi.mocked(supabase.from).mockReturnValueOnce({
        delete: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        })
      } as any);

      await DuplicateDetectionService.resolveSpotifyDuplicate('keep-1', ['del-1'], 'user-1');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('spotify-unlike-tracks', {
        body: { spotifyIds: ['spot-1'] },
      });
    });

    it('deletes DB rows when Edge Function reports removed > 0', async () => {
      const deleteEqMock = vi.fn().mockResolvedValue({ error: null });
      const deleteInMock = vi.fn().mockReturnValue({ eq: deleteEqMock });
      const deleteMock = vi.fn().mockReturnValue({ in: deleteInMock });

      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ id: 'del-1', spotify_id: 'spot-1' }], error: null })
          })
        })
      } as any);

      vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: { removed: 1, errors: [] }, error: null } as any);

      vi.mocked(supabase.from).mockReturnValueOnce({
        delete: deleteMock
      } as any);

      const result = await DuplicateDetectionService.resolveSpotifyDuplicate('keep-1', ['del-1'], 'user-1');

      expect(deleteMock).toHaveBeenCalled();
      expect(result).toEqual({ removed: 1, errors: [] });
    });

    it('does NOT delete DB rows when Edge Function returns removed: 0', async () => {
      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ id: 'del-1', spotify_id: 'spot-1' }], error: null })
          })
        })
      } as any);

      vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: { removed: 0, errors: [] }, error: null } as any);

      const result = await DuplicateDetectionService.resolveSpotifyDuplicate('keep-1', ['del-1'], 'user-1');

      // Only one `from` call (for the select); no second call for delete
      expect(supabase.from).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ removed: 0, errors: [] });
    });

    it('includes DB delete error in errors array and does not throw', async () => {
      const deleteError = { message: 'Delete failed', code: '500' };

      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ id: 'del-1', spotify_id: 'spot-1' }], error: null })
          })
        })
      } as any);

      vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: { removed: 1, errors: [] }, error: null } as any);

      vi.mocked(supabase.from).mockReturnValueOnce({
        delete: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: deleteError })
          })
        })
      } as any);

      const result = await DuplicateDetectionService.resolveSpotifyDuplicate('keep-1', ['del-1'], 'user-1');

      expect(result.removed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Delete failed');
    });

    it('throws when the initial select (fetch spotify_ids) fails', async () => {
      const fetchError = { message: 'Fetch failed', code: '500' };

      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: fetchError })
          })
        })
      } as any);

      await expect(
        DuplicateDetectionService.resolveSpotifyDuplicate('keep-1', ['del-1'], 'user-1')
      ).rejects.toEqual(fetchError);
    });
  });

  // ---------------------------------------------------------------------------
  // resolveDuplicate
  // ---------------------------------------------------------------------------
  describe('resolveDuplicate', () => {
    it('deletes the specified IDs', async () => {
      const deleteMock = vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ error: null })
      });

      vi.mocked(supabase.from).mockReturnValue({
        delete: deleteMock
      } as any);

      await DuplicateDetectionService.resolveDuplicate('keep-1', ['delete-1', 'delete-2']);

      expect(supabase.from).toHaveBeenCalledWith('local_mp3s');
      expect(deleteMock).toHaveBeenCalled();
    });

    it('throws if keepId is in deleteIds', async () => {
      await expect(
        DuplicateDetectionService.resolveDuplicate('keep-1', ['keep-1', 'delete-1'])
      ).rejects.toThrow('keepId must not appear in deleteIds');
    });

    it('does nothing when deleteIds is empty', async () => {
      await DuplicateDetectionService.resolveDuplicate('keep-1', []);

      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('throws when DB delete returns an error', async () => {
      const mockError = { message: 'Delete failed', code: '500' };

      vi.mocked(supabase.from).mockReturnValue({
        delete: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ error: mockError })
        })
      } as any);

      await expect(
        DuplicateDetectionService.resolveDuplicate('keep-1', ['delete-1'])
      ).rejects.toEqual(mockError);
    });
  });
});
