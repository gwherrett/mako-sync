import React, { useState, useEffect } from 'react';
import { ExternalLink, ChevronUp, ChevronDown, Copy, Trash2, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TrackFilters, FilterConfig, FilterState, FilterOptions, FilterCallbacks } from '@/components/common/TrackFilters';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { RealtimePostgresUpdatePayload } from '@supabase/supabase-js';
import { getErrorMessage } from '@/utils/errorUtils';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/NewAuthContext';
import { useUnifiedSpotifyAuth } from '@/hooks/useUnifiedSpotifyAuth';
import { IframeBanner } from '@/components/common/IframeBanner';
import { openInNewTab } from '@/utils/linkUtils';
import { DuplicateDetectionService } from '@/services/duplicateDetection.service';
import { useGenreMappingOverrides } from '@/hooks/useGenreMappingOverrides';
import { withQueryTimeout, type FilterableQuery } from '@/utils/supabaseQuery';
import { applySuperGenreFilter } from '@/types/genreMapping';

interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  super_genre: string | null;
  bpm: number | null;
  key: string | null;
  danceability: number | null;
  year: number | null;
  added_at: string | null;
  spotify_id: string;
  mix: string | null;
}

const TRACKS_PER_PAGE = 50;

type SpotifySortField = 'added_at' | 'year' | 'artist' | 'title' | 'album' | 'super_genre' | 'genre';

interface SpotifyTrackFilters {
  searchQuery: string;
  selectedArtist: string;
  selectedGenre: string;
  superGenre: string;
  dateFilter: string;
  noSuperGenre: boolean;
  noGenre: boolean;
}

// The builder is viewed through FilterableQuery: checking it against the interface as a
// generic constraint makes TypeScript give up (TS2589). The caller gets its own type back.
function applySpotifyTrackFilters<Q>(query: Q, f: SpotifyTrackFilters): Q {
  let q = query as unknown as FilterableQuery;
  if (f.searchQuery.trim()) {
    q = q.or(`title.ilike.%${f.searchQuery}%,artist.ilike.%${f.searchQuery}%`);
  }
  if (f.selectedGenre) q = q.eq('genre', f.selectedGenre);
  if (f.noGenre) q = q.is('genre', null);
  if (f.noSuperGenre) q = q.is('super_genre', null);
  else q = applySuperGenreFilter(q, f.superGenre);
  if (f.selectedArtist) q = q.eq('artist', f.selectedArtist);
  if (f.dateFilter === 'week') {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    q = q.gte('added_at', weekAgo.toISOString());
  } else if (f.dateFilter === 'month') {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    q = q.gte('added_at', monthAgo.toISOString());
  }
  return q as unknown as Q;
}

/** `count` is null if the count query failed; `tracks` is null if either query failed. */
interface SpotifyTracksPage {
  count: number | null;
  tracks: SpotifyTrack[] | null;
  timedOut: boolean;
}

/** Runs the count query, then the page query. Aborting `cancel` aborts whichever is in flight. */
async function fetchSpotifyTracksPage(
  userId: string,
  filters: SpotifyTrackFilters,
  sortField: SpotifySortField,
  sortDirection: 'asc' | 'desc',
  page: number,
  cancel: AbortSignal
): Promise<SpotifyTracksPage> {
  const countResult = await withQueryTimeout(
    async (signal) => {
      let query = supabase
        .from('spotify_liked')
        .select('*', { count: 'exact' })
        .eq('user_id', userId);
      query = applySpotifyTrackFilters(query, filters);
      query = query.range(0, 0);
      return query.abortSignal(AbortSignal.any([signal, cancel]));
    },
    15000,
    'TracksTable:count'
  );

  if (countResult.error) return { count: null, tracks: null, timedOut: countResult.timedOut };
  const count = countResult.data?.count || 0;
  if (cancel.aborted) return { count, tracks: null, timedOut: false };

  const dataResult = await withQueryTimeout(
    async (signal) => {
      let query = supabase
        .from('spotify_liked')
        .select('*')
        .eq('user_id', userId);
      query = applySpotifyTrackFilters(query, filters);
      return query
        .order(sortField, { ascending: sortDirection === 'asc' })
        .range((page - 1) * TRACKS_PER_PAGE, page * TRACKS_PER_PAGE - 1)
        .abortSignal(AbortSignal.any([signal, cancel]));
    },
    15000,
    'TracksTable:data'
  );

  if (dataResult.error) return { count, tracks: null, timedOut: dataResult.timedOut };
  return { count, tracks: dataResult.data?.data || [], timedOut: false };
}

