import { supabase } from '@/integrations/supabase/client';
import type { SuperGenre } from '@/types/genreMapping';

interface TrackWithoutGenre {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  spotify_id: string;
  year: number | null;
}

interface TrackWithGenre extends TrackWithoutGenre {
  super_genre: string | null;
}

interface LibraryContext {
  sameArtistTracks: Array<{
    title: string;
    super_genre: string | null;
  }>;
  libraryPatterns: string;
}

interface GenreSuggestion {
  suggestedGenre: SuperGenre;
  confidence: number;
  reasoning: string;
}

export class TrackGenreService {
  /**
   * Get all tracks that have no Spotify genre assigned (but may have super_genre)
   */
  static async getTracksWithoutGenre(): Promise<TrackWithoutGenre[]> {
    const { data, error } = await supabase
      .from('spotify_liked')
      .select('id, title, artist, album, spotify_id, year')
      .is('genre', null)
      .is('super_genre', null)
      .order('artist', { ascending: true })
      .order('title', { ascending: true });

    if (error) {
      console.error('Error fetching tracks without genre:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Get ALL tracks where Spotify didn't provide genre (includes those with super_genre assigned)
   */
  static async getAllTracksWithoutSpotifyGenre(): Promise<TrackWithGenre[]> {
    const { data, error } = await supabase
      .from('spotify_liked')
      .select('id, title, artist, album, spotify_id, year, super_genre')
      .is('genre', null)
      .order('artist', { ascending: true })
      .order('title', { ascending: true });

    if (error) {
      console.error('Error fetching all tracks without Spotify genre:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Build library context for a specific artist
   */
  static async buildLibraryContext(artist: string): Promise<LibraryContext> {
    // Get other tracks by the same artist
    const { data: artistTracks } = await supabase
      .from('spotify_liked')
      .select('title, super_genre')
      .eq('artist', artist)
      .not('super_genre', 'is', null);

    // Get overall library patterns - show which genres exist (not counts)
    const { data: genreStats } = await supabase
      .from('spotify_liked')
      .select('super_genre')
      .not('super_genre', 'is', null);

    let libraryPatterns = '';
    if (genreStats && genreStats.length > 0) {
      const uniqueGenres = new Set<string>();
      genreStats.forEach(track => {
        if (track.super_genre) {
          uniqueGenres.add(track.super_genre);
        }
      });
      
      const genreList = Array.from(uniqueGenres).sort().join(', ');
      libraryPatterns = `User's library has ${genreStats.length} tracks with genres. Genres present in library: ${genreList}`;
    }

    return {
      sameArtistTracks: artistTracks || [],
      libraryPatterns
    };
  }

  /**
   * Get AI suggestion for a track's genre
   */
  static async suggestGenreForTrack(
    trackId: string,
    title: string,
    artist: string,
    album?: string | null,
    year?: number | null
  ): Promise<GenreSuggestion> {
    const libraryContext = await this.buildLibraryContext(artist);

    const { data, error } = await supabase.functions.invoke('ai-track-genre-suggest', {
      body: {
        title,
        artist,
        album: album || undefined,
        year: year || undefined,
        libraryContext
      }
    });

    if (error) {
      console.error('Error getting AI suggestion:', error);
      throw error;
    }

    return data as GenreSuggestion;
  }

  /**
   * Assign a super genre directly to a track and pin it against sync overwrites.
   */
  static async assignGenreToTrack(trackId: string, superGenre: SuperGenre): Promise<void> {
    const { error } = await supabase
      .from('spotify_liked')
      .update({ super_genre: superGenre, super_genre_manual_override: true })
      .eq('id', trackId);

    if (error) {
      console.error('Error assigning genre to track:', error);
      throw error;
    }
  }

  /**
   * Clear the manual override flag so the sync pipeline can re-derive super_genre.
   */
  static async resetGenreOverride(trackId: string): Promise<void> {
    const { error } = await supabase
      .from('spotify_liked')
      .update({ super_genre_manual_override: false })
      .eq('id', trackId);

    if (error) {
      console.error('Error resetting genre override:', error);
      throw error;
    }
  }

  /**
   * Get count of tracks without genre
   */
  static async getTracksWithoutGenreCount(): Promise<number> {
    const { count, error } = await supabase
      .from('spotify_liked')
      .select('*', { count: 'exact' })
      .is('genre', null)
      .is('super_genre', null)
      .range(0, 0);

    if (error) {
      console.error('Error counting tracks without genre:', error);
      throw error;
    }

    return count || 0;
  }

  /**
   * Get tracks without genre grouped by artist
   */
  static async getTracksGroupedByArtist(): Promise<Map<string, TrackWithoutGenre[]>> {
    const tracks = await this.getTracksWithoutGenre();
    
    const grouped = new Map<string, TrackWithoutGenre[]>();
    tracks.forEach(track => {
      if (!grouped.has(track.artist)) {
        grouped.set(track.artist, []);
      }
      grouped.get(track.artist)!.push(track);
    });

    return grouped;
  }

  /**
   * Get AI suggestion for an artist (applies to all their tracks)
   */
  static async suggestGenreForArtist(
    artist: string,
    sampleTracks: Array<{ title: string; album?: string | null; year?: number | null }>,
    trackCount: number
  ): Promise<GenreSuggestion> {
    const libraryContext = await this.buildLibraryContext(artist);

    const { data, error } = await supabase.functions.invoke('ai-track-genre-suggest', {
      body: {
        artist,
        sampleTracks,
        trackCount,
        libraryContext
      }
    });

    if (error) {
      console.error('Error getting AI suggestion for artist:', error);
      throw error;
    }

    return data as GenreSuggestion;
  }

  /**
   * Assign genre to multiple tracks at once
   */
  static async assignGenreToMultipleTracks(trackIds: string[], superGenre: SuperGenre): Promise<void> {
    const { error } = await supabase
      .from('spotify_liked')
      .update({ super_genre: superGenre })
      .in('id', trackIds);

    if (error) {
      console.error('Error assigning genre to multiple tracks:', error);
      throw error;
    }
  }
}
