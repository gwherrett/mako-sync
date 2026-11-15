/**
 * SlskdSyncProgress Component
 *
 * Modal dialog showing progress and results of pushing tracks to slskd as searches.
 * Displays real-time progress during the push and final results when complete.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import type { SlskdSyncResult } from '@/types/slskd';

interface SyncProgress {
  current: number;
  total: number;
  currentTrack: string;
}

interface SlskdSyncProgressProps {
  isOpen: boolean;
  onClose: () => void;
  isSyncing: boolean;
  progress: SyncProgress | null;
  result: SlskdSyncResult | null;
}

export function SlskdSyncProgress({
  isOpen,
  onClose,
  isSyncing,
  progress,
  result,
}: SlskdSyncProgressProps) {
  const progressPercent = progress
    ? (progress.current / progress.total) * 100
    : result
    ? 100
    : 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSyncing && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isSyncing && <Loader2 className="h-5 w-5 animate-spin" />}
            {isSyncing ? 'Pushing to slskd' : 'Push complete'}
          </DialogTitle>
          <DialogDescription>
            {isSyncing
              ? 'Starting a search in slskd for each track...'
              : 'Download the results from the Searches page in slskd. It runs about two searches at a time, so the last ones can take a few minutes to finish.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Progress value={progressPercent} className="h-2" />

          {/* Progress info during sync */}
          {isSyncing && progress && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Processing {progress.current} of {progress.total}
              </p>
              <p className="text-sm font-medium truncate" title={progress.currentTrack}>
                {progress.currentTrack}
              </p>
            </div>
          )}

          {/* Results after sync */}
          {result && (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>Added: {result.addedCount}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <span>Skipped (already searched in slskd): {result.skippedCount}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <XCircle className="h-4 w-4 text-red-600" />
                  <span>Failed: {result.failedCount}</span>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="text-sm">
                  <div className="font-medium text-destructive mb-1">Errors:</div>
                  <ul className="list-disc list-inside text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                    {result.errors.slice(0, 5).map((err, idx) => (
                      <li key={idx} className="truncate" title={`${err.track}: ${err.error}`}>
                        {err.track}: {err.error}
                      </li>
                    ))}
                    {result.errors.length > 5 && (
                      <li className="text-muted-foreground">
                        ... and {result.errors.length - 5} more
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <Button onClick={onClose} className="w-full">
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
