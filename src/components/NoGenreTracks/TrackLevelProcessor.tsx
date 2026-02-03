import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Check, X, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, ChevronsUpDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useToast } from '@/hooks/use-toast';
import { TrackGenreService } from '@/services/trackGenre.service';
import { SUPER_GENRES, type SuperGenre } from '@/types/genreMapping';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/NewAuthContext';

interface TrackRow {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  spotify_id: string;
  currentSuperGenre: SuperGenre | null;
  suggestion?: {
    suggestedGenre: SuperGenre;
    confidence: number;
    reasoning: string;
  } | null;
  isProcessing: boolean;
  showManualSelect: boolean;
}

type SortField = 'artist' | 'album' | 'super_genre';
type SortDirection = 'asc' | 'desc';

export function TrackLevelProcessor() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { initialDataReady } = useAuth();
  
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [sortField, setSortField] = useState<SortField>('artist');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const assignedCount = useMemo(() => 
    tracks.filter(t => t.currentSuperGenre !== null).length, 
    [tracks]
  );

  const progressPercent = tracks.length > 0 
    ? Math.round((assignedCount / tracks.length) * 100) 
    : 0;

  const exportToCsv = () => {
    const headers = ['Artist', 'Album', 'Track', 'Year', 'Super Genre', 'Spotify ID'];
    const rows = sortedTracks.map(track => [
      track.artist,
      track.album || '',
      track.title,
      track.year?.toString() || '',
      track.currentSuperGenre || '',
      track.spotify_id
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `track-genres-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    toast({ title: 'Exported', description: `${sortedTracks.length} tracks exported to CSV` });
  };

  useEffect(() => {
    if (!initialDataReady) return;
    loadTracks();
  }, [initialDataReady]);

  const loadTracks = async () => {
    setIsLoading(true);
    try {
      const data = await TrackGenreService.getAllTracksWithoutSpotifyGenre();
      setTracks(data.map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        year: t.year,
        spotify_id: t.spotify_id,
        currentSuperGenre: t.super_genre as SuperGenre | null,
        suggestion: null,
        isProcessing: false,
        showManualSelect: false,
      })));
    } catch (error) {
      console.error('Error loading tracks:', error);
      toast({
        title: 'Error',
        description: 'Failed to load tracks',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const sortedTracks = useMemo(() => {
    const sorted = [...tracks].sort((a, b) => {
      let aVal: string | null;
      let bVal: string | null;

      switch (sortField) {
        case 'artist':
          aVal = a.artist;
          bVal = b.artist;
          break;
        case 'album':
          aVal = a.album;
          bVal = b.album;
          break;
        case 'super_genre':
          aVal = a.currentSuperGenre;
          bVal = b.currentSuperGenre;
          // Unassigned first when ascending
          if (sortDirection === 'asc') {
            if (!aVal && bVal) return -1;
            if (aVal && !bVal) return 1;
          } else {
            if (!aVal && bVal) return 1;
            if (aVal && !bVal) return -1;
          }
          break;
        default:
          return 0;
      }

      if (!aVal && !bVal) return 0;
      if (!aVal) return sortDirection === 'asc' ? -1 : 1;
      if (!bVal) return sortDirection === 'asc' ? 1 : -1;

      const comparison = aVal.localeCompare(bVal);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [tracks, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-4 w-4 ml-1" /> 
      : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const processTrack = async (trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    setTracks(prev => prev.map(t => 
      t.id === trackId ? { ...t, isProcessing: true, suggestion: null, showManualSelect: false } : t
    ));

    try {
      const suggestion = await TrackGenreService.suggestGenreForTrack(
        track.id,
        track.title,
        track.artist,
        track.album,
        track.year
      );

      setTracks(prev => prev.map(t => 
        t.id === trackId ? { 
          ...t, 
          isProcessing: false, 
          suggestion: {
            suggestedGenre: suggestion.suggestedGenre,
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
          }
        } : t
      ));
    } catch (error) {
      console.error('Error processing track:', error);
      setTracks(prev => prev.map(t => 
        t.id === trackId ? { ...t, isProcessing: false } : t
      ));
      toast({
        title: 'Error',
        description: 'Failed to get AI suggestion',
        variant: 'destructive',
      });
    }
  };

  const handleAccept = async (trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track?.suggestion) return;

    try {
      await TrackGenreService.assignGenreToTrack(trackId, track.suggestion.suggestedGenre);
      setTracks(prev => prev.map(t => 
        t.id === trackId ? { 
          ...t, 
          currentSuperGenre: track.suggestion!.suggestedGenre,
          suggestion: null,
          showManualSelect: false,
        } : t
      ));
      toast({ title: 'Genre assigned', description: `${track.title} → ${track.suggestion.suggestedGenre}` });
    } catch (error) {
      console.error('Error assigning genre:', error);
      toast({ title: 'Error', description: 'Failed to assign genre', variant: 'destructive' });
    }
  };

  const handleReject = (trackId: string) => {
    setTracks(prev => prev.map(t => 
      t.id === trackId ? { ...t, suggestion: null, showManualSelect: true } : t
    ));
  };

  const handleManualSelect = async (trackId: string, genre: SuperGenre) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    try {
      await TrackGenreService.assignGenreToTrack(trackId, genre);
      setTracks(prev => prev.map(t => 
        t.id === trackId ? { 
          ...t, 
          currentSuperGenre: genre,
          suggestion: null,
          showManualSelect: false,
        } : t
      ));
      toast({ title: 'Genre assigned', description: `${track.title} → ${genre}` });
    } catch (error) {
      console.error('Error assigning genre:', error);
      toast({ title: 'Error', description: 'Failed to assign genre', variant: 'destructive' });
    }
  };

  const processNextBatch = async () => {
    // Prioritize unassigned tracks, then tracks without pending suggestions
    const unprocessedTracks = sortedTracks
      .filter(t => !t.isProcessing && !t.suggestion && !t.showManualSelect)
      .sort((a, b) => {
        // Unassigned first
        if (!a.currentSuperGenre && b.currentSuperGenre) return -1;
        if (a.currentSuperGenre && !b.currentSuperGenre) return 1;
        return 0;
      })
      .slice(0, 10);

    if (unprocessedTracks.length === 0) {
      toast({ title: 'No tracks to process', description: 'All tracks have pending suggestions or assignments' });
      return;
    }

    setIsBatchProcessing(true);

    // Process all 10 in parallel
    await Promise.all(unprocessedTracks.map(track => processTrack(track.id)));

    setIsBatchProcessing(false);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="h-6 w-6" />
              No Genre Tracks
            </h1>
            <p className="text-muted-foreground">Assign Supergenres to tracks without Spotify genre data using AI suggestions or manual selection. Scan files downloaded from Slskd.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline"
            onClick={exportToCsv}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button 
            onClick={processNextBatch} 
            disabled={isBatchProcessing}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {isBatchProcessing ? 'Processing...' : 'Process Next 10'}
          </Button>
        </div>
      </div>

      {/* Progress Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Progress value={progressPercent} className="flex-1" />
            <span className="text-sm font-medium whitespace-nowrap">
              {assignedCount} / {tracks.length} tracks ({progressPercent}%)
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tracks Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('artist')}
                >
                  <div className="flex items-center">
                    Artist {getSortIcon('artist')}
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('album')}
                >
                  <div className="flex items-center">
                    Album {getSortIcon('album')}
                  </div>
                </TableHead>
                <TableHead>Track</TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('super_genre')}
                >
                  <div className="flex items-center">
                    Super Genre {getSortIcon('super_genre')}
                  </div>
                </TableHead>
                <TableHead className="w-[100px] text-center">AI</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTracks.map(track => (
                <TableRow 
                  key={track.id}
                  className={track.currentSuperGenre ? 'bg-muted/20' : ''}
                >
                  <TableCell className="font-medium">{track.artist}</TableCell>
                  <TableCell className="text-muted-foreground">{track.album || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{track.title}</span>
                      {track.year && <span className="text-muted-foreground text-sm">({track.year})</span>}
                      <a 
                        href={`https://open.spotify.com/track/${track.spotify_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </TableCell>
                  <TableCell>
                    <SuperGenreCell 
                      track={track}
                      onAccept={() => handleAccept(track.id)}
                      onReject={() => handleReject(track.id)}
                      onManualSelect={(genre) => handleManualSelect(track.id, genre)}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => processTrack(track.id)}
                      disabled={track.isProcessing}
                      className="h-8 w-8"
                    >
                      {track.isProcessing ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

interface SuperGenreCellProps {
  track: TrackRow;
  onAccept: () => void;
  onReject: () => void;
  onManualSelect: (genre: SuperGenre) => void;
}

function SuperGenreCell({ track, onAccept, onReject, onManualSelect }: SuperGenreCellProps) {
  // Processing state
  if (track.isProcessing) {
    return <span className="text-muted-foreground text-sm">Processing...</span>;
  }

  // Has pending suggestion
  if (track.suggestion) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="bg-primary/20 text-primary">
          {track.suggestion.suggestedGenre}
        </Badge>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-green-600" onClick={onAccept}>
          <Check className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600" onClick={onReject}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // Manual selection mode
  if (track.showManualSelect) {
    return <GenreCombobox onSelect={onManualSelect} />;
  }

  // Has assigned genre
  if (track.currentSuperGenre) {
    return <Badge variant="outline">{track.currentSuperGenre}</Badge>;
  }

  // Unassigned
  return <span className="text-muted-foreground">—</span>;
}

interface GenreComboboxProps {
  onSelect: (genre: SuperGenre) => void;
}

function GenreCombobox({ onSelect }: GenreComboboxProps) {
  const [open, setOpen] = useState(true);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[180px] h-8 justify-between text-sm"
        >
          Select genre...
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search genres..." />
          <CommandList>
            <CommandEmpty>No genre found.</CommandEmpty>
            <CommandGroup>
              {[...SUPER_GENRES].sort().map((genre) => (
                <CommandItem
                  key={genre}
                  value={genre}
                  onSelect={() => {
                    onSelect(genre);
                    setOpen(false);
                  }}
                >
                  {genre}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
