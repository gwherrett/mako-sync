import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { GenreMappingService } from '@/services/genreMapping.service';
import type { GenreMapping, SuperGenre } from '@/types/genreMapping';
import { useAuth } from '@/contexts/NewAuthContext';

export const useGenreMapping = () => {
  const [mappings, setMappings] = useState<GenreMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by loadMappings to make the load effect run again
  const [reloadCount, setReloadCount] = useState(0);
  const { toast } = useToast();
  const { initialDataReady, dataFetchEnabled } = useAuth();

  useEffect(() => {
    if (!initialDataReady || !dataFetchEnabled) return;
    let ignore = false;
    GenreMappingService.getEffectiveMapping()
      .then((data) => {
        if (!ignore) setMappings(data);
      })
      .catch((err) => {
        if (ignore) return;
        const errorMessage = err instanceof Error ? err.message : 'Failed to load genre mappings';
        setError(errorMessage);
        toast({
          title: 'Error',
          description: errorMessage,
          variant: 'destructive'
        });
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [initialDataReady, dataFetchEnabled, reloadCount, toast]);

  const loadMappings = () => {
    setIsLoading(true);
    setError(null);
    setReloadCount((n) => n + 1);
  };

  const setOverride = async (spotifyGenre: string, superGenre: SuperGenre) => {
    try {
      await GenreMappingService.setOverride(spotifyGenre, superGenre);
      
      // Update local state
      setMappings(prev => prev.map(mapping => 
        mapping.spotify_genre === spotifyGenre
          ? { ...mapping, super_genre: superGenre, is_overridden: true }
          : mapping
      ));

      toast({
        title: 'Override Set',
        description: `${spotifyGenre} → ${superGenre}`,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to set override';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive'
      });
    }
  };

  const removeOverride = async (spotifyGenre: string) => {
    try {
      await GenreMappingService.removeOverride(spotifyGenre);
      
      // Reload to get the base mapping value
      loadMappings();

      toast({
        title: 'Override Removed',
        description: `Reset ${spotifyGenre} to default mapping`,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove override';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive'
      });
    }
  };

  const setBulkOverrides = async (overrides: Array<{ spotifyGenre: string; superGenre: SuperGenre }>) => {
    try {
      await GenreMappingService.setBulkOverrides(overrides);
      loadMappings();

      toast({
        title: 'Bulk Update Complete',
        description: `Updated ${overrides.length} genre mappings`,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update mappings';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive'
      });
    }
  };

  const exportToCSV = async () => {
    try {
      const blob = await GenreMappingService.exportToCSV();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'spotify-genre-mapping.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Export Complete',
        description: 'Genre mapping downloaded as CSV',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to export mappings';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive'
      });
    }
  };

  return {
    mappings,
    isLoading,
    error,
    loadMappings,
    setOverride,
    removeOverride,
    setBulkOverrides,
    exportToCSV
  };
};