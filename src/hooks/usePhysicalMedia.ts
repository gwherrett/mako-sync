import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/utils/promiseUtils';
import { useAuth } from '@/contexts/NewAuthContext';
import { useToast } from '@/hooks/use-toast';
import type { PhysicalMediaRecord, NewPhysicalMedia } from '@/types/discogs';

const QUERY_KEY = 'physical_media';

export function usePhysicalMedia() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: collection = [], isLoading, error } = useQuery({
    queryKey: [QUERY_KEY, user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase
          .from('physical_media')
          .select('*')
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false })
          .then(r => r),
        30000,
        'Fetch physical media timed out'
      );
      if (error) throw new Error(error.message);
      return (data ?? []) as PhysicalMediaRecord[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (newRecord: NewPhysicalMedia) => {
      const { data, error } = await withTimeout(
        supabase
          .from('physical_media')
          .insert({ ...newRecord, user_id: user!.id })
          .select()
          .single()
          .then(r => r),
        30000,
        'Save physical media timed out'
      );
      if (error) throw new Error(error.message);
      return data as PhysicalMediaRecord;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, user?.id] });
      toast({ title: 'Record added', description: 'Vinyl record saved to your collection.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PhysicalMediaRecord> }) => {
      const { error } = await withTimeout(
        supabase
          .from('physical_media')
          .update(data)
          .eq('id', id)
          .eq('user_id', user!.id)
          .then(r => r),
        30000,
        'Update physical media timed out'
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, user?.id] });
    },
    onError: (err: Error) => {
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await withTimeout(
        supabase
          .from('physical_media')
          .delete()
          .eq('id', id)
          .eq('user_id', user!.id)
          .then(r => r),
        30000,
        'Delete physical media timed out'
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, user?.id] });
      toast({ title: 'Record removed', description: 'Vinyl record removed from your collection.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    },
  });

  return {
    collection,
    isLoading,
    error,
    addRecord: addMutation.mutateAsync,
    updateRecord: (id: string, data: Partial<PhysicalMediaRecord>) =>
      updateMutation.mutateAsync({ id, data }),
    deleteRecord: deleteMutation.mutateAsync,
    isAdding: addMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
