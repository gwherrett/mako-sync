import { supabase } from '@/integrations/supabase/client';
import type { GenreMapping, SuperGenre } from '@/types/genreMapping';

export class GenreMappingService {
  /**
   * Get effective genre mapping for current user (base + overrides)
   */
  static async getEffectiveMapping(): Promise<GenreMapping[]> {
    const { data, error } = await supabase.functions.invoke('genre-mapping', {
      method: 'GET'
    });

    if (error) {
      throw new Error(`Failed to fetch genre mapping: ${error.message}`);
    }

    // Get the mapped genres
    const mappedGenres: GenreMapping[] = data || [];

    // Also fetch genres from user's liked songs that aren't in the mapping
    const { data: userGenres, error: userGenresError } = await supabase
      .from('spotify_liked')
      .select('genre')
      .not('genre', 'is', null);

    if (userGenresError) {
      console.error('Error fetching user genres:', userGenresError);
      return mappedGenres; // Return just the mapped genres if we can't fetch user genres
    }

    // Get unique genres from user's library
    const uniqueUserGenres = [...new Set(userGenres.map(item => item.genre))];
    const mappedGenreNames = new Set(mappedGenres.map(m => m.spotify_genre));

    // Find genres that exist in user's library but not in the mapping
    const unmappedGenres: GenreMapping[] = uniqueUserGenres
      .filter(genre => !mappedGenreNames.has(genre))
      .map(genre => ({
        spotify_genre: genre,
        super_genre: null,
        is_overridden: false
      }));

    // Combine mapped and unmapped genres
    return [...mappedGenres, ...unmappedGenres];
  }

  /**
   * Set user override for a Spotify genre
   */
  static async setOverride(spotifyGenre: string, superGenre: SuperGenre): Promise<void> {
    const { error } = await supabase.functions.invoke('genre-mapping', {
      method: 'POST',
      body: {
        spotify_genre: spotifyGenre,
        super_genre: superGenre
      }
    });

    if (error) {
      throw new Error(`Failed to set override: ${error.message}`);
    }
  }

  /**
   * Remove user override for a Spotify genre
   */
  static async removeOverride(spotifyGenre: string): Promise<void> {
    const { error } = await supabase.functions.invoke('genre-mapping', {
      method: 'DELETE',
      body: {
        spotify_genre: spotifyGenre
      }
    });

    if (error) {
      throw new Error(`Failed to remove override: ${error.message}`);
    }
  }

  /**
   * Export effective mapping as CSV
   */
  static async exportToCSV(): Promise<Blob> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('No active session');
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const response = await fetch(`${supabaseUrl}/functions/v1/genre-mapping?export=csv`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': supabaseAnonKey
      }
    });

    if (!response.ok) {
      throw new Error('Failed to export mapping');
    }

    return response.blob();
  }

  /**
   * Set multiple overrides in bulk
   */
  static async setBulkOverrides(overrides: Array<{ spotifyGenre: string; superGenre: SuperGenre }>): Promise<void> {
    const promises = overrides.map(({ spotifyGenre, superGenre }) => 
      this.setOverride(spotifyGenre, superGenre)
    );

    await Promise.all(promises);
  }

  /**
   * Get count of tracks with no Spotify genre AND no manually assigned super_genre
   */
  static async getNoGenreCount(signal?: AbortSignal): Promise<number> {
    let query = supabase
      .from('spotify_liked')
      .select('*', { count: 'exact' })
      .is('genre', null)
      .is('super_genre', null)
      .range(0, 0);

    if (signal) {
      query = query.abortSignal(signal);
    }

    const { count, error } = await query;

    if (error) {
      console.error('Error fetching no-genre count:', error);
      return 0;
    }

    return count || 0;
  }
}