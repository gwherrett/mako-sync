import React from 'react';
import { Check, FolderSearch, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ReviewItem } from '@/services/manualMatch.service';
import type { LocalTrack } from '@/services/trackMatchingEngine';
import { LocalTrackCombobox } from './LocalTrackCombobox';
import { getRowActions, getTierBadge } from './reviewQueue.utils';

interface ReviewQueueTableProps {
  items: ReviewItem[];
  /** Every local file the user has, for the picker. */
  localTracks: LocalTrack[];
  /** Spotify track ids with a decision being saved. Their buttons are disabled. */
  pendingIds: ReadonlySet<string>;
  /** Accept the row's suggested candidate. */
  onConfirm: (item: ReviewItem) => void;
  /** Use `localTrack` as the match. On a row with a candidate, this also rejects the candidate. */
  onPick: (item: ReviewItem, localTrack: LocalTrack) => void;
  /** Record that the track has no local copy. */
  onConfirmMissing: (item: ReviewItem) => void;
}

/** One row per Spotify track that needs a decision. Every action saves straight away. */
export function ReviewQueueTable({
  items,
  localTracks,
  pendingIds,
  onConfirm,
  onPick,
  onConfirmMissing,
}: ReviewQueueTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Track</TableHead>
          <TableHead>Tier</TableHead>
          <TableHead>Candidate local file</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map(item => {
          const { spotifyTrack, candidate } = item;
          const badge = getTierBadge(item);
          const actions = getRowActions(item);
          const isPending = pendingIds.has(spotifyTrack.id);
          // The picker never offers the candidate being rejected, or files rejected before.
          const excludeIds = candidate ? [...item.rejectedMp3Ids, candidate.id] : item.rejectedMp3Ids;

          return (
            <TableRow key={spotifyTrack.id} data-tier={item.tier ?? 'none'} className={cn(isPending && 'opacity-60')}>
              <TableCell className="align-top">
                <div className="font-medium">{spotifyTrack.title}</div>
                <div className="text-sm text-muted-foreground">{spotifyTrack.artist}</div>
              </TableCell>
              <TableCell className="align-top">
                <Badge variant="outline" className={cn('whitespace-nowrap', badge.className)}>
                  {badge.label}
                </Badge>
              </TableCell>
              <TableCell className="max-w-xs align-top">
                {candidate ? (
                  <>
                    <div className="font-medium">{candidate.title || 'Untitled'}</div>
                    <div className="text-sm text-muted-foreground">
                      {candidate.artist || 'Unknown artist'}
                      {candidate.album && ` · ${candidate.album}`}
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={candidate.file_path}>
                      {candidate.file_path}
                    </div>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">No candidate</span>
                )}
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {actions.includes('confirm') && (
                    <Button size="sm" disabled={isPending} onClick={() => onConfirm(item)}>
                      <Check className="mr-1.5 h-4 w-4" />
                      Confirm
                    </Button>
                  )}
                  {(actions.includes('reject') || actions.includes('pick')) && (
                    <LocalTrackCombobox
                      localTracks={localTracks}
                      excludeIds={excludeIds}
                      preferredArtist={spotifyTrack.primary_artist || spotifyTrack.artist}
                      onSelect={localTrack => onPick(item, localTrack)}
                    >
                      {actions.includes('reject') ? (
                        <Button size="sm" variant="outline" disabled={isPending} title="Reject and pick another file">
                          <X className="mr-1.5 h-4 w-4" />
                          Reject
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled={isPending}>
                          <FolderSearch className="mr-1.5 h-4 w-4" />
                          Pick file
                        </Button>
                      )}
                    </LocalTrackCombobox>
                  )}
                  <Button size="sm" variant="ghost" disabled={isPending} onClick={() => onConfirmMissing(item)}>
                    Confirm Missing
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
