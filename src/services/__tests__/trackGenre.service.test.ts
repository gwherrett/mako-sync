import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackGenreService } from '../trackGenre.service';
import { supabase } from '@/integrations/supabase/client';

describe('TrackGenreService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('getTracksWithoutGenre', () => {
    it('should fetch tracks with no genre assigned', async () => {
      const mockTracks = [
        { id: '1', title: 'Track 1', artist: 'Artist 1', album: 'Album 1', spotify_id: 'sp1', year: 2020 },
        { id: '2', title: 'Track 2', artist: 'Artist 2', album: 'Album 2', spotify_id: 'sp2', year: 2021 },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: mockTracks, error: null })
              })
            })
          })
        })
      } as any);

      const result = await TrackGenreService.getTracksWithoutGenre();

      expect(result).toEqual(mockTracks);
      expect(supabase.from).toHaveBeenCalledWith('spotify_liked');
    });

    it('should return empty array when no tracks found', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: null, error: null })
              })
            })
          })
        })
      } as any);

      const result = await TrackGenreService.getTracksWithoutGenre();

      expect(result).toEqual([]);
    });

    it('should throw error when fetch fails', async () => {
      const mockError = { message: 'Database error', code: '500' };

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: null, error: mockError })
              })
            })
          })
        })
      } as any);

      await expect(TrackGenreService.getTracksWithoutGenre()).rejects.toEqual(mockError);
    });
  });

  describe('getAllTracksWithoutSpotifyGenre', () => {
    it('should fetch all tracks without Spotify genre including those with super_genre', async () => {
      const mockTracks = [
        { id: '1', title: 'Track 1', artist: 'Artist 1', album: 'Album 1', spotify_id: 'sp1', year: 2020, super_genre: 'Rock' },
        { id: '2', title: 'Track 2', artist: 'Artist 2', album: null, spotify_id: 'sp2', year: null, super_genre: null },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockTracks, error: null })
            })
          })
        })
      } as any);

      const result = await TrackGenreService.getAllTracksWithoutSpotifyGenre();

      expect(result).toEqual(mockTracks);
    });

    it('should return empty array when no tracks found', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      } as any);

      const result = await TrackGenreService.getAllTracksWithoutSpotifyGenre();

      expect(result).toEqual([]);
    });

    it('should throw error when fetch fails', async () => {
      const mockError = { message: 'Query failed' };

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: null, error: mockError })
            })
          })
        })
      } as any);

      await expect(TrackGenreService.getAllTracksWithoutSpotifyGenre()).rejects.toEqual(mockError);
    });
  });

  describe('buildLibraryContext', () => {
    it('should build context with artist tracks and library patterns', async () => {
      const artistTracks = [
        { title: 'Song 1', super_genre: 'Rock' },
        { title: 'Song 2', super_genre: 'Rock' },
      ];
      const genreStats = [
        { super_genre: 'Rock' },
        { super_genre: 'Pop' },
        { super_genre: 'Jazz' },
        { super_genre: 'Rock' },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({ data: artistTracks, error: null })
            }),
            not: vi.fn().mockResolvedValue({ data: genreStats, error: null })
          })
        } as any;
      });

      const result = await TrackGenreService.buildLibraryContext('Artist Name');

      expect(result.sameArtistTracks).toEqual(artistTracks);
      expect(result.libraryPatterns).toContain('4 tracks');
      expect(result.libraryPatterns).toContain('Jazz');
      expect(result.libraryPatterns).toContain('Pop');
      expect(result.libraryPatterns).toContain('Rock');
    });

    it('should handle empty genre stats', async () => {
      vi.mocked(supabase.from).mockImplementation(() => {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({ data: [], error: null })
            }),
            not: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        } as any;
      });

      const result = await TrackGenreService.buildLibraryContext('Unknown Artist');

      expect(result.sameArtistTracks).toEqual([]);
      expect(result.libraryPatterns).toBe('');
    });

    it('should handle null super_genre values in stats', async () => {
      const genreStats = [
        { super_genre: 'Rock' },
        { super_genre: null },
        { super_genre: 'Pop' },
      ];

      vi.mocked(supabase.from).mockImplementation(() => {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({ data: [], error: null })
            }),
            not: vi.fn().mockResolvedValue({ data: genreStats, error: null })
          })
        } as any;
      });

      const result = await TrackGenreService.buildLibraryContext('Artist');

      expect(result.libraryPatterns).toContain('Pop');
      expect(result.libraryPatterns).toContain('Rock');
    });
  });

  describe('suggestGenreForTrack', () => {
    it('should call AI function and return suggestion', async () => {
      const mockSuggestion = {
        suggestedGenre: 'Rock',
        confidence: 0.85,
        reasoning: 'Based on artist history'
      };

      vi.mocked(supabase.from).mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ data: [], error: null })
          }),
          not: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      } as any));

      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: mockSuggestion,
        error: null
      } as any);

      const result = await TrackGenreService.suggestGenreForTrack(
        'track-1',
        'Song Title',
        'Artist Name',
        'Album Name',
        2020
      );

      expect(result).toEqual(mockSuggestion);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('ai-track-genre-suggest', expect.any(Object));
    });

    it('should handle optional album and year', async () => {
      const mockSuggestion = { suggestedGenre: 'Pop', confidence: 0.7, reasoning: 'Test' };

      vi.mocked(supabase.from).mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ data: [], error: null })
          }),
          not: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      } as any));

      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: mockSuggestion,
        error: null
      } as any);

      const result = await TrackGenreService.suggestGenreForTrack(
        'track-1',
        'Song Title',
        'Artist Name',
        null,
        null
      );

      expect(result).toEqual(mockSuggestion);
    });

    it('should throw error when AI function fails', async () => {
      const mockError = { message: 'AI service unavailable' };

      vi.mocked(supabase.from).mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ data: [], error: null })
          }),
          not: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      } as any));

      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: null,
        error: mockError
      } as any);

      await expect(
        TrackGenreService.suggestGenreForTrack('track-1', 'Title', 'Artist')
      ).rejects.toEqual(mockError);
    });
  });

  describe('assignGenreToTrack', () => {
    it('should update track with genre', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null })
        })
      } as any);

      await TrackGenreService.assignGenreToTrack('track-123', 'Rock');

      expect(supabase.from).toHaveBeenCalledWith('spotify_liked');
    });

    it('should throw error when update fails', async () => {
      const mockError = { message: 'Update failed' };

      vi.mocked(supabase.from).mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: mockError })
        })
      } as any);

      await expect(
        TrackGenreService.assignGenreToTrack('track-123', 'Rock')
      ).rejects.toEqual(mockError);
    });
  });

  describe('getTracksWithoutGenreCount', () => {
    it('should return count of tracks without genre', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({ count: 42, error: null })
            })
          })
        })
      } as any);

      const result = await TrackGenreService.getTracksWithoutGenreCount();

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

      const result = await TrackGenreService.getTracksWithoutGenreCount();

      expect(result).toBe(0);
    });

    it('should throw error when count fails', async () => {
      const mockError = { message: 'Count failed' };

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({ count: null, error: mockError })
            })
          })
        })
      } as any);

      await expect(TrackGenreService.getTracksWithoutGenreCount()).rejects.toEqual(mockError);
    });
  });

  describe('getTracksGroupedByArtist', () => {
    it('should group tracks by artist', async () => {
      const mockTracks = [
        { id: '1', title: 'Track 1', artist: 'Artist A', album: 'Album', spotify_id: 'sp1', year: 2020 },
        { id: '2', title: 'Track 2', artist: 'Artist A', album: 'Album', spotify_id: 'sp2', year: 2020 },
        { id: '3', title: 'Track 3', artist: 'Artist B', album: 'Album', spotify_id: 'sp3', year: 2021 },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: mockTracks, error: null })
              })
            })
          })
        })
      } as any);

      const result = await TrackGenreService.getTracksGroupedByArtist();

      expect(result.size).toBe(2);
      expect(result.get('Artist A')).toHaveLength(2);
      expect(result.get('Artist B')).toHaveLength(1);
    });

    it('should return empty map when no tracks', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            })
          })
        })
      } as any);

      const result = await TrackGenreService.getTracksGroupedByArtist();

      expect(result.size).toBe(0);
    });
  });

  describe('suggestGenreForArtist', () => {
    it('should call AI function with artist info and sample tracks', async () => {
      const mockSuggestion = {
        suggestedGenre: 'Electronic',
        confidence: 0.9,
        reasoning: 'Artist is known for electronic music'
      };
      const sampleTracks = [
        { title: 'Track 1', album: 'Album 1', year: 2020 },
        { title: 'Track 2', album: 'Album 2', year: 2021 },
      ];

      vi.mocked(supabase.from).mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ data: [], error: null })
          }),
          not: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      } as any));

      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: mockSuggestion,
        error: null
      } as any);

      const result = await TrackGenreService.suggestGenreForArtist('Artist Name', sampleTracks, 10);

      expect(result).toEqual(mockSuggestion);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('ai-track-genre-suggest', {
        body: expect.objectContaining({
          artist: 'Artist Name',
          sampleTracks,
          trackCount: 10
        })
      });
    });

    it('should throw error when AI function fails', async () => {
      const mockError = { message: 'Service error' };

      vi.mocked(supabase.from).mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ data: [], error: null })
          }),
          not: vi.fn().mockResolvedValue({ data: [], error: null })
        })
      } as any));

      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: null,
        error: mockError
      } as any);

      await expect(
        TrackGenreService.suggestGenreForArtist('Artist', [], 0)
      ).rejects.toEqual(mockError);
    });
  });

  describe('assignGenreToMultipleTracks', () => {
    it('should update multiple tracks with genre', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        update: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: null, error: null })
        })
      } as any);

      await TrackGenreService.assignGenreToMultipleTracks(['id1', 'id2', 'id3'], 'Jazz');

      expect(supabase.from).toHaveBeenCalledWith('spotify_liked');
    });

    it('should throw error when bulk update fails', async () => {
      const mockError = { message: 'Bulk update failed' };

      vi.mocked(supabase.from).mockReturnValue({
        update: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: null, error: mockError })
        })
      } as any);

      await expect(
        TrackGenreService.assignGenreToMultipleTracks(['id1', 'id2'], 'Pop')
      ).rejects.toEqual(mockError);
    });
  });
});
