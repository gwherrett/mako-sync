import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Filter, ListChecks, Loader2, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { useMatchReview, useReviewFilterOptions } from '@/hooks/useMatchReview';
import type { AutoConfirmedMatch, ReviewItem } from '@/services/manualMatch.service';
import type { MatchCandidateFilters } from '@/services/trackMatching.service';
import type { LocalTrack } from '@/services/trackMatchingEngine';
import { DANCE_ALL_VALUE, SUPERDJ_LABEL } from '@/types/genreMapping';
import { ReviewQueueTable } from './ReviewQueueTable';
import { candidateMatchMethod } from './reviewQueue.utils';

/** Rows drawn at once. The next rows move up as decisions are made. */
const QUEUE_PAGE_SIZE = 50;
const SUMMARY_PAGE_SIZE = 100;
const SKELETON_ROWS = 5;
/** Long enough to read the toast and reach Undo. */
const UNDO_TOAST_MS = 8000;

interface ReviewMatchesProps {
  superGenres: string[];
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

const ReviewMatches: React.FC<ReviewMatchesProps> = ({ superGenres }) => {
  const { toast } = useToast();

  // Cascading filters: supergenre -> genre -> artist
  const [superGenre, setSuperGenre] = useState('all');
  const [genre, setGenre] = useState('all');
  const [artist, setArtist] = useState('all');
  // The filters of the queue on screen. Null until Load Review Queue is clicked.
  const [loadedFilters, setLoadedFilters] = useState<MatchCandidateFilters | null>(null);

  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [queueLimit, setQueueLimit] = useState(QUEUE_PAGE_SIZE);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLimit, setSummaryLimit] = useState(SUMMARY_PAGE_SIZE);

  const { pairs, isLoading: isLoadingFilters } = useReviewFilterOptions(superGenre);
  const {
    queue,
    isLoading,
    isRefreshing,
    error,
    bulkAutoConfirmTier1,
    confirmMatch,
    rejectCandidate,
    confirmTrueMissing,
    undoDecision,
  } = useMatchReview(loadedFilters);

  const availableGenres = useMemo(
    () => [...new Set(pairs.map(pair => pair.genre).filter((g): g is string => !!g))].sort(),
    [pairs]
  );
  const availableArtists = useMemo(
    () => [
      ...new Set(
        pairs.filter(pair => genre === 'all' || pair.genre === genre).map(pair => pair.artist).filter(Boolean)
      ),
    ].sort(),
    [pairs, genre]
  );

  const handleSuperGenreChange = (value: string) => {
    setSuperGenre(value);
    setGenre('all');
    setArtist('all');
  };

  const handleGenreChange = (value: string) => {
    setGenre(value);
    setArtist('all');
  };

  const handleLoad = async () => {
    const filters: MatchCandidateFilters = { superGenre, genre, artist };
    let confirmed: number;
    try {
      confirmed = await bulkAutoConfirmTier1(filters);
    } catch {
      return; // The hook shows the error as a toast and in the queue card.
    }
    toast({ title: `${confirmed} exact ${plural(confirmed, 'match', 'matches')} confirmed` });
    setQueueLimit(QUEUE_PAGE_SIZE);
    setSummaryLimit(SUMMARY_PAGE_SIZE);
    setLoadedFilters(filters);
  };

  const setPending = (spotifyLikedId: string, pending: boolean) => {
    setPendingIds(prev => {
      const next = new Set(prev);
      if (pending) next.add(spotifyLikedId);
      else next.delete(spotifyLikedId);
      return next;
    });
  };

  const handleUndo = async (trackMatchIds: string[]) => {
    try {
      for (const id of trackMatchIds) await undoDecision(id);
    } catch {
      return; // The hook shows the error.
    }
    toast({ title: 'Decision undone', description: 'The track is back in the review queue.' });
  };

  /**
   * Run a decision's writes, then offer Undo. `save` resolves to the ids of the rows it wrote,
   * in the order Undo should delete them.
   */
  const decide = async (item: ReviewItem, title: string, save: () => Promise<string[]>) => {
    const { id, title: trackTitle, artist: trackArtist } = item.spotifyTrack;
    setPending(id, true);
    try {
      const trackMatchIds = await save();
      toast({
        title,
        description: `"${trackTitle}" by ${trackArtist}`,
        duration: UNDO_TOAST_MS,
        action: (
          <ToastAction altText="Undo this decision" onClick={() => void handleUndo(trackMatchIds)}>
            Undo
          </ToastAction>
        ),
      });
    } catch {
      // The hook shows the error. The row stays in the queue.
    } finally {
      setPending(id, false);
    }
  };

  const handleConfirm = (item: ReviewItem) => {
    const { candidate } = item;
    if (!candidate) return;
    void decide(item, 'Match confirmed', async () => [
      await confirmMatch({
        spotifyLikedId: item.spotifyTrack.id,
        mp3Id: candidate.id,
        options: {
          method: candidateMatchMethod(item),
          confidence: item.tier === 3 ? item.similarity ?? null : null,
          source: 'human',
        },
      }),
    ]);
  };

