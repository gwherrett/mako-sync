import { useState, useEffect, useMemo, useRef } from 'react';
import { MoreHorizontal, ChevronUp, ChevronDown, Filter, X, Edit, Trash2, FileCheck, AlertCircle, Copy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TrackFilters } from '@/components/common/TrackFilters';
import { SUPER_GENRES, DANCE_ALL_VALUE, DANCE_SUPER_GENRES, applySuperGenreFilter } from '@/types/genreMapping';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EditTrackMetadataDialog } from '@/components/EditTrackMetadataDialog';
import { NormalizationService } from '@/services/normalization.service';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/NewAuthContext';
import { withQueryTimeout, type FilterableQuery } from '@/utils/supabaseQuery';

interface LocalTrack {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  super_genre: string | null;
  year: number | null;
  bpm: number | null;
  key: string | null;
  bitrate: number | null;
  file_path: string;
  file_size: number | null;
  last_modified: string | null;
  created_at: string | null;
  hash: string | null;
  rating: number | null;
  play_count: number | null;
  mix: string | null;
  audio_format: string | null;
  sample_rate: number | null;
  duration_seconds: number | null;
}

interface LocalTracksTableProps {
  onTrackSelect: (track: LocalTrack) => void;
  selectedTrack: LocalTrack | null;
  refreshTrigger?: number;
  isActive?: boolean; // For lazy loading - only fetch when tab is active
  isScanInProgress?: boolean; // Suppress fetches while scanner is running
}

const TRACKS_PER_PAGE = 100;

type LocalSortField = 'last_modified' | 'year' | 'artist' | 'title' | 'album' | 'genre' | 'super_genre' | 'bitrate' | 'file_size';

interface LocalTrackFilters {
  searchQuery: string;
  yearFrom: string;
  yearTo: string;
  selectedSuperGenre: string;
  selectedArtist: string;
  selectedAlbum: string;
  selectedGenre: string;
  bitrateFilter: string;
  formatFilter: string;
  missingMetadata: string;
}

// The builder is viewed through FilterableQuery: checking it against the interface as a
// generic constraint makes TypeScript give up (TS2589). The caller gets its own type back.
function applyLocalTrackFilters<Q>(query: Q, f: LocalTrackFilters): Q {
  let q = query as unknown as FilterableQuery;
  if (f.searchQuery.trim()) {
    q = q.or(`title.ilike.%${f.searchQuery}%,artist.ilike.%${f.searchQuery}%,album.ilike.%${f.searchQuery}%,file_path.ilike.%${f.searchQuery}%`);
  }
  if (f.yearFrom) q = q.gte('year', parseInt(f.yearFrom));
  if (f.yearTo) q = q.lte('year', parseInt(f.yearTo));
  q = applySuperGenreFilter(q, f.selectedSuperGenre);
  if (f.selectedArtist) q = q.eq('artist', f.selectedArtist);
  if (f.selectedAlbum) q = q.eq('album', f.selectedAlbum);
  if (f.selectedGenre) q = q.eq('genre', f.selectedGenre);
  if (f.bitrateFilter === 'low') q = q.lt('bitrate', 192);
  else if (f.bitrateFilter === 'medium') q = q.gte('bitrate', 192).lt('bitrate', 320);
  else if (f.bitrateFilter === 'high') q = q.gte('bitrate', 320);
  if (f.formatFilter) q = q.ilike('audio_format', f.formatFilter);
  if (f.missingMetadata === 'title') q = q.is('title', null);
  else if (f.missingMetadata === 'artist') q = q.is('artist', null);
  else if (f.missingMetadata === 'album') q = q.is('album', null);
  else if (f.missingMetadata === 'year') q = q.is('year', null);
  else if (f.missingMetadata === 'genre') q = q.is('genre', null);
  else if (f.missingMetadata === 'any') q = q.or('title.is.null,artist.is.null,album.is.null,year.is.null,genre.is.null');
  return q as unknown as Q;
}

/** `count` is null if the count query failed; `tracks` is null if either query failed. */
interface LocalTracksPage {
  count: number | null;
  tracks: LocalTrack[] | null;
  timedOut: boolean;
}

