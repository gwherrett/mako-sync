import { supabase } from '@/integrations/supabase/client';
import type { SuperGenre } from '@/types/genreMapping';

export interface DiscogsTermMapping {
  discogs_term: string;
  term_type: 'genre' | 'style';
  super_genre: SuperGenre | null;
  is_overridden: boolean;
}

export class DiscogsGenreMappingService {
  static async getEffectiveMapping(): Promise<DiscogsTermMapping[]> {
    const { data, error } = await supabase.functions.invoke('discogs-genre-mapping', {
      method: 'GET'
    });

    if (error) throw new Error(`Failed to fetch Discogs mapping: ${error.message}`);
    return data || [];
  }

  static async setOverride(discogsTerm: string, superGenre: SuperGenre): Promise<void> {
    const { error } = await supabase.functions.invoke('discogs-genre-mapping', {
      method: 'POST',
      body: { discogs_term: discogsTerm, super_genre: superGenre }
    });

    if (error) throw new Error(`Failed to set override: ${error.message}`);
  }

  static async removeOverride(discogsTerm: string): Promise<void> {
    const { error } = await supabase.functions.invoke('discogs-genre-mapping', {
      method: 'DELETE',
      body: { discogs_term: discogsTerm }
    });

    if (error) throw new Error(`Failed to remove override: ${error.message}`);
  }

  static async recomputeAll(): Promise<void> {
    const { error } = await supabase.functions.invoke('discogs-genre-mapping', {
      method: 'POST',
      body: { action: 'recompute_all' }
    });

    if (error) throw new Error(`Failed to recompute: ${error.message}`);
  }
}
