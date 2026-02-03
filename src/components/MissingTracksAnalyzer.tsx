import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Download, Music, Users, Filter, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { TrackMatchingService } from '@/services/trackMatching.service';
import { supabase } from '@/integrations/supabase/client';
import { useSlskdConfig } from '@/hooks/useSlskdConfig';
import { useSlskdSync } from '@/hooks/useSlskdSync';
import { SlskdSyncProgress } from '@/components/SlskdSyncProgress';
import type { SlskdTrackToSync } from '@/types/slskd';

interface MissingTracksAnalyzerProps {
  selectedGenre: string;
  setSelectedGenre: (genre: string) => void;
  superGenres: string[];
  sharedSearchQuery?: string;
}

interface MissingTrack {
  spotifyTrack: {
    id: string;
    title: string;
    artist: string;
    album: string | null;
    genre: string | null;
    super_genre: string | null;
  };
  reason: string;
}

interface ArtistGroup {
  artist: string;
  tracks: MissingTrack[];
  genres: string[];
}

const MissingTracksAnalyzer: React.FC<MissingTracksAnalyzerProps> = ({
  selectedGenre,
  setSelectedGenre,
  superGenres,
  sharedSearchQuery = ''
}) => {
  const [missingTracks, setMissingTracks] = useState<MissingTrack[]>([]);
  const [artistGroups, setArtistGroups] = useState<ArtistGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const { toast } = useToast();

  // slskd integration state
  const [selectedArtists, setSelectedArtists] = useState<Set<string>>(new Set());
  const [showSyncModal, setShowSyncModal] = useState(false);
  const { isConfigured } = useSlskdConfig();
  const { syncToSlskd, isSyncing, syncResult, progress, reset } = useSlskdSync();

  // Cascading filter state: supergenre -> genre -> artist
  const [genreFilter, setGenreFilter] = useState<string>('all');
  const [artistFilter, setArtistFilter] = useState<string>('all');

  // Pre-loaded filter options from Spotify library (before analysis)
  const [availableGenres, setAvailableGenres] = useState<string[]>([]);
  const [availableArtists, setAvailableArtists] = useState<string[]>([]);
  const [isLoadingFilters, setIsLoadingFilters] = useState(false);

  // Load available genres and artists from Spotify library based on supergenre filter
  useEffect(() => {
    const loadFilterOptions = async () => {
      if (!user) return;

      setIsLoadingFilters(true);
      try {
        // Build query for genres
        let genreQuery = supabase
          .from('spotify_liked')
          .select('genre')
          .eq('user_id', user.id)
          .not('genre', 'is', null);

        if (selectedGenre !== 'all') {
          genreQuery = genreQuery.eq('super_genre', selectedGenre);
        }

        const { data: genreData } = await genreQuery.limit(50000);
        const genres = [...new Set(genreData?.map(d => d.genre).filter(Boolean) || [])].sort();
        setAvailableGenres(genres as string[]);

        // Build query for artists based on selected genre
        let artistQuery = supabase
          .from('spotify_liked')
          .select('artist')
          .eq('user_id', user.id);

        if (selectedGenre !== 'all') {
          artistQuery = artistQuery.eq('super_genre', selectedGenre);
        }
        if (genreFilter !== 'all') {
          artistQuery = artistQuery.eq('genre', genreFilter);
        }

        const { data: artistData } = await artistQuery.limit(50000);
        const artists = [...new Set(artistData?.map(d => d.artist).filter(Boolean) || [])].sort();
        setAvailableArtists(artists as string[]);
      } catch (error) {
        console.error('Error loading filter options:', error);
      } finally {
        setIsLoadingFilters(false);
      }
    };

    loadFilterOptions();
  }, [user, selectedGenre, genreFilter]);

  // Reset dependent filters when parent filter changes
  useEffect(() => {
    // When supergenre changes, reset genre and artist filters
    setGenreFilter('all');
    setArtistFilter('all');
  }, [selectedGenre]);

  useEffect(() => {
    // When genre changes, reset artist filter
    setArtistFilter('all');
  }, [genreFilter]);

  // Filter artist groups based on search query only (cascading filters are applied at query level)
  const filteredArtistGroups = artistGroups
    .filter(group => {
      // Search query filter
      if (!sharedSearchQuery) return true;
      const searchLower = sharedSearchQuery.toLowerCase();
      if (group.artist.toLowerCase().includes(searchLower)) return true;
      return group.tracks.some(track =>
        track.spotifyTrack.title.toLowerCase().includes(searchLower) ||
        (track.spotifyTrack.album?.toLowerCase().includes(searchLower))
      );
    });

  // Count filtered tracks
  const filteredMissingTracks = filteredArtistGroups.flatMap(g => g.tracks);

  // Calculate selected track count based on selected artists
  const selectedTrackCount = Array.from(selectedArtists).reduce(
    (count, artist) => {
      const group = artistGroups.find(g => g.artist === artist);
      return count + (group?.tracks.length || 0);
    },
    0
  );

  // Artist selection handlers
  const toggleArtist = (artist: string) => {
    setSelectedArtists(prev => {
      const next = new Set(prev);
      if (next.has(artist)) {
        next.delete(artist);
      } else {
        next.add(artist);
      }
      return next;
    });
  };

  const selectAllArtists = () => {
    setSelectedArtists(new Set(filteredArtistGroups.map(g => g.artist)));
  };

  const deselectAllArtists = () => {
    setSelectedArtists(new Set());
  };

  // Push selected artists' tracks to slskd
  const handlePushToSlskd = () => {
    const tracksToSync: SlskdTrackToSync[] = Array.from(selectedArtists).flatMap(artist => {
      const group = artistGroups.find(g => g.artist === artist);
      if (!group) return [];
      return group.tracks.map(track => ({
        id: track.spotifyTrack.id,
        title: track.spotifyTrack.title,
        artist: track.spotifyTrack.artist,
        // Use the full artist as primary since we don't have a separate primary_artist field
        primary_artist: track.spotifyTrack.artist,
      }));
    });

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

  // Close sync modal and reset state
  const handleCloseSyncModal = () => {
    setShowSyncModal(false);
    reset();
  };

  // Get user on mount
  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    
    loadUser();
  }, []);

  // Group tracks by artist
  const groupByArtist = (tracks: MissingTrack[]): ArtistGroup[] => {
    const groups = tracks.reduce((acc, track) => {
      const artist = track.spotifyTrack.artist;
      if (!acc[artist]) {
        acc[artist] = {
          artist,
          tracks: [],
          genres: new Set<string>()
        };
      }
      acc[artist].tracks.push(track);
      if (track.spotifyTrack.genre) {
        acc[artist].genres.add(track.spotifyTrack.genre);
      }
      if (track.spotifyTrack.super_genre) {
        acc[artist].genres.add(track.spotifyTrack.super_genre);
      }
      return acc;
    }, {} as Record<string, { artist: string; tracks: MissingTrack[]; genres: Set<string> }>);

    return Object.values(groups)
      .map(group => ({
        ...group,
        genres: Array.from(group.genres)
      }))
      .sort((a, b) => b.tracks.length - a.tracks.length);
  };

  const analyzeMissingTracks = async () => {
    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please sign in to analyze missing tracks.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      console.log('🔍 Starting missing tracks analysis...');
      // Pass all filter criteria to the matching service
      const missing = await TrackMatchingService.findMissingTracks(
        user.id,
        selectedGenre,
        genreFilter,
        artistFilter
      );

      setMissingTracks(missing);
      setArtistGroups(groupByArtist(missing));
      setSelectedArtists(new Set());

      // Build description of applied filters
      const filterParts = [];
      if (selectedGenre !== 'all') filterParts.push(selectedGenre);
      if (genreFilter !== 'all') filterParts.push(genreFilter);
      if (artistFilter !== 'all') filterParts.push(artistFilter);
      const genreText = filterParts.length > 0 ? filterParts.join(' → ') : 'collection';
      toast({
        title: "Analysis Complete",
        description: `Found ${missing.length} tracks missing from your local ${genreText}.`,
      });

      console.log(`✅ Analysis complete: ${missing.length} missing tracks found`);
    } catch (error: any) {
      console.error('❌ Analysis error:', error);
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze missing tracks.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const exportToCSV = () => {
    if (artistGroups.length === 0) return;

    const rows: string[] = [
      ['Artist', 'Track Count', 'Track Title', 'Album', 'Spotify Genre', 'Supergenre'].join(',')
    ];

    // Export grouped by artist
    artistGroups.forEach(group => {
      // First row for artist shows artist name and track count
      rows.push([
        `"${group.artist}"`,
        group.tracks.length.toString(),
        `"${group.tracks[0].spotifyTrack.title}"`,
        `"${group.tracks[0].spotifyTrack.album || ''}"`,
        `"${group.tracks[0].spotifyTrack.genre || ''}"`,
        `"${group.tracks[0].spotifyTrack.super_genre || ''}"`,
      ].join(','));

      // Remaining tracks for this artist (skip first track, already added)
      group.tracks.slice(1).forEach(track => {
        rows.push([
          '""', // Empty artist cell for grouped rows
          '""', // Empty count cell for grouped rows
          `"${track.spotifyTrack.title}"`,
          `"${track.spotifyTrack.album || ''}"`,
          `"${track.spotifyTrack.genre || ''}"`,
          `"${track.spotifyTrack.super_genre || ''}"`,
        ].join(','));
      });
    });

    const csvContent = rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `missing-tracks-by-artist-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Music className="h-5 w-5" />
            Missing Tracks Analysis
          </CardTitle>
          <CardDescription>
            Compare your Spotify library to local files. Select artists and push missing tracks to Slskd for wishlist searches.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Cascading Filters: Supergenre -> Genre -> Artist */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>

            {/* Supergenre Filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Supergenre:</span>
              <Select value={selectedGenre} onValueChange={setSelectedGenre}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({superGenres.length})</SelectItem>
                  {superGenres.map((genre) => (
                    <SelectItem key={genre} value={genre}>
                      {genre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Genre Filter (filtered by supergenre) */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Genre:</span>
              <Select
                value={genreFilter}
                onValueChange={setGenreFilter}
                disabled={isLoadingFilters}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({availableGenres.length})</SelectItem>
                  {availableGenres.map((genre) => (
                    <SelectItem key={genre} value={genre}>
                      {genre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Artist Filter (filtered by genre) */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Artist:</span>
              <Select
                value={artistFilter}
                onValueChange={setArtistFilter}
                disabled={isLoadingFilters}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({availableArtists.length})</SelectItem>
                  {availableArtists.map((artist) => (
                    <SelectItem key={artist} value={artist}>
                      {artist}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Clear Filters */}
            {(selectedGenre !== 'all' || genreFilter !== 'all' || artistFilter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedGenre('all');
                  setGenreFilter('all');
                  setArtistFilter('all');
                }}
              >
                Clear All
              </Button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4">
            <Button
              onClick={analyzeMissingTracks}
              disabled={isLoading}
              className="bg-primary hover:bg-primary/90"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                'Analyze Missing Tracks'
              )}
            </Button>

            {missingTracks.length > 0 && (
              <Button
                onClick={exportToCSV}
                variant="outline"
                className="flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {missingTracks.length > 0 && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Missing Tracks</p>
                    <p className="text-2xl font-bold text-primary">
                      {filteredMissingTracks.length}
                      {filteredMissingTracks.length !== missingTracks.length && (
                        <span className="text-sm font-normal text-muted-foreground ml-1">
                          / {missingTracks.length}
                        </span>
                      )}
                    </p>
                  </div>
                  <Music className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Artists</p>
                    <p className="text-2xl font-bold text-primary">
                      {filteredArtistGroups.length}
                      {filteredArtistGroups.length !== artistGroups.length && (
                        <span className="text-sm font-normal text-muted-foreground ml-1">
                          / {artistGroups.length}
                        </span>
                      )}
                    </p>
                  </div>
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Top Artist</p>
                    <p className="text-lg font-semibold text-primary truncate">
                      {filteredArtistGroups[0]?.artist || 'N/A'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {filteredArtistGroups[0]?.tracks.length || 0} tracks
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Artist Groups */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Missing Tracks by Artist</CardTitle>
                  <CardDescription>
                    Artists with tracks missing from your local collection
                    {sharedSearchQuery && ` (filtered by "${sharedSearchQuery}")`}
                  </CardDescription>
                </div>
                {isConfigured && (
                  <div className="flex items-center gap-2">
                    {selectedArtists.size > 0 && (
                      <Badge variant="secondary">
                        {selectedArtists.size} artist{selectedArtists.size !== 1 ? 's' : ''} ({selectedTrackCount} track{selectedTrackCount !== 1 ? 's' : ''})
                      </Badge>
                    )}
                    <Button
                      onClick={handlePushToSlskd}
                      disabled={selectedArtists.size === 0 || isSyncing}
                      size="sm"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      Push to slskd
                    </Button>
                  </div>
                )}
              </div>
              {/* Selection controls */}
              {isConfigured && filteredArtistGroups.length > 0 && (
                <div className="flex items-center gap-4 mt-3 pt-3 border-t">
                  <span className="text-sm text-muted-foreground">Select artists:</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectAllArtists}
                    disabled={selectedArtists.size === filteredArtistGroups.length}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={deselectAllArtists}
                    disabled={selectedArtists.size === 0}
                  >
                    Deselect All
                  </Button>
                </div>
              )}
              {!isConfigured && filteredArtistGroups.length > 0 && (
                <p className="text-sm text-muted-foreground mt-3 pt-3 border-t">
                  Configure slskd in Settings → Security to enable pushing tracks to wishlist.
                </p>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {filteredArtistGroups.map((group) => (
                  <div
                    key={group.artist}
                    className={`border rounded-lg p-4 hover:bg-accent/50 transition-colors cursor-pointer ${
                      selectedArtists.has(group.artist) ? 'bg-accent/30 border-primary' : ''
                    }`}
                    onClick={() => isConfigured && toggleArtist(group.artist)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        {isConfigured && (
                          <Checkbox
                            checked={selectedArtists.has(group.artist)}
                            onCheckedChange={() => toggleArtist(group.artist)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                        <h3 className="font-semibold text-lg">{group.artist}</h3>
                      </div>
                      <Badge variant="secondary">
                        {group.tracks.length} track{group.tracks.length !== 1 ? 's' : ''}
                      </Badge>
                    </div>

                    {/* Genres */}
                    {group.genres.length > 0 && (
                      <div className={`flex gap-1 mb-2 flex-wrap ${isConfigured ? 'ml-7' : ''}`}>
                        {group.genres.map((genre) => (
                          <Badge key={genre} variant="outline" className="text-xs">
                            {genre}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Track List */}
                    <div className={`space-y-1 ${isConfigured ? 'ml-7' : ''}`}>
                      {group.tracks.map((track, idx) => (
                        <div key={idx} className="text-sm text-muted-foreground">
                          <span className="font-medium">{track.spotifyTrack.title}</span>
                          {track.spotifyTrack.album && (
                            <span className="ml-2">• {track.spotifyTrack.album}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty State */}
      {!isLoading && missingTracks.length === 0 && user && (
        <Card>
          <CardContent className="text-center py-8">
            <Music className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Analysis Yet</h3>
            <p className="text-muted-foreground mb-4">
              Click "Analyze Missing Tracks" to find gaps in your local collection.
            </p>
          </CardContent>
        </Card>
      )}

      {/* slskd Sync Progress Modal */}
      <SlskdSyncProgress
        isOpen={showSyncModal}
        onClose={handleCloseSyncModal}
        isSyncing={isSyncing}
        progress={progress}
        result={syncResult ?? null}
      />
    </div>
  );
};

export default MissingTracksAnalyzer;