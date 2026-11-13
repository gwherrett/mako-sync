import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface GenreOverride {
  spotify_genre: string;
  super_genre: string;
}

/**
 * Hook to get user's genre mapping overrides
 */
export const useGenreMappingOverrides = () => {
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  // Bumped by refetch to make the load effect run again
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let ignore = false;
    supabase
      .from('spotify_genre_map_overrides')
      .select('spotify_genre, super_genre')
      .then(({ data, error }) => {
        if (ignore) return;
        if (error) {
          console.error('Error fetching overrides:', error);
          return;
        }

        const overrideMap = new Map<string, string>();
        data?.forEach((override: GenreOverride) => {
          overrideMap.set(override.spotify_genre, override.super_genre);
        });
        setOverrides(overrideMap);
      })
      .then(
        () => {
          if (!ignore) setLoading(false);
        },
        (error: unknown) => {
          console.error('Error fetching overrides:', error);
          if (!ignore) setLoading(false);
        }
      );
    return () => {
      ignore = true;
    };
  }, [reloadCount]);

  const fetchOverrides = () => {
    setReloadCount((n) => n + 1);
  };

  const hasOverride = (spotifyGenre: string): boolean => {
    return overrides.has(spotifyGenre);
  };

  return {
    overrides,
    loading,
    hasOverride,
    refetch: fetchOverrides
  };
};