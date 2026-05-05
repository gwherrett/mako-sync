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
      console.log('[DiscogsSync] invoking discogs-pull-sync edge function');
      const { data, error } = await supabase.functions.invoke('discogs-pull-sync');
      console.log('[DiscogsSync] invoke returned', { data, error });

      if (error) {
        let message = error.message ?? 'Discogs sync failed';
        try {
          const parsed = typeof error.context === 'object' && error.context !== null
            ? await (error.context as Response).json?.()
            : null;
          console.log('[DiscogsSync] error context parsed', parsed);
          if (parsed?.code === 'RATE_LIMITED') {
            message = 'Discogs rate limit hit. Please wait 60 seconds and try again.';
          } else if (parsed?.code === 'NOT_CONNECTED') {
            message = 'Discogs is not connected. Connect it on the Security page.';
          } else if (parsed?.error) {
            message = parsed.details ? `${parsed.error} — ${parsed.details}` : parsed.error;
          }
        } catch (parseErr) {
          console.warn('[DiscogsSync] failed to parse error context', parseErr);
        }
        console.error('[DiscogsSync] throwing error:', message);
        throw new Error(message);
      }

      if (!data || typeof (data as SyncResult).pulled !== 'number') {
        console.error('[DiscogsSync] unexpected response shape:', data);
        throw new Error('Discogs sync returned an unexpected response. Check the console for details.');
      }

      return data as SyncResult;
    },
    onSuccess: (result) => {
      console.log('[DiscogsSync] onSuccess', result);
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
      console.error('[DiscogsSync] onError', err);
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
