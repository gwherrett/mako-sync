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