/**
 * Runs the count query, then the page query. Aborting `cancel` aborts whichever query is in
 * flight (for example when a scan starts) and skips the page query.
 */
async function fetchLocalTracksPage(
  userId: string,
  filters: LocalTrackFilters,
  sortField: LocalSortField,
  sortDirection: 'asc' | 'desc',
  page: number,
  cancel: AbortSignal
): Promise<LocalTracksPage> {
  const countResult = await withQueryTimeout(
    async (signal) => {
      let query = supabase
        .from('local_mp3s')
        .select('*', { count: 'exact' })
        .eq('user_id', userId);
      query = applyLocalTrackFilters(query, filters);
      query = query.range(0, 0);
      return query.abortSignal(AbortSignal.any([signal, cancel]));
    },
    15000,
    'LocalTracksTable:count'
  );

  if (countResult.error) return { count: null, tracks: null, timedOut: countResult.timedOut };
  const count = countResult.data?.count || 0;
  if (cancel.aborted) return { count, tracks: null, timedOut: false };

  const dataResult = await withQueryTimeout(
    async (signal) => {
      let query = supabase
        .from('local_mp3s')
        .select('*')
        .eq('user_id', userId);
      query = applyLocalTrackFilters(query, filters);
      return query
        .order(sortField, { ascending: sortDirection === 'asc' })
        .range((page - 1) * TRACKS_PER_PAGE, page * TRACKS_PER_PAGE - 1)
        .abortSignal(AbortSignal.any([signal, cancel]));
    },
    15000,
    'LocalTracksTable:data'
  );

  if (dataResult.error) return { count, tracks: null, timedOut: dataResult.timedOut };
  return { count, tracks: dataResult.data?.data || [], timedOut: false };
}

interface LocalFilterOptions {
  genres: string[];
  artists: string[];
  albums: string[];
}

async function fetchLocalFilterOptions(userId: string, signal: AbortSignal): Promise<LocalFilterOptions> {
  console.log('🔄 Fetching filter options...');

  // Use database functions to efficiently get distinct values
  const [genresResult, artistsResult, albumsResult] = await Promise.all([
    supabase.rpc('get_distinct_local_genres', { user_uuid: userId }).abortSignal(signal),
    supabase.rpc('get_distinct_local_artists', { user_uuid: userId }).abortSignal(signal),
    supabase.rpc('get_distinct_local_albums', { user_uuid: userId }).abortSignal(signal),
  ]);

  console.log('📊 RPC results:', {
    genres: genresResult,
    artists: artistsResult,
    albums: albumsResult,
  });

  // Extract the strings from the returned objects
  const genres = (genresResult.data || []).map(row => row.genre).filter(Boolean).sort();
  const artists = (artistsResult.data || []).map(row => row.artist).filter(Boolean).sort();
  const albums = (albumsResult.data || []).map(row => row.album).filter(Boolean).sort();

  console.log('🗂️ Filter options loaded:', {
    artists: artists.length,
    albums: albums.length,
    genres: genres.length,
  });
  console.log('🎵 Unique genres found:', genres);

  return { genres, artists, albums };
}

/** Lowercased Spotify genres that map to `superGenre`, from the base map plus the user's overrides. */
async function fetchMappedSpotifyGenres(userId: string, superGenre: string): Promise<string[]> {
  const isDanceAll = superGenre === DANCE_ALL_VALUE;
  let mappingsQuery = supabase
    .from('spotify_genre_map_base')
    .select('spotify_genre');
  mappingsQuery = isDanceAll
    ? mappingsQuery.in('super_genre', DANCE_SUPER_GENRES)
    : mappingsQuery.eq('super_genre', superGenre as Database['public']['Enums']['super_genre']);
  const { data: mappings } = await mappingsQuery;

  let overridesQuery = supabase
    .from('spotify_genre_map_overrides')
    .select('spotify_genre')
    .eq('user_id', userId);
  overridesQuery = isDanceAll
    ? overridesQuery.in('super_genre', DANCE_SUPER_GENRES)
    : overridesQuery.eq('super_genre', superGenre as Database['public']['Enums']['super_genre']);
  const { data: overrides } = await overridesQuery;

  const mappedGenres = new Set<string>();
  mappings?.forEach(m => mappedGenres.add(m.spotify_genre.toLowerCase()));
  overrides?.forEach(o => mappedGenres.add(o.spotify_genre.toLowerCase()));
  return Array.from(mappedGenres);
}

