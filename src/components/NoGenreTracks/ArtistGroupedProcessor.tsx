import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Check, X, Loader2, Music, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { TrackGenreService } from '@/services/trackGenre.service';
import { SUPER_GENRES, type SuperGenre } from '@/types/genreMapping';

interface Track {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  spotify_id: string;
  year: number | null;
}

interface ArtistGroup {
  artist: string;
  tracks: Track[];
  trackCount: number;
  suggestion?: {
    suggestedGenre: SuperGenre;
    confidence: number;
    reasoning: string;
  } | null;
  isProcessing?: boolean;
  decision?: 'approved' | 'rejected' | 'manual' | null;
  manualGenre?: SuperGenre | '';
}

export const ArtistGroupedProcessor = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [artistGroups, setArtistGroups] = useState<ArtistGroup[]>([]);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [totalTracksAssigned, setTotalTracksAssigned] = useState(0);

  useEffect(() => {
    loadArtistGroups();
  }, []);

  const sortArtistGroups = (groups: ArtistGroup[]): ArtistGroup[] => {
    return [...groups].sort((a, b) => {
      // Unprocessed artists (no decision) come first
      const aProcessed = a.decision === 'approved' || a.decision === 'manual';
      const bProcessed = b.decision === 'approved' || b.decision === 'manual';
      
      if (aProcessed !== bProcessed) {
        return aProcessed ? 1 : -1; // Processed go to bottom
      }
      
      // Within each group, sort alphabetically
      return a.artist.localeCompare(b.artist);
    });
  };

  const loadArtistGroups = async () => {
    try {
      setIsLoading(true);
      const groupedMap = await TrackGenreService.getTracksGroupedByArtist();
      
      const groups: ArtistGroup[] = Array.from(groupedMap.entries())
        .map(([artist, tracks]) => ({
          artist,
          tracks,
          trackCount: tracks.length,
          decision: null
        }));
      
      const sorted = sortArtistGroups(groups);
      setArtistGroups(sorted);
      
      if (sorted.length > 0) {
        setSelectedArtist(sorted[0].artist);
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error loading artists',
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const processSingleArtist = async (artistName: string) => {
    const groupIndex = artistGroups.findIndex(g => g.artist === artistName);
    if (groupIndex === -1) return;
    
    const group = artistGroups[groupIndex];
    
    try {
      setArtistGroups(prev => {
        const updated = [...prev];
        updated[groupIndex] = { ...updated[groupIndex], isProcessing: true };
        return updated;
      });

      const sampleTracks = group.tracks.slice(0, 10).map(t => ({
        title: t.title,
        album: t.album,
        year: t.year
      }));

      const result = await TrackGenreService.suggestGenreForArtist(
        group.artist,
        sampleTracks,
        group.trackCount
      );
      
      setArtistGroups(prev => {
        const updated = [...prev];
        updated[groupIndex] = { 
          ...updated[groupIndex], 
          suggestion: result, 
          isProcessing: false 
        };
        return updated;
      });

      toast({
        title: 'AI suggestion generated',
        description: `${result.suggestedGenre} suggested for ${artistName}`
      });
    } catch (error) {
      console.error('Error processing artist:', error);
      setArtistGroups(prev => {
        const updated = [...prev];
        updated[groupIndex] = { 
          ...updated[groupIndex], 
          suggestion: null, 
          isProcessing: false 
        };
        return updated;
      });
      
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate AI suggestion'
      });
    }
  };

  const processBatchWithAI = async () => {
    setIsProcessingBatch(true);
    
    // Process all unprocessed artists (those without a decision)
    const unprocessedArtists = artistGroups.filter(g => !g.decision && !g.suggestion);
    const artistsToProcess = unprocessedArtists.slice(0, 10);
    
    const promises = artistsToProcess.map(group => processSingleArtist(group.artist));
    await Promise.all(promises);
    
    setIsProcessingBatch(false);
    
    toast({
      title: 'Batch processed',
      description: `AI suggestions generated for ${artistsToProcess.length} artists`
    });
  };

  const handleApprove = async (artist: string) => {
    const group = artistGroups.find(g => g.artist === artist);
    if (!group?.suggestion) return;

    try {
      const trackIds = group.tracks.map(t => t.id);
      await TrackGenreService.assignGenreToMultipleTracks(trackIds, group.suggestion.suggestedGenre);
      
      setArtistGroups(prev => {
        const updated = prev.map(g => g.artist === artist ? { ...g, decision: 'approved' as const } : g);
        const sorted = sortArtistGroups(updated);
        
        // Auto-select next unprocessed artist
        const nextArtist = sorted.find(g => !g.decision);
        if (nextArtist) {
          setSelectedArtist(nextArtist.artist);
        }
        
        return sorted;
      });
      setTotalTracksAssigned(prev => prev + group.trackCount);
      
      toast({
        title: 'Genre assigned',
        description: `${group.suggestion.suggestedGenre} → ${group.trackCount} tracks by ${artist}`
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const handleReject = (artist: string) => {
    setArtistGroups(prev => 
      prev.map(g => g.artist === artist ? { ...g, decision: 'rejected' as const, suggestion: null } : g)
    );
  };

  const handleManualAssign = async (artist: string) => {
    const group = artistGroups.find(g => g.artist === artist);
    if (!group?.manualGenre) return;

    try {
      const trackIds = group.tracks.map(t => t.id);
      await TrackGenreService.assignGenreToMultipleTracks(trackIds, group.manualGenre);
      
      setArtistGroups(prev => {
        const updated = prev.map(g => g.artist === artist ? { ...g, decision: 'manual' as const } : g);
        const sorted = sortArtistGroups(updated);
        
        // Auto-select next unprocessed artist
        const nextArtist = sorted.find(g => !g.decision);
        if (nextArtist) {
          setSelectedArtist(nextArtist.artist);
        }
        
        return sorted;
      });
      setTotalTracksAssigned(prev => prev + group.trackCount);
      
      toast({
        title: 'Genre assigned',
        description: `${group.manualGenre} → ${group.trackCount} tracks by ${artist}`
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const selectedGroup = artistGroups.find(g => g.artist === selectedArtist);
  const totalTracks = artistGroups.reduce((sum, g) => sum + g.trackCount, 0);
  const processedArtists = artistGroups.filter(g => g.decision === 'approved' || g.decision === 'manual').length;
  const unprocessedCount = artistGroups.filter(g => !g.decision && !g.suggestion).length;

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">Loading artists...</div>
      </div>
    );
  }

  if (artistGroups.length === 0) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">No Artists to Process</h1>
          <p className="text-muted-foreground">All tracks have been assigned genres!</p>
          <Button onClick={() => navigate('/genre-mapping')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Genre Mapper
          </Button>
        </div>
      </div>
    );
  }

  const progressPercentage = artistGroups.length > 0 
    ? Math.round((processedArtists / artistGroups.length) * 100) 
    : 0;

  return (
    <div className="container mx-auto py-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => navigate('/genre-mapping')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        {unprocessedCount > 0 && (
          <Button 
            onClick={processBatchWithAI} 
            disabled={isProcessingBatch}
          >
            {isProcessingBatch ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Process Next {Math.min(10, unprocessedCount)} Artists
              </>
            )}
          </Button>
        )}
      </div>

      {/* Progress Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Review Progress</h3>
                <p className="text-sm text-muted-foreground">
                  {processedArtists} of {artistGroups.length} artists completed • {totalTracksAssigned} tracks assigned
                </p>
              </div>
              <div className="text-3xl font-bold text-primary">
                {progressPercentage}%
              </div>
            </div>
            <Progress value={progressPercentage} className="h-3" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-12 gap-6">
        {/* Left Panel - Artist List */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Artists ({artistGroups.length})</span>
              <div className="text-xs font-normal text-muted-foreground">
                {totalTracks} tracks
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              <div className="space-y-1 p-4">
                {artistGroups.map((group) => (
                  <div
                    key={group.artist}
                    className={`rounded-lg transition-colors ${
                      selectedArtist === group.artist
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <button
                      onClick={() => setSelectedArtist(group.artist)}
                      className="w-full text-left p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Music className="w-4 h-4 flex-shrink-0" />
                          <span className="font-medium truncate">{group.artist}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge variant="secondary">
                            {group.trackCount}
                          </Badge>
                          {group.decision !== 'approved' && group.decision !== 'manual' && (
                            <Button
                              size="sm"
                              variant={selectedArtist === group.artist ? "secondary" : "outline"}
                              onClick={(e) => {
                                e.stopPropagation();
                                processSingleArtist(group.artist);
                              }}
                              disabled={group.isProcessing}
                              className="h-7 w-7 p-0"
                            >
                              {group.isProcessing ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Sparkles className="w-3 h-3" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {group.isProcessing && (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        )}
                        {group.decision === 'approved' && (
                          <Badge variant="default" className="text-xs">
                            <Check className="w-3 h-3 mr-1" />
                            Approved
                          </Badge>
                        )}
                        {group.decision === 'manual' && (
                          <Badge variant="secondary" className="text-xs">
                            <Check className="w-3 h-3 mr-1" />
                            Manual
                          </Badge>
                        )}
                        {group.suggestion && !group.decision && (
                          <Badge variant="outline" className="text-xs">
                            {group.suggestion.suggestedGenre}
                          </Badge>
                        )}
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right Panel - Artist Details */}
        <Card className="col-span-8">
          <CardHeader>
            <CardTitle>
              {selectedGroup ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span>{selectedGroup.artist}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{selectedGroup.trackCount} tracks</Badge>
                      {selectedGroup.decision !== 'approved' && selectedGroup.decision !== 'manual' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => processSingleArtist(selectedGroup.artist)}
                          disabled={selectedGroup.isProcessing}
                          className="h-7 w-7 p-0"
                        >
                          {selectedGroup.isProcessing ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {selectedGroup.suggestion && (
                    <div className="bg-muted p-4 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-primary" />
                          <span className="font-semibold text-lg">{selectedGroup.suggestion.suggestedGenre}</span>
                          <Badge variant="secondary">
                            {selectedGroup.suggestion.confidence}% confidence
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {selectedGroup.suggestion.reasoning}
                      </p>
                      
                      {!selectedGroup.decision && (
                        <div className="flex gap-2 pt-2">
                          <Button 
                            onClick={() => handleApprove(selectedGroup.artist)}
                            className="flex-1"
                          >
                            <Check className="w-4 h-4 mr-2" />
                            Apply to All {selectedGroup.trackCount} Tracks
                          </Button>
                          <Button 
                            variant="outline"
                            onClick={() => handleReject(selectedGroup.artist)}
                          >
                            <X className="w-4 h-4 mr-2" />
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedGroup.decision === 'rejected' && (
                    <div className="bg-muted p-4 rounded-lg space-y-3">
                      <div className="flex items-center gap-2">
                        <Select 
                          value={selectedGroup.manualGenre || ''} 
                          onValueChange={(value) => {
                            setArtistGroups(prev => 
                              prev.map(g => g.artist === selectedGroup.artist 
                                ? { ...g, manualGenre: value as SuperGenre } 
                                : g
                              )
                            );
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select genre..." />
                          </SelectTrigger>
                          <SelectContent>
                            {[...SUPER_GENRES].sort().map(genre => (
                              <SelectItem key={genre} value={genre}>
                                {genre}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button 
                          onClick={() => handleManualAssign(selectedGroup.artist)}
                          disabled={!selectedGroup.manualGenre}
                        >
                          Assign to All {selectedGroup.trackCount} Tracks
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                'Select an artist'
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedGroup && (
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Track</TableHead>
                      <TableHead>Album</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedGroup.tracks.map((track) => (
                      <TableRow key={track.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <a
                              href={`https://open.spotify.com/track/${track.spotify_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:text-primary/80 transition-colors"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                            {track.title}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{track.album || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="text-center space-y-1 p-4">
        <div className="text-sm text-muted-foreground">
          Progress: {processedArtists} of {artistGroups.length} artists completed
        </div>
        <div className="text-sm font-medium">
          {totalTracksAssigned} tracks assigned
        </div>
      </div>
    </div>
  );
};