  const handlePick = (item: ReviewItem, localTrack: LocalTrack) => {
    const spotifyLikedId = item.spotifyTrack.id;
    void decide(item, 'Match picked', async () => {
      // The suggested file is rejected first, so the row records which tier got it wrong.
      const rejectedId = item.candidate
        ? await rejectCandidate({
            spotifyLikedId,
            mp3Id: item.candidate.id,
            options: { method: candidateMatchMethod(item) },
          })
        : null;
      const confirmedId = await confirmMatch({
        spotifyLikedId,
        mp3Id: localTrack.id,
        options: { method: 'manual', source: 'human' },
      });
      return rejectedId ? [confirmedId, rejectedId] : [confirmedId];
    });
  };

  const handleConfirmMissing = (item: ReviewItem) => {
    void decide(item, 'Confirmed missing', async () => [
      await confirmTrueMissing({ spotifyLikedId: item.spotifyTrack.id }),
    ]);
  };

  const hasFilters = superGenre !== 'all' || genre !== 'all' || artist !== 'all';
  const toReview = queue?.toReview ?? [];
  const autoConfirmed = queue?.autoConfirmed ?? [];
  const showQueueCard = isLoading || !!error || !!queue;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Review Matches
          </CardTitle>
          <CardDescription>
            Exact matches are confirmed for you. Check the rest: confirm the suggested file, pick another, or
            mark the track as missing. Each decision saves straight away.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Supergenre:</span>
              <Select value={superGenre} onValueChange={handleSuperGenreChange}>
                <SelectTrigger className="w-40" aria-label="Supergenre">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({superGenres.length})</SelectItem>
                  <SelectSeparator />
                  <SelectItem value={DANCE_ALL_VALUE}>{SUPERDJ_LABEL}</SelectItem>
                  <SelectSeparator />
                  {superGenres.map(value => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Genre:</span>
              <Select value={genre} onValueChange={handleGenreChange} disabled={isLoadingFilters}>
                <SelectTrigger className="w-40" aria-label="Genre">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({availableGenres.length})</SelectItem>
                  {availableGenres.map(value => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Artist:</span>
              <Select value={artist} onValueChange={setArtist} disabled={isLoadingFilters}>
                <SelectTrigger className="w-48" aria-label="Artist">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({availableArtists.length})</SelectItem>
                  {availableArtists.map(value => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={() => handleSuperGenreChange('all')}>
                Clear All
              </Button>
            )}
          </div>

          <Button onClick={() => void handleLoad()} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              'Load Review Queue'
            )}
          </Button>
        </CardContent>
      </Card>

      {queue && !isLoading && (
        <AutoConfirmedSummary
          matches={autoConfirmed}
          open={summaryOpen}
          onOpenChange={setSummaryOpen}
          limit={summaryLimit}
          onShowMore={() => setSummaryLimit(limit => limit + SUMMARY_PAGE_SIZE)}
        />
      )}

      {showQueueCard && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Review Queue
              {isRefreshing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Refreshing" />}
            </CardTitle>
            {queue && !isLoading && toReview.length > 0 && (
              <CardDescription>
                {toReview.length} {plural(toReview.length, 'track needs', 'tracks need')} a decision
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error.message}</span>
              </div>
            )}

            {isLoading ? (
              <div className="space-y-3" aria-busy="true" aria-label="Loading review queue">
                {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-10 flex-1" />
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-10 flex-1" />
                    <Skeleton className="h-8 w-48" />
                  </div>
                ))}
              </div>
            ) : queue && toReview.length === 0 ? (
              <div className="py-8 text-center">
                <Music className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-semibold">Nothing left to review</h3>
                <p className="text-muted-foreground">
                  Every track in this selection has a decision. Change the filters to review another part of
                  your library.
                </p>
              </div>
            ) : queue ? (
              <>
                <ReviewQueueTable
                  items={toReview.slice(0, queueLimit)}
                  localTracks={queue.localTracks}
                  pendingIds={pendingIds}
                  onConfirm={handleConfirm}
                  onPick={handlePick}
                  onConfirmMissing={handleConfirmMissing}
                />
                {toReview.length > queueLimit && (
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      Showing {queueLimit} of {toReview.length}. More rows move up as you decide.
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setQueueLimit(limit => limit + QUEUE_PAGE_SIZE)}>
                      Show more
                    </Button>
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

interface AutoConfirmedSummaryProps {
  matches: AutoConfirmedMatch[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limit: number;
  onShowMore: () => void;
}

/** Collapsed line for the exact matches the engine confirmed. Opens a read-only list. */
function AutoConfirmedSummary({ matches, open, onOpenChange, limit, onShowMore }: AutoConfirmedSummaryProps) {
  const count = matches.length;

  return (
    <Collapsible open={open && count > 0} onOpenChange={onOpenChange}>
      <Card>
        <CollapsibleTrigger asChild disabled={count === 0}>
          <button
            type="button"
            className="flex w-full items-center gap-2 p-4 text-left text-sm font-medium disabled:cursor-default"
          >
            {open && count > 0 ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            {count} exact {plural(count, 'match', 'matches')} auto-confirmed
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Artist</TableHead>
                  <TableHead>Local file</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matches.slice(0, limit).map(({ spotifyTrack, localTrack }) => (
                  <TableRow key={spotifyTrack.id}>
                    <TableCell className="font-medium">{spotifyTrack.title}</TableCell>
                    <TableCell>{spotifyTrack.artist}</TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground" title={localTrack.file_path}>
                      {localTrack.file_path}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {count > limit && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Showing {limit} of {count}
                </span>
                <Button variant="outline" size="sm" onClick={onShowMore}>
                  Show more
                </Button>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default ReviewMatches;