/** Each list is null if its query returned no data. */
interface SpotifyFilterOptions {
  artists: string[] | null;
  genres: string[] | null;
  superGenres: string[] | null;
}

async function fetchSpotifyFilterOptions(
  userId: string,
  f: Pick<SpotifyTrackFilters, 'selectedGenre' | 'superGenre' | 'noSuperGenre'>,
  cancel: AbortSignal
): Promise<SpotifyFilterOptions> {
  // Get unique artists with timeout protection
  const artistResult = await withQueryTimeout(
    async (signal) => {
      let query = supabase
        .from('spotify_liked')
        .select('artist')
        .eq('user_id', userId)
        .not('artist', 'is', null);

      if (f.selectedGenre) {
        query = query.eq('genre', f.selectedGenre);
      }

      if (f.noSuperGenre) {
        query = query.is('super_genre', null);
      } else {
        query = applySuperGenreFilter(query, f.superGenre);
      }

      return query.abortSignal(AbortSignal.any([signal, cancel]));
    },
    10000,
    'TracksTable:filterOptions:artists'
  );
  const artists = artistResult.data?.data
    ? [...new Set(artistResult.data.data.map(item => item.artist))].sort()
    : null;
  if (cancel.aborted) return { artists, genres: null, superGenres: null };

  // Get unique genres with timeout protection
  const genreResult = await withQueryTimeout(
    async (signal) => {
      let query = supabase
        .from('spotify_liked')
        .select('genre')
        .eq('user_id', userId)
        .not('genre', 'is', null);

      if (f.noSuperGenre) {
        query = query.is('super_genre', null);
      } else {
        query = applySuperGenreFilter(query, f.superGenre);
      }

      return query.abortSignal(AbortSignal.any([signal, cancel]));
    },
    10000,
    'TracksTable:filterOptions:genres'
  );
  const genres = genreResult.data?.data
    ? [...new Set(genreResult.data.data.map(item => item.genre))].sort()
    : null;
  if (cancel.aborted) return { artists, genres, superGenres: null };

  // Get unique super genres with timeout protection
  const superGenreResult = await withQueryTimeout(
    async (signal) => {
      return supabase
        .from('spotify_liked')
        .select('super_genre')
        .eq('user_id', userId)
        .not('super_genre', 'is', null)
        .abortSignal(AbortSignal.any([signal, cancel]));
    },
    10000,
    'TracksTable:filterOptions:superGenres'
  );
  const superGenres = superGenreResult.data?.data
    ? [...new Set(superGenreResult.data.data.map(item => item.super_genre))].sort()
    : null;

  return { artists, genres, superGenres };
}

interface TracksTableProps {
  onTrackSelect: (track: SpotifyTrack) => void;
  selectedTrack: SpotifyTrack | null;
  sharedSearchQuery?: string;
  sharedSuperGenre?: string;
}

