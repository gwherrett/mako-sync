import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AddToCollectionResult {
  instance_id: number;
  resource_url: string;
  synced_at: string;
}

export function useDiscogsAddToCollection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (physicalMediaId: string): Promise<AddToCollectionResult> => {
      const { data, error } = await supabase.functions.invoke(
        'discogs-add-to-collection',
        { body: { physicalMediaId } },
      );

      if (error) {
        // Try to parse a structured error code from the response body
        let message = error.message ?? 'Failed to add to Discogs collection';
        try {
          const parsed = typeof error.context === 'object' && error.context !== null
            ? await (error.context as Response).json?.()
            : null;
          if (parsed?.code === 'ALREADY_SYNCED') {
            message = 'This record is already in your Discogs collection';
          } else if (parsed?.code === 'DISCOGS_TIMEOUT') {
            message = 'Discogs did not respond in time — please try again';
          } else if (parsed?.error) {
            message = parsed.error;
          }
        } catch {
          // leave message as-is
        }
        throw new Error(message);
      }

      return data as AddToCollectionResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['physical_media'] });
      toast({ title: 'Added to your Discogs collection' });
    },
    onError: (err: Error) => {
      toast({
        title: 'Discogs sync failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  return {
    addToCollection: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
  };
}
