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
  const { toast } = useToast();
  const { initialDataReady } = useAuth();

  const loadMappings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await DiscogsGenreMappingService.getEffectiveMapping();
      setMappings(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Discogs mappings';
      setError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
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
      await loadMappings();
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

  useEffect(() => {
    if (!initialDataReady) return;
    loadMappings();
  }, [initialDataReady]);

  return { mappings, isLoading, isRecomputing, error, setOverride, removeOverride, recomputeAll };
};
