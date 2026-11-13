import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { DiscogsGenreMappingService, type DiscogsTermMapping } from '@/services/discogsGenreMapping.service';
import type { SuperGenre } from '@/types/genreMapping';
import { useAuth } from '@/contexts/NewAuthContext';

export const useDiscogsGenreMapping = () => {
  const [mappings, setMappings] = useState<DiscogsTermMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by loadMappings to make the load effect run again
  const [reloadCount, setReloadCount] = useState(0);
  const { toast } = useToast();
  const { initialDataReady } = useAuth();

  useEffect(() => {
    if (!initialDataReady) return;
    let ignore = false;
    DiscogsGenreMappingService.getEffectiveMapping()
      .then((data) => {
        if (!ignore) setMappings(data);
      })
      .catch((err) => {
        if (ignore) return;
        const message = err instanceof Error ? err.message : 'Failed to load Discogs mappings';
        setError(message);
        toast({ title: 'Error', description: message, variant: 'destructive' });
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [initialDataReady, reloadCount, toast]);

  const loadMappings = () => {
    setIsLoading(true);
    setError(null);
    setReloadCount((n) => n + 1);
  };

  const setOverride = async (discogsTerm: string, superGenre: SuperGenre) => {
    try {
      await DiscogsGenreMappingService.setOverride(discogsTerm, superGenre);
      setMappings(prev => prev.map(m =>
        m.discogs_term === discogsTerm ? { ...m, super_genre: superGenre, is_overridden: true } : m
      ));
      toast({ title: 'Override Set', description: `${discogsTerm} → ${superGenre}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to set override';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const removeOverride = async (discogsTerm: string) => {
    try {
      await DiscogsGenreMappingService.removeOverride(discogsTerm);
      loadMappings();
      toast({ title: 'Override Removed', description: `Reset ${discogsTerm} to default mapping` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove override';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const recomputeAll = async () => {
    try {
      setIsRecomputing(true);
      await DiscogsGenreMappingService.recomputeAll();
      toast({ title: 'Recompute Complete', description: 'Super genres updated for all vinyl records' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to recompute';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsRecomputing(false);
    }
  };

  return { mappings, isLoading, isRecomputing, error, setOverride, removeOverride, recomputeAll };
};
