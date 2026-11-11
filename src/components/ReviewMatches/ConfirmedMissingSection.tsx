import React, { useMemo, useState } from 'react';
import { Download, Loader2, MoreVertical, Music, Pencil, Pin, Trash2, Undo2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EditSpotifyTrackGenreDialog, type SpotifyTrackForGenreEdit } from '@/components/EditSpotifyTrackGenreDialog';
import { SlskdSyncProgress } from '@/components/SlskdSyncProgress';
import { useSlskdConfig } from '@/hooks/useSlskdConfig';
import { useSlskdSync } from '@/hooks/useSlskdSync';
import { useToast } from '@/hooks/use-toast';
import type { ConfirmedMissingTrack } from '@/services/manualMatch.service';
import type { SuperGenre } from '@/types/genreMapping';
import {
  buildMissingTracksCsv,
  genreEditTrack,
  groupByArtist,
  groupTracksByAlbum,
  missingTracksCsvFileName,
  selectedGroups,
  slskdAlbumTrack,
  slskdTracksForGroups,
} from './confirmedMissing.utils';

interface ConfirmedMissingSectionProps {
  tracks: ConfirmedMissingTrack[];
  /** Send the track back to the review queue. Settles once the decision is deleted, or failed. */
  onUndo: (track: ConfirmedMissingTrack) => Promise<void>;
  /** Unlike the track on Spotify. Settles once it is gone, or failed. */
  onUnlike: (track: ConfirmedMissingTrack) => Promise<void>;
  /** A track's supergenre was saved in the Edit SuperGenre dialog. */
  onGenreSaved: (trackId: string, superGenre: SuperGenre | null, isOverride: boolean) => void;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function downloadCsv(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoked after a moment, not straight away: some browsers are still reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Tracks the person confirmed have no local copy, grouped artist -> album. This is the old
 * Missing Tracks results view (CSV export, slskd push, unlike, edit supergenre), fed from
 * confirmed-missing decisions instead of a fresh match.
 */
export function ConfirmedMissingSection({ tracks, onUndo, onUnlike, onGenreSaved }: ConfirmedMissingSectionProps) {
  const { toast } = useToast();
  const { isConfigured } = useSlskdConfig();
  const { syncToSlskd, syncAlbumToSlskd, isSyncing, syncResult, progress, reset } = useSlskdSync();

  const [selectedArtists, setSelectedArtists] = useState<ReadonlySet<string>>(new Set());
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [editDialogTrack, setEditDialogTrack] = useState<SpotifyTrackForGenreEdit | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  /** The track an Undo or Unlike is running on. */
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null);

  const artistGroups = useMemo(() => groupByArtist(tracks), [tracks]);
  // An artist whose last track was undone or unliked drops out of the selection.
  const selected = useMemo(() => selectedGroups(artistGroups, selectedArtists), [artistGroups, selectedArtists]);
  const selectedTrackCount = selected.reduce((count, group) => count + group.tracks.length, 0);

  const toggleArtist = (artist: string) => {
    setSelectedArtists(prev => {
      const next = new Set(prev);
      if (next.has(artist)) next.delete(artist);
      else next.add(artist);
      return next;
    });
  };

  /** Exports the selected artists, or every artist when none is selected. */
  const handleExportCsv = () => {
    const groups = selected.length > 0 ? selected : artistGroups;
    if (groups.length === 0) return;
    downloadCsv(buildMissingTracksCsv(groups), missingTracksCsvFileName());
  };

  const handlePushToSlskd = () => {
    const tracksToSync = slskdTracksForGroups(selected);
    if (tracksToSync.length === 0) {
      toast({
        title: 'No tracks selected',
        description: 'Select at least one artist to push tracks to slskd.',
        variant: 'destructive',
      });
      return;
    }
    setShowSyncModal(true);
    syncToSlskd(tracksToSync);
  };

  const handleCloseSyncModal = () => {
    setShowSyncModal(false);
    reset();
  };

  const handleEditSuperGenre = (track: ConfirmedMissingTrack) => {
    setEditDialogTrack(genreEditTrack(track));
    setEditDialogOpen(true);
  };

  const runOnTrack = async (track: ConfirmedMissingTrack, action: (t: ConfirmedMissingTrack) => Promise<void>) => {
    setBusyTrackId(track.spotifyTrack.id);
    try {
      await action(track);
    } catch {
      // The review hook shows the error as a toast. The track stays in the list.
    } finally {
      setBusyTrackId(null);
    }
  };

  const artistCount = artistGroups.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Music className="h-5 w-5" />
              Confirmed Missing
            </CardTitle>
            <CardDescription>
              {tracks.length > 0
                ? `${tracks.length} ${plural(tracks.length, 'track', 'tracks')} by ${artistCount} ${plural(artistCount, 'artist', 'artists')} with no local copy. Select artists to export them or push them to slskd.`
                : 'Tracks you confirm as missing in the review queue show up here.'}
            </CardDescription>
          </div>
          {tracks.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {selected.length > 0 && (
                <Badge variant="secondary">
                  {selected.length} {plural(selected.length, 'artist', 'artists')} ({selectedTrackCount}{' '}
                  {plural(selectedTrackCount, 'track', 'tracks')})
                </Badge>
              )}
              <Button onClick={handleExportCsv} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
              <Button onClick={handlePushToSlskd} disabled={!isConfigured || selected.length === 0 || isSyncing} size="sm">
                <Upload className="mr-2 h-4 w-4" />
                Push to slskd
              </Button>
            </div>
          )}
        </div>
        {tracks.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3">
            <span className="text-sm text-muted-foreground">Select artists:</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedArtists(new Set(artistGroups.map(g => g.artist)))}
              disabled={selected.length === artistCount}
            >
              Select All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedArtists(new Set())}
              disabled={selected.length === 0}
            >
              Deselect All
            </Button>
            <span className="text-sm text-muted-foreground">
              {selected.length > 0 ? 'Export CSV exports the selected artists.' : 'With none selected, Export CSV exports every artist.'}
            </span>
          </div>
        )}
        {tracks.length > 0 && !isConfigured && (
          <p className="mt-2 text-sm text-muted-foreground">
            Configure slskd in Settings → Security to enable pushing tracks to wishlist.
          </p>
        )}
      </CardHeader>

      {tracks.length > 0 && (
        <CardContent>
          <div className="max-h-96 space-y-4 overflow-y-auto">
            {artistGroups.map(group => {
              const isSelected = selectedArtists.has(group.artist);
              return (
                <div
                  key={group.artist}
                  data-artist={group.artist}
                  className={`cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent/50 sm:p-4 ${
                    isSelected ? 'border-primary bg-accent/30' : ''
                  }`}
                  onClick={() => toggleArtist(group.artist)}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleArtist(group.artist)}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Select ${group.artist}`}
                      />
                      <h3 className="truncate text-lg font-semibold">{group.artist}</h3>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {group.tracks.length} {plural(group.tracks.length, 'track', 'tracks')}
                    </Badge>
                  </div>

                  {group.genres.length > 0 && (
                    <div className="mb-2 ml-7 flex flex-wrap gap-1">
                      {group.genres.map(genre => (
                        <Badge key={genre} variant="outline" className="text-xs">
                          {genre}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="ml-7 space-y-3">
                    {groupTracksByAlbum(group.tracks).map(({ album, tracks: albumTracks }) => (
                      <div key={album ?? '__no_album__'} className="space-y-1">
                        {album && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {album}
                            </span>
                            {isConfigured && (
                              <button
                                type="button"
                                title={`Push "${album}" to slskd`}
                                className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-0.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                                onClick={e => {
                                  e.stopPropagation();
                                  void syncAlbumToSlskd(slskdAlbumTrack(albumTracks, album));
                                }}
                              >
                                <Upload className="h-3 w-3" />
                                Push album
                              </button>
                            )}
                          </div>
                        )}
                        {albumTracks.map(track => {
                          const { id, title, super_genre_manual_override } = track.spotifyTrack;
                          const isBusy = busyTrackId === id;
                          return (
                            <div
                              key={track.trackMatchId}
                              className="group flex items-center justify-between gap-2 pl-2 text-sm text-muted-foreground"
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span>•</span>
                                <span className="truncate text-foreground">{title}</span>
                                {super_genre_manual_override && (
                                  <span title="SuperGenre manually overridden" className="shrink-0">
                                    <Pin className="h-3 w-3 text-primary" aria-label="SuperGenre manually overridden" />
                                  </span>
                                )}
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label={`Actions for ${title}`}
                                    disabled={isBusy}
                                    // Always shown on touch screens, where there is no hover.
                                    className="shrink-0 rounded p-1 transition-opacity hover:bg-accent focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    {isBusy ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <MoreVertical className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={e => {
                                      e.stopPropagation();
                                      handleEditSuperGenre(track);
                                    }}
                                  >
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit SuperGenre
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={e => {
                                      e.stopPropagation();
                                      void runOnTrack(track, onUndo);
                                    }}
                                  >
                                    <Undo2 className="mr-2 h-4 w-4" />
                                    Undo: back to review
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={e => {
                                      e.stopPropagation();
                                      void runOnTrack(track, onUnlike);
                                    }}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Unlike on Spotify
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      )}

      <SlskdSyncProgress
        isOpen={showSyncModal}
        onClose={handleCloseSyncModal}
        isSyncing={isSyncing}
        progress={progress}
        result={syncResult ?? null}
      />

      <EditSpotifyTrackGenreDialog
        track={editDialogTrack}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSaved={onGenreSaved}
      />
    </Card>
  );
}
