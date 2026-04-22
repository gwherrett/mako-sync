import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type SyncDirection = 'push' | 'pull' | 'both';

interface SyncResult {
  pushed: number;
  pulled: number;
  skipped: number;
  errors: { id: string | number; reason: string }[];
}

export function useDiscogsSync() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (direction: SyncDirection = 'both'): Promise<SyncResult> => {
      const { data, error } = await supabase.functions.invoke(
        'discogs-two-way-sync',
        { body: { direction } },
      );

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

      const parts: string[] = [];
      if (result.pushed > 0) parts.push(`↑ ${result.pushed} pushed to Discogs`);
      if (result.pulled > 0) parts.push(`↓ ${result.pulled} pulled from Discogs`);
      if (result.skipped > 0) parts.push(`${result.skipped} skipped (no release linked)`);

      if (parts.length === 0) {
        toast({ title: 'Already in sync', description: 'Nothing to push or pull.' });
      } else {
        toast({
          title: 'Discogs sync complete',
          description: parts.join(' · '),
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
    sync: (direction: SyncDirection = 'both') => mutation.mutate(direction),
    isPending: mutation.isPending,
    result: mutation.data,
  };
}
