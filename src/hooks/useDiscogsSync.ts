import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SyncResult {
  pulled: number;
  errors: { id: string | number; reason: string }[];
}

export function useDiscogsSync() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (): Promise<SyncResult> => {
      const { data, error } = await supabase.functions.invoke('discogs-pull-sync');

      if (error) {
        let message = error.message ?? 'Discogs sync failed';
        try {
          const parsed = typeof error.context === 'object' && error.context !== null
            ? await (error.context as Response).json?.()
            : null;
          if (parsed?.code === 'RATE_LIMITED') {
            message = 'Discogs rate limit hit. Please wait 60 seconds and try again.';
          } else if (parsed?.code === 'NOT_CONNECTED') {
            message = 'Discogs is not connected. Connect it on the Security page.';
          } else if (parsed?.error) {
            message = parsed.details ? `${parsed.error} — ${parsed.details}` : parsed.error;
          }
        } catch {
          // leave message as-is
        }
        throw new Error(message);
      }

      return data as SyncResult;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['physical_media'] });

      if (result.pulled === 0) {
        toast({ title: 'Already in sync', description: 'Collection is already up to date.' });
      } else {
        toast({
          title: 'Discogs sync complete',
          description: `↓ ${result.pulled} pulled from Discogs`,
        });
      }

      if (result.errors.length > 0) {
        toast({
          title: `${result.errors.length} item${result.errors.length === 1 ? '' : 's'} failed`,
          description: result.errors[0].reason,
          variant: 'destructive',
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
    sync: () => mutation.mutate(),
    isPending: mutation.isPending,
    result: mutation.data,
  };
}
