import React, { useState, useEffect } from 'react';
import { ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/NewAuthContext';
import { useUnifiedSpotifyAuth } from '@/hooks/useUnifiedSpotifyAuth';
import { IframeBanner } from '@/components/common/IframeBanner';
import { openInNewTab, copyToClipboard } from '@/utils/linkUtils';
import { useGenreMappingOverrides } from '@/hooks/useGenreMappingOverrides';
import { withQueryTimeout } from '@/utils/supabaseQuery';

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

  const tracksPerPage = 50;
  const { toast } = useToast();
  const { user, isAuthenticated, loading: authLoading, initialDataReady } = useAuth();
  const { isInitialCheckComplete: spotifyCheckComplete } = useUnifiedSpotifyAuth();
  const { hasOverride } = useGenreMappingOverrides();

  // Compute effective filters (shared takes precedence, local adds to it)
  const effectiveSearchQuery = sharedSearchQuery || searchQuery;
  const effectiveSuperGenre = sharedSuperGenre || selectedSuperGenre;

  // Reset to page 1 when shared filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [sharedSearchQuery, sharedSuperGenre]);

  // Consolidated fetch effect - debounces search, immediate for other filters
  // Wait for initialDataReady AND Spotify connection check to prevent concurrent request deadlock
  useEffect(() => {
    if (authLoading || !initialDataReady || !spotifyCheckComplete) return;
    if (!isAuthenticated || !user) {
      setTracks([]);
      setTotalTracks(0);
      setLoading(false);
      return;
    }

    // Debounce only for search query changes
    const timeoutId = setTimeout(() => {
      fetchTracks();
    }, effectiveSearchQuery ? 300 : 0);

    return () => clearTimeout(timeoutId);
  }, [authLoading, initialDataReady, spotifyCheckComplete, isAuthenticated, user?.id, currentPage, sortField, sortDirection, selectedArtist, selectedGenre, effectiveSuperGenre, dateFilter, noSuperGenre, noGenre, effectiveSearchQuery]);

  // Separate useEffect for filter options that updates when genre changes
  useEffect(() => {
    if (authLoading || !initialDataReady || !spotifyCheckComplete || !isAuthenticated || !user) return;
    fetchFilterOptions();
  }, [authLoading, initialDataReady, spotifyCheckComplete, isAuthenticated, user?.id, selectedGenre, effectiveSuperGenre]);

  // Subscribe to sync_progress to refresh when sync completes
  useEffect(() => {
    if (!user || !isAuthenticated) return;

    const channel = supabase
      .channel('tracks-sync-refresh')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sync_progress',
          filter: `user_id=eq.${user.id}`
        },
        (payload: any) => {
          // Refresh tracks when sync completes
          if (payload.new?.status === 'completed') {
            fetchTracks();
            fetchFilterOptions();
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [user?.id, isAuthenticated]);


  const fetchTracks = async () => {
    if (!user) return;
    
    setLoading(true);
    
    // Build filter function for reuse (uses effective filters that combine shared + local)
    const applyFilters = (query: any) => {
      if (effectiveSearchQuery.trim()) {
        query = query.or(`title.ilike.%${effectiveSearchQuery}%,artist.ilike.%${effectiveSearchQuery}%`);
      }
      if (selectedGenre) query = query.eq('genre', selectedGenre);
      if (noGenre) query = query.is('genre', null);
      if (noSuperGenre) query = query.is('super_genre', null);
      if (effectiveSuperGenre) query = query.eq('super_genre', effectiveSuperGenre as any);
      if (selectedArtist) query = query.eq('artist', selectedArtist);
      if (dateFilter === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        query = query.gte('added_at', weekAgo.toISOString());
      } else if (dateFilter === 'month') {
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        query = query.gte('added_at', monthAgo.toISOString());
      }
      return query;
    };

    // Count query with timeout
    const countResult = await withQueryTimeout(
      async (signal) => {
        let query = supabase
          .from('spotify_liked')
          .select('*', { count: 'exact' })
          .eq('user_id', user.id);
        query = applyFilters(query);
        query = query.range(0, 0);
        return query.abortSignal(signal);
      },
      15000,
      'TracksTable:count'
    );

    if (countResult.error) {
      if (countResult.timedOut) {
        toast({
          title: "Query Timeout",
          description: "The request took too long. Please try again.",
          variant: "destructive",
        });
      }
      setLoading(false);
      return;
    }

    setTotalTracks(countResult.data?.count || 0);

    // Data query with timeout
    const dataResult = await withQueryTimeout(
      async (signal) => {
        let query = supabase
          .from('spotify_liked')
          .select('*')
          .eq('user_id', user.id);
        query = applyFilters(query);
        return query
          .order(sortField, { ascending: sortDirection === 'asc' })
          .range((currentPage - 1) * tracksPerPage, currentPage * tracksPerPage - 1)
          .abortSignal(signal);
      },
      15000,
      'TracksTable:data'
    );

    if (dataResult.error) {
      if (dataResult.timedOut) {
        toast({
          title: "Query Timeout",
          description: "The request took too long. Please try again.",
          variant: "destructive",
        });
      }
      setLoading(false);
      return;
    }

    setTracks(dataResult.data?.data || []);
    setLoading(false);
  };

  const fetchFilterOptions = async () => {
    if (!user) return;

    const userId = user.id;
    
    // Get unique artists with timeout protection
    const artistResult = await withQueryTimeout(
      async (signal) => {
        let query = supabase
          .from('spotify_liked')
          .select('artist')
          .eq('user_id', userId)
          .not('artist', 'is', null);
        
        if (selectedGenre) {
          query = query.eq('genre', selectedGenre);
        }
        
        if (noSuperGenre) {
          query = query.is('super_genre', null);
        } else if (effectiveSuperGenre) {
          query = query.eq('super_genre', effectiveSuperGenre as any);
        }

        return query.abortSignal(signal);
      },
      10000,
      'TracksTable:filterOptions:artists'
    );
    
    if (artistResult.data?.data) {
      const uniqueArtists = [...new Set(artistResult.data.data.map(item => item.artist))].sort();
      setArtists(uniqueArtists);
    }

    // Get unique genres with timeout protection
    const genreResult = await withQueryTimeout(
      async (signal) => {
        let query = supabase
          .from('spotify_liked')
          .select('genre')
          .eq('user_id', userId)
          .not('genre', 'is', null);

        if (noSuperGenre) {
          query = query.is('super_genre', null);
        } else if (effectiveSuperGenre) {
          query = query.eq('super_genre', effectiveSuperGenre as any);
        }

        return query.abortSignal(signal);
      },
      10000,
      'TracksTable:filterOptions:genres'
    );
    
    if (genreResult.data?.data) {
      const uniqueGenres = [...new Set(genreResult.data.data.map(item => item.genre))].sort();
      setGenres(uniqueGenres);
    }

    // Get unique super genres with timeout protection
    const superGenreResult = await withQueryTimeout(
      async (signal) => {
        return supabase
          .from('spotify_liked')
          .select('super_genre')
          .eq('user_id', userId)
          .not('super_genre', 'is', null)
          .abortSignal(signal);
      },
      10000,
      'TracksTable:filterOptions:superGenres'
    );
    
    if (superGenreResult.data?.data) {
      const uniqueSuperGenres = [...new Set(superGenreResult.data.data.map(item => item.super_genre))].sort();
      setSuperGenres(uniqueSuperGenres);
    }
  };

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

  const handleCopySpotifyLink = async (spotifyId: string) => {
    const url = `https://open.spotify.com/track/${spotifyId}`;
    const success = await copyToClipboard(url);
    
    if (success) {
      toast({
        title: "Link Copied",
        description: "Spotify link copied to clipboard!",
      });
    }
  };


  if (loading) {
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
                    className="hidden md:table-cell cursor-pointer hover:bg-muted/50 select-none"
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
                    className="cursor-pointer hover:bg-muted/50 select-none"
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
                      <div className="max-w-[180px] md:max-w-[280px] truncate" title={track.title}>
                        {track.title}
                      </div>
                      {/* Show artist below title on mobile since Artist column is hidden */}
                      <div className="md:hidden text-xs text-muted-foreground truncate max-w-[180px]" title={track.artist}>
                        {track.artist}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="max-w-[150px] truncate" title={track.artist}>
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
                    <TableCell>
                      {track.super_genre ? (
                        <Badge variant="default" className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-xs md:text-sm">{track.super_genre}</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-gray-500/10 text-gray-400 border-gray-500/30 text-xs md:text-sm">Unmapped</Badge>
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
                        <div className="flex items-center gap-1">
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
                          <Button
                            variant="ghost"
                            size="sm"
                            className="hidden sm:inline-flex"
                            onClick={() => handleCopySpotifyLink(track.spotify_id)}
                            title="Copy Spotify link"
                          >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                              <path d="M4 16c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2"/>
                            </svg>
                          </Button>
                        </div>
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