/** Sorted distinct artists of the user's local tracks in `genre`, or null if the query returned no data. */
async function fetchArtistsForGenre(userId: string, genre: string): Promise<string[] | null> {
  const { data } = await supabase
    .from('local_mp3s')
    .select('artist')
    .eq('user_id', userId)
    .eq('genre', genre);
  if (!data) return null;
  return [...new Set(data.map(item => item.artist).filter(Boolean))].sort() as string[];
}

const LocalTracksTable = ({ onTrackSelect, selectedTrack, refreshTrigger, isActive = true, isScanInProgress = false }: LocalTracksTableProps) => {
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalTracks, setTotalTracks] = useState(0);
  const [sortField, setSortField] = useState<'last_modified' | 'year' | 'artist' | 'title' | 'album' | 'genre' | 'super_genre' | 'bitrate' | 'file_size'>('last_modified');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [editingTrack, setEditingTrack] = useState<LocalTrack | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  
  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [yearFrom, setYearFrom] = useState<string>('');
  const [yearTo, setYearTo] = useState<string>('');
  const [selectedSuperGenre, setSelectedSuperGenre] = useState<string>('');
  const [selectedArtist, setSelectedArtist] = useState<string>('');
  const [selectedAlbum, setSelectedAlbum] = useState<string>('');
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [bitrateFilter, setBitrateFilter] = useState<string>('');
  const [formatFilter, setFormatFilter] = useState<string>('');
  const [missingMetadata, setMissingMetadata] = useState<string>('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Filter options. `genres` and `artists` (the cascaded lists) are derived from these below.
  const [allArtists, setAllArtists] = useState<string[]>([]);
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [albums, setAlbums] = useState<string[]>([]);
  
  const tracksPerPage = TRACKS_PER_PAGE;
  const { toast } = useToast();
  const { user, isAuthenticated, loading: authLoading, initialDataReady, dataFetchEnabled } = useAuth();

  const userId = user?.id;

  // Bumped after a metadata save to make the data effect run again
  const [reloadCount, setReloadCount] = useState(0);
  // True once a page of results has been shown
  const [hasLoaded, setHasLoaded] = useState(false);

  // Signed out: show an empty table. Uses the same guards as the data effect, so a
  // token-refresh settle window, an inactive tab or a running scan doesn't clear it.
  const signedOut =
    !authLoading && dataFetchEnabled && isActive && !isScanInProgress && (!isAuthenticated || !userId);
  if (signedOut && (tracks.length > 0 || totalTracks !== 0 || loading)) {
    setTracks([]);
    setTotalTracks(0);
    setLoading(false);
  }

  // Main data fetching effect - consolidated with debounce for text inputs
  // dataFetchEnabled is false during the token-refresh settle window — prevents queries firing
  // into a locked Supabase client. When it transitions back to true, this effect re-runs
  // automatically for "show stale data then auto-refresh" behaviour on tab restore.
  //
  // The cleanup runs when a filter changes, a scan starts or the component unmounts. It cancels
  // the debounce and aborts any in-flight queries, so they stop competing with the scanner's
  // queries on the same connection pool and can't overwrite newer results.
  useEffect(() => {
    // Guard: Wait for auth to be ready, token settle, AND tab to be active
    if (authLoading || !dataFetchEnabled || !isActive) return;
    // Suppress fetches while a scan is running — scanner owns the DB connection
    if (isScanInProgress) return;
    // The signed-out state is cleared during render, above
    if (!isAuthenticated || !userId) return;

    let ignore = false;
    const cancel = new AbortController();
    const filters: LocalTrackFilters = {
      searchQuery,
      yearFrom,
      yearTo,
      selectedSuperGenre,
      selectedArtist,
      selectedAlbum,
      selectedGenre,
      bitrateFilter,
      formatFilter,
      missingMetadata,
    };

    // Debounce all fetches: longer for text input, short batch window for everything else
    const delay = searchQuery || yearFrom || yearTo ? 400 : 150;
    const timeoutId = setTimeout(() => {
      setLoading(true);
      fetchLocalTracksPage(userId, filters, sortField, sortDirection, currentPage, cancel.signal)
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
          console.error('Error loading local tracks:', error);
          setLoading(false);
        });
    }, delay);

    return () => {
      ignore = true;
      clearTimeout(timeoutId);
      cancel.abort();
    };
  }, [authLoading, dataFetchEnabled, isActive, isScanInProgress, isAuthenticated, userId, currentPage, sortField, sortDirection, selectedSuperGenre, selectedArtist, selectedAlbum, selectedGenre, bitrateFilter, formatFilter, missingMetadata, refreshTrigger, reloadCount, searchQuery, yearFrom, yearTo, toast]);

  // Filter options: loaded once per user when the tab is active, and again after each scan
  // (refreshTrigger). Skipped while a scan is running, like the table data.
  const loadedOptionsKey = useRef<string | null>(null);
  useEffect(() => {
    if (authLoading || !dataFetchEnabled || !isActive || !isAuthenticated || !userId) return;
    if (isScanInProgress) return;
    const key = `${userId}:${refreshTrigger ?? 0}`;
    if (loadedOptionsKey.current === key) return;
    loadedOptionsKey.current = key;

    let ignore = false;
    let finished = false;
    const cancel = new AbortController();
    fetchLocalFilterOptions(userId, cancel.signal)
      .then((options) => {
        if (ignore) return;
        setAllGenres(options.genres);
        setAllArtists(options.artists);
        setAlbums(options.albums);
      })
      .catch((error) => {
        if (!ignore) console.error('💥 Error fetching filter options:', error);
      })
      .finally(() => {
        finished = true;
      });

    return () => {
      ignore = true;
      cancel.abort();
      // Cut short before it finished, so let the next run fetch again
      if (!finished && loadedOptionsKey.current === key) loadedOptionsKey.current = null;
    };
  }, [authLoading, dataFetchEnabled, isActive, isAuthenticated, userId, isScanInProgress, refreshTrigger]);

  // Cascade: Supergenre → Genre filtering
  // Fetches the Spotify genres that map to the selected supergenre. The local genre list is
  // filtered against them during render, below.
  const [superGenreMapping, setSuperGenreMapping] = useState<{ superGenre: string; mappedGenres: string[] | null } | null>(null);
  useEffect(() => {
    if (!userId || !isAuthenticated || !initialDataReady || !selectedSuperGenre) return;
    let ignore = false;
    fetchMappedSpotifyGenres(userId, selectedSuperGenre)
      .then((mappedGenres) => {
        if (!ignore) setSuperGenreMapping({ superGenre: selectedSuperGenre, mappedGenres });
      })
      .catch((error) => {
        if (ignore) return;
        console.error('Error filtering genres by supergenre:', error);
        setSuperGenreMapping({ superGenre: selectedSuperGenre, mappedGenres: null });
      });
    return () => {
      ignore = true;
    };
  }, [selectedSuperGenre, userId, isAuthenticated, initialDataReady]);

  // All genres when no supergenre is selected, or until its mapping has loaded
  const genres = useMemo(() => {
    if (!selectedSuperGenre || superGenreMapping?.superGenre !== selectedSuperGenre || !superGenreMapping.mappedGenres) {
      return allGenres;
    }
    const mappedGenres = superGenreMapping.mappedGenres;
    // Keep local genres that match any mapped genre (case-insensitive partial match)
    const filteredGenres = allGenres.filter(localGenre => {
      const localLower = localGenre.toLowerCase();
      return mappedGenres.some(mapped =>
        localLower.includes(mapped) || mapped.includes(localLower) || localLower === mapped
      );
    });
    return filteredGenres.length > 0 ? filteredGenres : allGenres;
  }, [allGenres, selectedSuperGenre, superGenreMapping]);

  // Cascade: Genre → Artist filtering
  const [genreArtists, setGenreArtists] = useState<{ genre: string; artists: string[] } | null>(null);
  useEffect(() => {
    if (!userId || !isAuthenticated || !initialDataReady || !selectedGenre) return;
    let ignore = false;
    fetchArtistsForGenre(userId, selectedGenre)
      .then((found) => {
        if (!ignore && found) setGenreArtists({ genre: selectedGenre, artists: found });
      })
      .catch((error) => {
        if (!ignore) console.error('Error fetching filtered artists:', error);
      });
    return () => {
      ignore = true;
    };
  }, [selectedGenre, userId, isAuthenticated, initialDataReady]);

  // All artists when no genre is selected, or until the genre's artists have loaded
  const artists = selectedGenre && genreArtists?.genre === selectedGenre ? genreArtists.artists : allArtists;

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const getMissingMetadataCount = (track: LocalTrack) => {
    const fields = [track.title, track.artist, track.album, track.year, track.genre];
    return fields.filter(field => !field).length;
  };

  const clearFilters = () => {
    setSearchQuery('');
    setYearFrom('');
    setYearTo('');
    setSelectedSuperGenre('');
    setSelectedArtist('');
    setSelectedAlbum('');
    setSelectedGenre('');
    setBitrateFilter('');
    setFormatFilter('');
    setMissingMetadata('');
    setCurrentPage(1);
  };

  const handleSort = (field: 'year' | 'artist' | 'last_modified' | 'title' | 'album' | 'genre' | 'super_genre' | 'bitrate' | 'file_size') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const handleSelectTrack = (trackId: string) => {
    const newSelection = new Set(selectedTracks);
    if (newSelection.has(trackId)) {
      newSelection.delete(trackId);
    } else {
      newSelection.add(trackId);
    }
    setSelectedTracks(newSelection);
  };

  const handleSelectAll = () => {
    if (selectedTracks.size === tracks.length) {
      setSelectedTracks(new Set());
    } else {
      setSelectedTracks(new Set(tracks.map(t => t.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedTracks.size === 0) return;

    try {
      const { error } = await supabase
        .from('local_mp3s')
        .delete()
        .in('id', Array.from(selectedTracks));

      if (error) throw error;

      toast({
        title: "Success",
        description: `Deleted ${selectedTracks.size} tracks`,
      });

      setSelectedTracks(new Set());
      // Reset to page 1 after deletion so active filters still return results
      // (deleted items may have been the only content on the current page)
      setCurrentPage(1);
    } catch (error) {
      console.error('Error deleting tracks:', error);
      toast({
        title: "Error",
        description: "Failed to delete tracks",
        variant: "destructive",
      });
    }
  };

  const handleEditMetadata = (track: LocalTrack) => {
    setEditingTrack(track);
    setEditDialogOpen(true);
  };

  const handleSaveMetadata = async (trackId: string, updates: Partial<LocalTrack>) => {
    try {
      // Use normalization service to compute derived fields
      const normService = new NormalizationService();
      const normalized = normService.processMetadata(
        updates.title || null,
        updates.artist || null
      );

      const updateData = {
        ...updates,
        normalized_title: normalized.normalizedTitle || null,
        normalized_artist: normalized.normalizedArtist || null,
        core_title: normalized.coreTitle || null,
        primary_artist: normalized.primaryArtist || null,
        featured_artists: normalized.featuredArtists.length > 0 ? normalized.featuredArtists : null,
      };

      const { error } = await supabase
        .from('local_mp3s')
        .update(updateData)
        .eq('id', trackId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Track metadata updated",
      });

      // Refresh the table
      setReloadCount((n) => n + 1);
    } catch (error) {
      console.error('Error updating track metadata:', error);
      toast({
        title: "Error",
        description: "Failed to update track metadata",
        variant: "destructive",
      });
      throw error; // Re-throw so dialog knows save failed
    }
  };

  // While fetches are paused (a scan is running, or the token-refresh settle window), keep
  // showing the current rows. The paused run's queries were aborted, so `loading` can still be
  // true from it; the data effect fetches again when the pause ends.
  const fetchesPaused = isScanInProgress || !dataFetchEnabled;
  if (loading && !(hasLoaded && fetchesPaused)) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">Loading local tracks...</div>
        </CardContent>
      </Card>
    );
  }

  const totalPages = Math.ceil(totalTracks / tracksPerPage);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Local Library ({totalTracks} tracks)</span>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" asChild>
              <Link to="/duplicates">
                <Copy className="h-4 w-4 mr-1" />
                Find Duplicates
              </Link>
            </Button>
            {selectedTracks.size > 0 && (
              <>
                <Badge variant="secondary">{selectedTracks.size} selected</Badge>
                <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete Selected
                </Button>
              </>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Common Filters */}
        <TrackFilters
          config={{
            search: true,
            dateFilters: false,
            superGenre: true,
            genre: true,
            artist: true,
            superGenreLabel: "All Supergenres",
            genreLabel: "All Genres"
          }}
          state={{
            searchQuery,
            selectedGenre,
            selectedSuperGenre,
            selectedArtist,
            dateFilter: '',
            noSuperGenre: false
          }}
          options={{
            genres,
            superGenres: [...SUPER_GENRES].sort(),
            artists
          }}
          callbacks={{
            onSearchChange: setSearchQuery,
            onGenreChange: (value) => {
              setSelectedGenre(value);
              setSelectedArtist(''); // Clear artist when genre changes
            },
            onSuperGenreChange: (value) => {
              setSelectedSuperGenre(value);
              setSelectedGenre(''); // Clear genre when supergenre changes
              setSelectedArtist(''); // Clear artist when supergenre changes
            },
            onArtistChange: setSelectedArtist,
            onDateFilterChange: () => {},
            onNoSuperGenreChange: () => {},
            onClearFilters: () => {
              setSearchQuery('');
              setSelectedSuperGenre('');
              setSelectedGenre('');
              setSelectedArtist('');
            },
            onPageChange: setCurrentPage
          }}
          className="mb-4"
        />

        {/* Local Track Filters */}
        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen} className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-2" />
                Advanced Filters
                {filtersOpen ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
              </Button>
            </CollapsibleTrigger>
            {(yearFrom || yearTo || selectedAlbum || bitrateFilter || formatFilter || missingMetadata) && (
              <Button variant="ghost" size="sm" onClick={() => {
                setYearFrom('');
                setYearTo('');
                setSelectedAlbum('');
                setBitrateFilter('');
                setFormatFilter('');
                setMissingMetadata('');
                setCurrentPage(1);
              }}>
                <X className="h-4 w-4 mr-1" />
                Clear Advanced
              </Button>
            )}
            {(searchQuery || yearFrom || yearTo || selectedArtist || selectedAlbum || selectedGenre || bitrateFilter || formatFilter || missingMetadata) && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            )}
          </div>
          
          <CollapsibleContent className="space-y-4">
            {/* Advanced Filters Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Year Range */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Year Range</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="From"
                    type="number"
                    value={yearFrom}
                    onChange={(e) => setYearFrom(e.target.value)}
                    min="1900"
                    max="2024"
                  />
                  <Input
                    placeholder="To"
                    type="number"
                    value={yearTo}
                    onChange={(e) => setYearTo(e.target.value)}
                    min="1900"
                    max="2024"
                  />
                </div>
              </div>
              
              {/* Album Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Album</label>
                <Select value={selectedAlbum || 'all'} onValueChange={(value) => setSelectedAlbum(value === 'all' ? '' : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All albums" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All albums</SelectItem>
                    {albums.slice(0, 50).map((album) => (
                      <SelectItem key={album} value={album}>
                        {album}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Bitrate Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Bitrate</label>
                <Select value={bitrateFilter || 'all'} onValueChange={(value) => setBitrateFilter(value === 'all' ? '' : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All bitrates" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All bitrates</SelectItem>
                    <SelectItem value="low">Low (&lt; 192 kbps)</SelectItem>
                    <SelectItem value="medium">Medium (192-320 kbps)</SelectItem>
                    <SelectItem value="high">High (320+ kbps)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Format Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Format</label>
                <Select value={formatFilter || 'all'} onValueChange={(value) => { setFormatFilter(value === 'all' ? '' : value); setCurrentPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="All formats" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All formats</SelectItem>
                    <SelectItem value="mp3">MP3</SelectItem>
                    <SelectItem value="flac">FLAC</SelectItem>
                    <SelectItem value="m4a">M4A</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Missing Metadata Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Missing Metadata</label>
                <Select value={missingMetadata || 'all'} onValueChange={(value) => setMissingMetadata(value === 'all' ? '' : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All tracks" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tracks</SelectItem>
                    <SelectItem value="any">Missing any metadata</SelectItem>
                    <SelectItem value="title">Missing title</SelectItem>
                    <SelectItem value="artist">Missing artist</SelectItem>
                    <SelectItem value="album">Missing album</SelectItem>
                    <SelectItem value="year">Missing year</SelectItem>
                    <SelectItem value="genre">Missing genre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={selectedTracks.size === tracks.length && tracks.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead
                  className="min-w-[150px] md:w-[250px] cursor-pointer hover:bg-muted/50 select-none"
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
                <TableHead className="hidden xl:table-cell">Mix</TableHead>
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
                  onClick={() => handleSort('genre')}
                >
                  <div className="flex items-center gap-1">
                    Genre
                    {sortField === 'genre' && (
                      sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead
                  className="hidden md:table-cell cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('super_genre')}
                >
                  <div className="flex items-center gap-1">
                    SuperGenre
                    {sortField === 'super_genre' && (
                      sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead
                  className="hidden xl:table-cell cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('bitrate')}
                >
                  <div className="flex items-center gap-1">
                    Bitrate
                    {sortField === 'bitrate' && (
                      sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="hidden xl:table-cell">Format</TableHead>
                <TableHead
                  className="hidden xl:table-cell cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('file_size')}
                >
                  <div className="flex items-center gap-1">
                    Size
                    {sortField === 'file_size' && (
                      sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="hidden lg:table-cell min-w-[110px]">Status</TableHead>
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
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedTracks.has(track.id)}
                      onCheckedChange={() => handleSelectTrack(track.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="max-w-[180px] md:max-w-[230px] truncate" title={track.title || track.file_path}>
                      {track.title || <span className="text-muted-foreground">No title</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground/40 max-w-[180px] md:max-w-[230px] truncate mt-0.5" title={track.file_path}>
                      {track.file_path.split('/').pop()}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[120px] md:max-w-[150px] truncate" title={track.artist || 'Unknown'}>
                      {track.artist || <span className="text-muted-foreground">Unknown</span>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {track.mix || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="max-w-[150px] truncate" title={track.album || 'Unknown'}>
                      {track.album || <span className="text-muted-foreground">Unknown</span>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {track.genre || <span className="text-muted-foreground">Unknown</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {track.super_genre || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {track.bitrate ? (
                      <span className="text-sm">
                        {track.audio_format?.toLowerCase() === 'flac' ? 'lossless' : `${track.bitrate} kbps`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {track.audio_format ? (
                      <Badge
                        variant="outline"
                        className={
                          track.audio_format.toLowerCase() === 'flac'
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                            : track.audio_format.toLowerCase() === 'm4a'
                            ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {track.audio_format.toUpperCase()}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {formatFileSize(track.file_size)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell whitespace-nowrap min-w-[110px]">
                    {getMissingMetadataCount(track) === 0 ? (
                      <Badge variant="default" className="bg-green-500/10 text-green-400 border-green-500/30">
                        <FileCheck className="h-3 w-3 mr-1" />
                        Complete
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {getMissingMetadataCount(track)} missing
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation();
                          handleEditMetadata(track);
                        }}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit Metadata
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remove from Library
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        {tracks.length === 0 && !loading && (
          <div className="text-center py-8 text-muted-foreground">
            No local tracks found. Scan your local library to see tracks here.
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

        <EditTrackMetadataDialog
          track={editingTrack}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSave={handleSaveMetadata}
        />
      </CardContent>
    </Card>
  );
};

export default LocalTracksTable;
