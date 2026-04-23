import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AddToCollectionArgs {
  releaseId: number;
  rating?: number | null;
}

interface AddToCollectionResult {
  instance_id: number;
  resource_url: string;
}

export function useDiscogsAddToCollection() {
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async ({ releaseId, rating }: AddToCollectionArgs): Promise<AddToCollectionResult> => {
      const { data, error } = await supabase.functions.invoke(
        'discogs-add-to-collection',
        { body: { releaseId, rating: rating ?? 0 } },
      );

      if (error) {
        let message = error.message ?? 'Failed to add to Discogs collection';
        try {
          const parsed = typeof error.context === 'object' && error.context !== null
            ? await (error.context as Response).json?.()
            : null;
          if (parsed?.code === 'DISCOGS_TIMEOUT') {
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
      toast({ title: 'Added to Discogs. Sync to see it in Mako.' });
    },
    onError: (err: Error) => {
      toast({
        title: 'Failed to add to Discogs',
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
