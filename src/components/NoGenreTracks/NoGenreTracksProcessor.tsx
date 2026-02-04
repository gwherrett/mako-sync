import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { TrackGenreService } from '@/services/trackGenre.service';
import { SUPER_GENRES, type SuperGenre } from '@/types/genreMapping';
import { useAuth } from '@/contexts/NewAuthContext';

interface Track {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  spotify_id: string;
  year: number | null;
}

interface TrackWithSuggestion extends Track {
  suggestion?: {
    suggestedGenre: SuperGenre;
    confidence: number;
    reasoning: string;
  } | null;
  isProcessing?: boolean;
  manualGenre?: SuperGenre | '';
  decision?: 'approved' | 'rejected' | 'manual' | null;
}

const BATCH_SIZE = 25;

export const NoGenreTracksProcessor = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { initialDataReady } = useAuth();
  
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [batchTracks, setBatchTracks] = useState<TrackWithSuggestion[]>([]);
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [totalProcessed, setTotalProcessed] = useState(0);

  useEffect(() => {
    if (!initialDataReady) return;
    loadAllTracks();
  }, [initialDataReady]);

  useEffect(() => {
    if (allTracks.length > 0) {
      loadBatch();
    }
  }, [currentBatchIndex, allTracks]);

  const loadAllTracks = async () => {
    try {
      setIsLoading(true);
      const data = await TrackGenreService.getTracksWithoutGenre();
      setAllTracks(data);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error loading tracks',
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadBatch = () => {
    const startIdx = currentBatchIndex * BATCH_SIZE;
    const endIdx = startIdx + BATCH_SIZE;
    const batch = allTracks.slice(startIdx, endIdx);
    setBatchTracks(batch.map(track => ({ ...track, decision: null })));
  };

  const processBatchWithAI = async () => {
    setIsProcessingBatch(true);
    
    // Process all tracks in parallel
    const promises = batchTracks.map(async (track, index) => {
      try {
        setBatchTracks(prev => {
          const updated = [...prev];
          updated[index] = { ...updated[index], isProcessing: true };
          return updated;
        });

        const result = await TrackGenreService.suggestGenreForTrack(
          track.id,
          track.title,
          track.artist,
          track.album,
          track.year
        );
        
        setBatchTracks(prev => {
          const updated = [...prev];
          updated[index] = { 
            ...updated[index], 
            suggestion: result, 
            isProcessing: false 
          };
          return updated;
        });
      } catch (error) {
        console.error('Error processing track:', error);
        setBatchTracks(prev => {
          const updated = [...prev];
          updated[index] = { 
            ...updated[index], 
            suggestion: null, 
            isProcessing: false 
          };
          return updated;
        });
      }
    });

    await Promise.all(promises);
    setIsProcessingBatch(false);
    
    toast({
      title: 'Batch processed',
      description: `AI suggestions generated for ${batchTracks.length} tracks`
    });
  };

  const handleApprove = async (index: number) => {
    const track = batchTracks[index];
    if (!track.suggestion) return;

    try {
      await TrackGenreService.assignGenreToTrack(track.id, track.suggestion.suggestedGenre);
      setBatchTracks(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], decision: 'approved' };
        return updated;
      });
      setTotalProcessed(prev => prev + 1);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const handleReject = (index: number) => {
    setBatchTracks(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], decision: 'rejected', suggestion: null };
      return updated;
    });
  };

  const handleManualAssign = async (index: number) => {
    const track = batchTracks[index];
    if (!track.manualGenre) return;

    try {
      await TrackGenreService.assignGenreToTrack(track.id, track.manualGenre);
      setBatchTracks(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], decision: 'manual' };
        return updated;
      });
      setTotalProcessed(prev => prev + 1);
      toast({
        title: 'Genre assigned',
        description: `"${track.title}" → ${track.manualGenre}`
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const handleNextBatch = () => {
    const maxBatches = Math.ceil(allTracks.length / BATCH_SIZE);
    if (currentBatchIndex < maxBatches - 1) {
      setCurrentBatchIndex(prev => prev + 1);
    }
  };

  const handlePreviousBatch = () => {
    if (currentBatchIndex > 0) {
      setCurrentBatchIndex(prev => prev - 1);
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'bg-green-500/10 text-green-700 dark:text-green-400';
    if (confidence >= 60) return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
    return 'bg-orange-500/10 text-orange-700 dark:text-orange-400';
  };

  const totalBatches = Math.ceil(allTracks.length / BATCH_SIZE);
  const batchStart = currentBatchIndex * BATCH_SIZE + 1;
  const batchEnd = Math.min((currentBatchIndex + 1) * BATCH_SIZE, allTracks.length);

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">Loading tracks...</div>
      </div>
    );
  }

  if (allTracks.length === 0) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">No Tracks to Process</h1>
          <p className="text-muted-foreground">All tracks have been assigned genres!</p>
          <Button onClick={() => navigate('/genre-mapping')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Genre Mapper
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => navigate('/genre-mapping')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground">
            Batch {currentBatchIndex + 1} of {totalBatches} • Tracks {batchStart}-{batchEnd} of {allTracks.length}
          </div>
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
                Process Batch with AI
              </>
            )}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Genre Assignment - Batch {currentBatchIndex + 1}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[45%]">Track</TableHead>
                <TableHead className="w-[30%]">AI Suggestion</TableHead>
                <TableHead className="w-[25%]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batchTracks.map((track, index) => (
                <TableRow key={track.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">{track.title}</div>
                      <div className="text-sm text-muted-foreground">{track.artist}</div>
                      {track.album && <div className="text-xs text-muted-foreground">💿 {track.album}</div>}
                      {track.suggestion && (
                        <div className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                          {track.suggestion.reasoning}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {track.isProcessing ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm text-muted-foreground">Loading...</span>
                      </div>
                    ) : track.suggestion ? (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{track.suggestion.suggestedGenre}</span>
                        <Badge variant="secondary" className="text-xs">
                          {track.suggestion.confidence}%
                        </Badge>
                      </div>
                    ) : track.decision === 'rejected' ? (
                      <div className="space-y-2">
                        <Select 
                          value={track.manualGenre || ''} 
                          onValueChange={(value) => {
                            setBatchTracks(prev => {
                              const updated = [...prev];
                              updated[index] = { ...updated[index], manualGenre: value as SuperGenre };
                              return updated;
                            });
                          }}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            {[...SUPER_GENRES].sort().map(genre => (
                              <SelectItem key={genre} value={genre}>
                                {genre}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {track.decision === 'approved' ? (
                      <Badge variant="default" className="gap-1">
                        <Check className="w-3 h-3" /> Approved
                      </Badge>
                    ) : track.decision === 'manual' ? (
                      <Badge variant="secondary" className="gap-1">
                        <Check className="w-3 h-3" /> Manual
                      </Badge>
                    ) : track.decision === 'rejected' ? (
                      <Button 
                        size="sm" 
                        variant="secondary"
                        onClick={() => handleManualAssign(index)}
                        disabled={!track.manualGenre}
                      >
                        Assign
                      </Button>
                    ) : track.suggestion ? (
                      <div className="flex gap-1">
                        <Button 
                          size="sm" 
                          variant="default"
                          onClick={() => handleApprove(index)}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleReject(index)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handlePreviousBatch}
          disabled={currentBatchIndex === 0}
        >
          ← Previous Batch
        </Button>
        
        <div className="text-sm text-muted-foreground">
          Total processed: {totalProcessed}
        </div>

        <Button
          variant="outline"
          onClick={handleNextBatch}
          disabled={currentBatchIndex >= totalBatches - 1}
        >
          Next Batch →
        </Button>
      </div>
    </div>
  );
};