const TracksTable = ({ onTrackSelect, selectedTrack, sharedSearchQuery = '', sharedSuperGenre = '' }: TracksTableProps) => {
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalTracks, setTotalTracks] = useState(0);
  const [sortField, setSortField] = useState<'added_at' | 'year' | 'artist' | 'title' | 'album' | 'super_genre' | 'genre'>('added_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  
  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArtist, setSelectedArtist] = useState<string>('');
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [selectedSuperGenre, setSelectedSuperGenre] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [noSuperGenre, setNoSuperGenre] = useState<boolean>(false);
  const [noGenre, setNoGenre] = useState<boolean>(false);
  
  // Filter options
  const [artists, setArtists] = useState<string[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [superGenres, setSuperGenres] = useState<string[]>([]);

  const [unlikingTrackId, setUnlikingTrackId] = useState<string | null>(null);
  const tracksPerPage = TRACKS_PER_PAGE;
  const { toast } = useToast();
  const { user, isAuthenticated, loading: authLoading, initialDataReady, spotifyDataFetchEnabled } = useAuth();
  const { isInitialCheckComplete: spotifyCheckComplete } = useUnifiedSpotifyAuth();
  const { hasOverride } = useGenreMappingOverrides();

  // Compute effective filters (shared takes precedence, local adds to it)
  const effectiveSearchQuery = sharedSearchQuery || searchQuery;
  const effectiveSuperGenre = sharedSuperGenre || selectedSuperGenre;
  const userId = user?.id;

  // Bumped when a Spotify sync completes, to make the data and filter-option effects run again
  const [reloadCount, setReloadCount] = useState(0);
  // True once a page of results has been shown
  const [hasLoaded, setHasLoaded] = useState(false);

  // Reset to page 1 when shared filters change
  const [syncedShared, setSyncedShared] = useState({ sharedSearchQuery, sharedSuperGenre });
  if (syncedShared.sharedSearchQuery !== sharedSearchQuery || syncedShared.sharedSuperGenre !== sharedSuperGenre) {
    setSyncedShared({ sharedSearchQuery, sharedSuperGenre });
    setCurrentPage(1);
  }

  // Signed out: show an empty table. Uses the same guards as the data effect, so the
  // token-refresh settle window doesn't clear it.
  const signedOut = !authLoading && spotifyDataFetchEnabled && spotifyCheckComplete && (!isAuthenticated || !userId);
  if (signedOut && (tracks.length > 0 || totalTracks !== 0 || loading)) {
    setTracks([]);
    setTotalTracks(0);
    setLoading(false);
  }

  // Consolidated fetch effect - debounces search, immediate for other filters
  // Wait for spotifyDataFetchEnabled AND Spotify connection check to prevent concurrent request deadlock.
  // spotifyDataFetchEnabled is false during the token-refresh settle window, which prevents queries from
  // firing into the locked Supabase client. When it transitions back to true, this effect re-runs
  // automatically, giving "show stale data then auto-refresh" behaviour on tab restore.
  // The cleanup aborts any in-flight queries, so a slower old query can't overwrite newer results.
  useEffect(() => {
    if (authLoading || !spotifyDataFetchEnabled || !spotifyCheckComplete) return;
    // The signed-out state is cleared during render, above
    if (!isAuthenticated || !userId) return;

    let ignore = false;
    const cancel = new AbortController();
    const filters: SpotifyTrackFilters = {
      searchQuery: effectiveSearchQuery,
      selectedArtist,
      selectedGenre,
      superGenre: effectiveSuperGenre,
      dateFilter,
      noSuperGenre,
      noGenre,
    };

    // Debounce only for search query changes
    const timeoutId = setTimeout(() => {
      setLoading(true);
      fetchSpotifyTracksPage(userId, filters, sortField, sortDirection, currentPage, cancel.signal)
        .then((result) => {
          if (ignore) return;
          if (result.count !== null) setTotalTracks(result.count);
          if (result.tracks !== null) {
            setTracks(result.tracks);
            setHasLoaded(true);
          } else if (result.timedOut) {
            toast({
              title: "Query Timeout",
              description: "The request took too long. Please try again.",
              variant: "destructive",
            });
          }
          setLoading(false);
        })
        .catch((error) => {
          if (ignore) return;
          console.error('Error loading Spotify tracks:', error);
          setLoading(false);
        });
    }, effectiveSearchQuery ? 300 : 0);

    return () => {
      ignore = true;
      clearTimeout(timeoutId);
      cancel.abort();
    };
  }, [authLoading, spotifyDataFetchEnabled, spotifyCheckComplete, isAuthenticated, userId, currentPage, sortField, sortDirection, selectedArtist, selectedGenre, effectiveSuperGenre, dateFilter, noSuperGenre, noGenre, effectiveSearchQuery, reloadCount, toast]);

  // Separate effect for filter options, which narrow with the genre and supergenre filters
  useEffect(() => {
    if (authLoading || !spotifyDataFetchEnabled || !spotifyCheckComplete || !isAuthenticated || !userId) return;

    let ignore = false;
    const cancel = new AbortController();
    fetchSpotifyFilterOptions(userId, { selectedGenre, superGenre: effectiveSuperGenre, noSuperGenre }, cancel.signal)
      .then((options) => {
        if (ignore) return;
        if (options.artists) setArtists(options.artists);
        if (options.genres) setGenres(options.genres);
        if (options.superGenres) setSuperGenres(options.superGenres);
      })
      .catch((error) => {
        if (!ignore) console.error('Error loading Spotify filter options:', error);
      });

    return () => {
      ignore = true;
      cancel.abort();
    };
  }, [authLoading, spotifyDataFetchEnabled, spotifyCheckComplete, isAuthenticated, userId, selectedGenre, effectiveSuperGenre, noSuperGenre, reloadCount]);

  // Subscribe to sync_progress to refresh when sync completes
  useEffect(() => {
    if (!userId || !isAuthenticated) return;

    const channel = supabase
      .channel('tracks-sync-refresh')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sync_progress',
          filter: `user_id=eq.${userId}`
        },
        (payload: RealtimePostgresUpdatePayload<Tables<'sync_progress'>>) => {
          // Refresh tracks and filter options when sync completes, using the current filters
          if (payload.new?.status === 'completed') {
            setReloadCount((n) => n + 1);
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [userId, isAuthenticated]);

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedArtist('');
    setSelectedGenre('');
    setSelectedSuperGenre('');
    setDateFilter('');
    setNoSuperGenre(false);
    setNoGenre(false);
    setCurrentPage(1);
  };

  const handleSort = (field: 'added_at' | 'year' | 'artist' | 'title' | 'album' | 'super_genre' | 'genre') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1); // Reset to first page when sorting
  };

  const handleSpotifyClick = async (e: React.MouseEvent<HTMLAnchorElement>, spotifyId: string) => {
    e.stopPropagation();
    
    const url = `https://open.spotify.com/track/${spotifyId}`;
    
    // Handle Ctrl/Cmd+Click - let browser handle it naturally
    if (e.ctrlKey || e.metaKey) {
      return; // Don't preventDefault, let the browser handle it
    }
    
    // Prevent default link behavior for our custom handling
    e.preventDefault();
    
    // Dev-only logging
    if (process.env.NODE_ENV === 'development') {
      console.log('Opening Spotify track:', spotifyId);
    }
    
    // Use our robust link opener
    await openInNewTab({ url });
  };

  const handleUnlikeTrack = async (track: SpotifyTrack) => {
    if (!user || !track.spotify_id) return;
    setUnlikingTrackId(track.id);
    try {
      await DuplicateDetectionService.unlikeTrack(track.spotify_id, user.id);
      setTracks(prev => prev.filter(t => t.id !== track.id));
      toast({ title: 'Unliked', description: `"${track.title}" removed from your Spotify library.` });
    } catch (err: unknown) {
      toast({ title: 'Failed to unlike', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setUnlikingTrackId(null);
    }
  };


  // During the token-refresh settle window, keep showing the current rows. The paused run's
  // queries were aborted, so `loading` can still be true from it; the data effect fetches
  // again when the window ends.
  if (loading && !(hasLoaded && !spotifyDataFetchEnabled)) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">Loading tracks...</div>
        </CardContent>
      </Card>
    );
  }

  const totalPages = Math.ceil(totalTracks / tracksPerPage);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            Your Liked Songs ({totalTracks} tracks)
          </span>
          <Button variant="outline" size="sm" asChild>
            <Link to="/duplicates?tab=spotify">
              <Copy className="h-4 w-4 mr-1" />
              Find Duplicates
            </Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <IframeBanner />
        
        {/* Filters Panel */}
        <TrackFilters
          config={{
            search: true,
            dateFilters: true,
            genre: true,
            superGenre: true,
            artist: true
          }}
          state={{
            searchQuery,
            selectedGenre,
            selectedSuperGenre,
            selectedArtist,
            dateFilter,
            noSuperGenre,
            noGenre
          }}
          options={{
            genres,
            superGenres,
            artists
          }}
          callbacks={{
            onSearchChange: setSearchQuery,
            onGenreChange: (value) => {
              setSelectedGenre(value);
              setSelectedArtist(''); // Clear artist filter when genre changes
            },
            onSuperGenreChange: (value) => {
              setSelectedSuperGenre(value);
              setSelectedGenre(''); // Clear genre filter when super genre changes
              setSelectedArtist(''); // Clear artist filter when super genre changes
            },
            onArtistChange: setSelectedArtist,
            onDateFilterChange: setDateFilter,
            onNoSuperGenreChange: setNoSuperGenre,
            onNoGenreChange: setNoGenre,
            onClearFilters: clearFilters,
            onPageChange: setCurrentPage
          }}
          className="mb-4"
        />
        
        {tracks.length > 0 ? (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="min-w-[150px] md:w-[300px] cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('title')}
                  >
                    <div className="flex items-center gap-1">
                      Track
                      {sortField === 'title' && (
                        sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('artist')}
                  >
                    <div className="flex items-center gap-1">
                      Artist
                      {sortField === 'artist' && (
                        sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">Mix</TableHead>
                  <TableHead
                    className="hidden lg:table-cell cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('album')}
                  >
                    <div className="flex items-center gap-1">
                      Album
                      {sortField === 'album' && (
                        sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="hidden md:table-cell cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('super_genre')}
                  >
                    <div className="flex items-center gap-1">
                      Supergenre
                      {sortField === 'super_genre' && (
                        sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="hidden lg:table-cell cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('genre')}
                  >
                    <div className="flex items-center gap-1">
                      Spotify Genre
                      {sortField === 'genre' && (
                        sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="hidden md:table-cell cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('year')}
                  >
                    <div className="flex items-center gap-1">
                      Year
                      {sortField === 'year' && (
                        sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="hidden lg:table-cell cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => handleSort('added_at')}
                  >
                    <div className="flex items-center gap-1">
                      Added to Spotify
                      {sortField === 'added_at' && (
                        sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tracks.map((track) => (
                  <TableRow
                    key={track.id}
                    className={`cursor-pointer ${selectedTrack?.id === track.id ? 'bg-muted' : ''}`}
                    onClick={() => onTrackSelect(track)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1">
                        {track.spotify_id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); handleUnlikeTrack(track); }}
                            disabled={unlikingTrackId === track.id}
                            title="Unlike on Spotify"
                          >
                            {unlikingTrackId === track.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />
                            }
                          </Button>
                        )}
                        <div className="max-w-[160px] md:max-w-[260px] truncate" title={track.title}>
                          {track.title}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[120px] md:max-w-[150px] truncate" title={track.artist}>
                        {track.artist}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {track.mix || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="max-w-[150px] truncate" title={track.album || 'Unknown'}>
                        {track.album || <span className="text-muted-foreground">Unknown</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {track.super_genre ? (
                        <Badge variant="default" className="bg-blue-500/10 text-blue-400 border-blue-500/30">{track.super_genre}</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30">Unmapped</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex items-center gap-2">
                        {track.genre ? (
                          <Badge variant="secondary" className="bg-purple-500/10 text-purple-400 border-purple-500/30">{track.genre}</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30">No Genre</Badge>
                        )}
                        {track.genre && hasOverride(track.genre) && (
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-xs">
                            Overridden
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {track.year || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {track.added_at ? (
                        <span className="text-sm">{format(new Date(track.added_at), 'MMM d, yyyy')}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {track.spotify_id ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
                          asChild
                        >
                          <a
                            href={`https://open.spotify.com/track/${track.spotify_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => handleSpotifyClick(e, track.spotify_id)}
                            title="Open in Spotify (Ctrl+Click for new tab)"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled
                              className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
                              onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>No Spotify link available</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No tracks found. Sync your liked songs to see them here.
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-xs sm:text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </p>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>

                {(() => {
                  const maxVisiblePages = typeof window !== 'undefined' && window.innerWidth < 640 ? 3 : 5;
                  const startPage = Math.max(1, Math.min(currentPage - Math.floor(maxVisiblePages / 2), totalPages - maxVisiblePages + 1));
                  const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

                  return Array.from({ length: endPage - startPage + 1 }, (_, i) => {
                    const page = startPage + i;
                    return (
                      <PaginationItem key={page}>
                        <PaginationLink
                          onClick={() => setCurrentPage(page)}
                          isActive={currentPage === page}
                          className="cursor-pointer"
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  });
                })()}

                <PaginationItem>
                  <PaginationNext
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TracksTable;