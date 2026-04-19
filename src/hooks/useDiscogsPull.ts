import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface PullResult {
  imported: number;
  skipped: number;
  total_in_discogs: number;
}

export function useDiscogsPull() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (): Promise<PullResult> => {
      const { data, error } = await supabase.functions.invoke(
        'discogs-sync-from-collection',
        { body: {} },
      );

      if (error) {
        let message = error.message ?? 'Failed to pull from Discogs';
        try {
          const parsed = typeof error.context === 'object' && error.context !== null
            ? await (error.context as Response).json?.()
            : null;
          if (parsed?.code === 'RATE_LIMITED') {
            message = 'Discogs rate limit hit. Please wait 60 seconds and try again.';
          } else if (parsed?.code === 'NOT_CONNECTED') {
            message = 'Discogs is not connected. Connect it on the Security page.';
          } else if (parsed?.error) {
            message = parsed.error;
          }
        } catch {
          // leave message as-is
        }
        throw new Error(message);
      }

      return data as PullResult;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['physical_media'] });
      if (result.imported === 0) {
        toast({
          title: 'Already up to date',
          description: `No new records found in your Discogs collection (${result.total_in_discogs} total tracked).`,
        });
      } else {
        toast({
          title: `Imported ${result.imported} record${result.imported === 1 ? '' : 's'}`,
          description: `${result.skipped} already tracked, ${result.total_in_discogs} total in Discogs.`,
        });
      }
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
    pullFromDiscogs: mutation.mutate,
    isPulling: mutation.isPending,
  };
}
