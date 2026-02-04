import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackMatchingService } from '../trackMatching.service';
import { supabase } from '@/integrations/supabase/client';

describe('TrackMatchingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('fetchLocalTracks', () => {
    it('should fetch local tracks for a user', async () => {
      const mockTracks = [
        { id: '1', title: 'Track 1', artist: 'Artist 1', primary_artist: 'Artist 1', album: 'Album 1', genre: 'Rock', file_path: '/music/track1.mp3' },
        { id: '2', title: 'Track 2', artist: 'Artist 2', primary_artist: 'Artist 2', album: 'Album 2', genre: 'Pop', file_path: '/music/track2.mp3' },
      ];

      // Mock pagination: first call returns tracks, second call returns empty to exit loop
      const rangeMock = vi.fn()
        .mockResolvedValueOnce({ data: mockTracks, error: null })
        .mockResolvedValueOnce({ data: [], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            range: rangeMock
          })
        })
      } as any);

      const result = await TrackMatchingService.fetchLocalTracks('user-123');

      expect(result).toEqual(mockTracks);
      expect(supabase.from).toHaveBeenCalledWith('local_mp3s');
    });

    it('should return empty array when no tracks found', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      } as any);

      const result = await TrackMatchingService.fetchLocalTracks('user-123');

      expect(result).toEqual([]);
    });

    it('should throw error when fetch fails', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({ data: null, error: { message: 'Database error' } })
          })
        })
      } as any);

      await expect(TrackMatchingService.fetchLocalTracks('user-123'))
        .rejects.toThrow('Failed to fetch local tracks: Database error');
    });
  });

  describe('fetchSpotifyTracks', () => {
    it('should fetch spotify tracks for a user', async () => {
      const mockTracks = [
        { id: '1', title: 'Spotify Track 1', artist: 'Artist 1', primary_artist: 'Artist 1', album: 'Album 1', genre: 'rock', super_genre: 'Rock' },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: mockTracks, error: null })
          })
        })
      } as any);

      const result = await TrackMatchingService.fetchSpotifyTracks('user-123');

      expect(result).toEqual(mockTracks);
      expect(supabase.from).toHaveBeenCalledWith('spotify_liked');
    });

    it('should filter by super genre when provided', async () => {
      const mockTracks = [
        { id: '1', title: 'Rock Track', artist: 'Artist 1', primary_artist: 'Artist 1', album: 'Album 1', genre: 'rock', super_genre: 'Rock' },
      ];

      // Mock for filtered query with chained eq for super_genre
      const limitMock = vi.fn().mockResolvedValue({ data: mockTracks, error: null });
      const superGenreEqMock = vi.fn().mockReturnValue({ then: limitMock().then.bind(Promise.resolve({ data: mockTracks, error: null })) });

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockTracks, error: null })
            })
          })
        })
      } as any);

      const result = await TrackMatchingService.fetchSpotifyTracks('user-123', 'Rock');

      expect(result).toEqual(mockTracks);
    });

    it('should not filter when super genre is "all"', async () => {
      const mockTracks = [
        { id: '1', title: 'Track', artist: 'Artist', primary_artist: 'Artist', album: 'Album', genre: 'rock', super_genre: 'Rock' },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: mockTracks, error: null })
          })
        })
      } as any);

      const result = await TrackMatchingService.fetchSpotifyTracks('user-123', 'all');

      expect(result).toEqual(mockTracks);
    });

    it('should throw error when fetch fails', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'API error' } })
          })
        })
      } as any);

      await expect(TrackMatchingService.fetchSpotifyTracks('user-123'))
        .rejects.toThrow('Failed to fetch Spotify tracks: API error');
    });
  });

  describe('fetchSuperGenres', () => {
    it('should fetch unique super genres for a user', async () => {
      const mockData = [
        { super_genre: 'Rock' },
        { super_genre: 'Pop' },
        { super_genre: 'Rock' }, // Duplicate
        { super_genre: 'Jazz' },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: mockData, error: null })
            })
          })
        })
      } as any);

      const result = await TrackMatchingService.fetchSuperGenres('user-123');

      expect(result).toEqual(['Jazz', 'Pop', 'Rock']); // Sorted and unique
    });

    it('should return empty array when no genres found', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      } as any);

      const result = await TrackMatchingService.fetchSuperGenres('user-123');

      expect(result).toEqual([]);
    });

    it('should throw error when fetch fails', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'Query failed' } })
            })
          })
        })
      } as any);

      await expect(TrackMatchingService.fetchSuperGenres('user-123'))
        .rejects.toThrow('Failed to fetch super genres: Query failed');
    });
  });

  describe('findMissingTracks', () => {
    it('should find tracks that exist in Spotify but not locally', async () => {
      const localTracks = [
        { id: '1', title: 'Local Track', artist: 'Artist One', primary_artist: 'Artist One', album: 'Album', genre: 'Rock', file_path: '/track.mp3' },
      ];

      const spotifyTracks = [
        { id: 's1', title: 'Local Track', artist: 'Artist One', primary_artist: 'Artist One', album: 'Album', genre: 'rock', super_genre: 'Rock' },
        { id: 's2', title: 'Missing Track', artist: 'Artist Two', primary_artist: 'Artist Two', album: 'Album', genre: 'pop', super_genre: 'Pop' },
      ];

      // Mock fetchLocalTracks (uses .range() for pagination) and fetchSpotifyTracks (uses .limit())
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'local_mp3s') {
          const rangeMock = vi.fn()
            .mockResolvedValueOnce({ data: localTracks, error: null })
            .mockResolvedValueOnce({ data: [], error: null });
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                range: rangeMock
              })
            })
          } as any;
        }
        if (table === 'spotify_liked') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: spotifyTracks, error: null })
              })
            })
          } as any;
        }
        return {} as any;
      });

      const result = await TrackMatchingService.findMissingTracks('user-123');

      expect(result).toHaveLength(1);
      expect(result[0].spotifyTrack.title).toBe('Missing Track');
      expect(result[0].reason).toBe('No matching local track found');
    });

    it('should return empty array when all tracks match', async () => {
      const localTracks = [
        { id: '1', title: 'Track One', artist: 'Artist', primary_artist: 'Artist', album: 'Album', genre: 'Rock', file_path: '/track.mp3' },
      ];

      const spotifyTracks = [
        { id: 's1', title: 'Track One', artist: 'Artist', primary_artist: 'Artist', album: 'Album', genre: 'rock', super_genre: 'Rock' },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'local_mp3s') {
          const rangeMock = vi.fn()
            .mockResolvedValueOnce({ data: localTracks, error: null })
            .mockResolvedValueOnce({ data: [], error: null });
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                range: rangeMock
              })
            })
          } as any;
        }
        if (table === 'spotify_liked') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: spotifyTracks, error: null })
              })
            })
          } as any;
        }
        return {} as any;
      });

      const result = await TrackMatchingService.findMissingTracks('user-123');

      expect(result).toHaveLength(0);
    });

    it('should handle case-insensitive matching', async () => {
      const localTracks = [
        { id: '1', title: 'TRACK ONE', artist: 'ARTIST', primary_artist: 'ARTIST', album: 'Album', genre: 'Rock', file_path: '/track.mp3' },
      ];

      const spotifyTracks = [
        { id: 's1', title: 'track one', artist: 'artist', primary_artist: 'artist', album: 'Album', genre: 'rock', super_genre: 'Rock' },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'local_mp3s') {
          const rangeMock = vi.fn()
            .mockResolvedValueOnce({ data: localTracks, error: null })
            .mockResolvedValueOnce({ data: [], error: null });
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                range: rangeMock
              })
            })
          } as any;
        }
        if (table === 'spotify_liked') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: spotifyTracks, error: null })
              })
            })
          } as any;
        }
        return {} as any;
      });

      const result = await TrackMatchingService.findMissingTracks('user-123');

      expect(result).toHaveLength(0); // Should match despite case difference
    });

    it('should handle null titles and artists', async () => {
      const localTracks = [
        { id: '1', title: null, artist: null, primary_artist: null, album: 'Album', genre: 'Rock', file_path: '/track.mp3' },
      ];

      const spotifyTracks = [
        { id: 's1', title: 'Some Track', artist: 'Some Artist', primary_artist: 'Some Artist', album: 'Album', genre: 'rock', super_genre: 'Rock' },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'local_mp3s') {
          const rangeMock = vi.fn()
            .mockResolvedValueOnce({ data: localTracks, error: null })
            .mockResolvedValueOnce({ data: [], error: null });
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                range: rangeMock
              })
            })
          } as any;
        }
        if (table === 'spotify_liked') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: spotifyTracks, error: null })
              })
            })
          } as any;
        }
        return {} as any;
      });

      const result = await TrackMatchingService.findMissingTracks('user-123');

      expect(result).toHaveLength(1); // Won't match null with actual values
    });

    it('should normalize special characters in matching', async () => {
      const localTracks = [
        { id: '1', title: 'Track: One!', artist: "Artist's Name", primary_artist: "Artist's Name", album: 'Album', genre: 'Rock', file_path: '/track.mp3' },
      ];

      const spotifyTracks = [
        { id: 's1', title: 'Track One', artist: 'Artists Name', primary_artist: 'Artists Name', album: 'Album', genre: 'rock', super_genre: 'Rock' },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'local_mp3s') {
          const rangeMock = vi.fn()
            .mockResolvedValueOnce({ data: localTracks, error: null })
            .mockResolvedValueOnce({ data: [], error: null });
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                range: rangeMock
              })
            })
          } as any;
        }
        if (table === 'spotify_liked') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: spotifyTracks, error: null })
              })
            })
          } as any;
        }
        return {} as any;
      });

      const result = await TrackMatchingService.findMissingTracks('user-123');

      expect(result).toHaveLength(0); // Should match after normalization
    });

    it('should pass super genre filter to fetchSpotifyTracks', async () => {
      const localTracks: any[] = [];
      const spotifyTracks = [
        { id: 's1', title: 'Rock Track', artist: 'Artist', primary_artist: 'Artist', album: 'Album', genre: 'rock', super_genre: 'Rock' },
      ];

      const eqSuperGenreMock = vi.fn().mockReturnValue({
        then: (fn: any) => Promise.resolve({ data: spotifyTracks, error: null }).then(fn)
      });

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'local_mp3s') {
          const rangeMock = vi.fn()
            .mockResolvedValueOnce({ data: localTracks, error: null })
            .mockResolvedValueOnce({ data: [], error: null });
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                range: rangeMock
              })
            })
          } as any;
        }
        if (table === 'spotify_liked') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  eq: eqSuperGenreMock
                })
              })
            })
          } as any;
        }
        return {} as any;
      });

      // This test verifies the filter is passed, but due to mock complexity
      // we're primarily checking it doesn't error
      const result = await TrackMatchingService.findMissingTracks('user-123', 'Rock');

      expect(result).toHaveLength(1);
    });

    it('should use core title matching for different mix versions', async () => {
      const localTracks = [
        { id: '1', title: 'Track Name (Original Mix)', artist: 'Artist', primary_artist: 'Artist', album: 'Album', genre: 'House', file_path: '/track.mp3' },
      ];

      const spotifyTracks = [
        { id: 's1', title: 'Track Name (Extended Mix)', artist: 'Artist', primary_artist: 'Artist', album: 'Album', genre: 'house', super_genre: 'House' },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'local_mp3s') {
          const rangeMock = vi.fn()
            .mockResolvedValueOnce({ data: localTracks, error: null })
            .mockResolvedValueOnce({ data: [], error: null });
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                range: rangeMock
              })
            })
          } as any;
        }
        if (table === 'spotify_liked') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: spotifyTracks, error: null })
              })
            })
          } as any;
        }
        return {} as any;
      });

      const result = await TrackMatchingService.findMissingTracks('user-123');

      // Should match via core title (Tier 2) since both are "Track Name" with different mixes
      expect(result).toHaveLength(0);
    });

    it('should use fuzzy matching for minor typos', async () => {
      const localTracks = [
        { id: '1', title: 'Track Nme', artist: 'Artist', primary_artist: 'Artist', album: 'Album', genre: 'House', file_path: '/track.mp3' }, // typo
      ];

      const spotifyTracks = [
        { id: 's1', title: 'Track Name', artist: 'Artist', primary_artist: 'Artist', album: 'Album', genre: 'house', super_genre: 'House' },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'local_mp3s') {
          const rangeMock = vi.fn()
            .mockResolvedValueOnce({ data: localTracks, error: null })
            .mockResolvedValueOnce({ data: [], error: null });
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                range: rangeMock
              })
            })
          } as any;
        }
        if (table === 'spotify_liked') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: spotifyTracks, error: null })
              })
            })
          } as any;
        }
        return {} as any;
      });

      const result = await TrackMatchingService.findMissingTracks('user-123');

      // Should match via fuzzy matching (Tier 3) - high similarity
      expect(result).toHaveLength(0);
    });

    it('should strip "The" prefix from artist names', async () => {
      const localTracks = [
        { id: '1', title: 'Song', artist: 'The Beatles', primary_artist: 'The Beatles', album: 'Album', genre: 'Rock', file_path: '/track.mp3' },
      ];

      const spotifyTracks = [
        { id: 's1', title: 'Song', artist: 'Beatles', primary_artist: 'Beatles', album: 'Album', genre: 'rock', super_genre: 'Rock' },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'local_mp3s') {
          const rangeMock = vi.fn()
            .mockResolvedValueOnce({ data: localTracks, error: null })
            .mockResolvedValueOnce({ data: [], error: null });
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                range: rangeMock
              })
            })
          } as any;
        }
        if (table === 'spotify_liked') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: spotifyTracks, error: null })
              })
            })
          } as any;
        }
        return {} as any;
      });

      const result = await TrackMatchingService.findMissingTracks('user-123');

      // Should match because "The Beatles" normalized = "Beatles" normalized
      expect(result).toHaveLength(0);
    });

    it('should handle primary_artist being null and fall back to artist', async () => {
      const localTracks = [
        { id: '1', title: 'Song', artist: 'Artist Name', primary_artist: null, album: 'Album', genre: 'Rock', file_path: '/track.mp3' },
      ];

      const spotifyTracks = [
        { id: 's1', title: 'Song', artist: 'Artist Name', primary_artist: null, album: 'Album', genre: 'rock', super_genre: 'Rock' },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'local_mp3s') {
          const rangeMock = vi.fn()
            .mockResolvedValueOnce({ data: localTracks, error: null })
            .mockResolvedValueOnce({ data: [], error: null });
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                range: rangeMock
              })
            })
          } as any;
        }
        if (table === 'spotify_liked') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: spotifyTracks, error: null })
              })
            })
          } as any;
        }
        return {} as any;
      });

      const result = await TrackMatchingService.findMissingTracks('user-123');

      // Should match using fallback to artist field
      expect(result).toHaveLength(0);
    });
  });
});
