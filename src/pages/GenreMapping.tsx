import { useState, useEffect } from 'react';
import { ArrowLeft, AlertCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { GenreMappingTable } from '@/components/GenreMapping/GenreMappingTable';
import { useGenreMapping } from '@/hooks/useGenreMapping';
import { GenreMappingService } from '@/services/genreMapping.service';
import { supabase } from '@/integrations/supabase/client';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/NewAuthContext';

export const GenreMapping = () => {
  const location = useLocation();
  const { initialDataReady } = useAuth();
  const [noGenreCount, setNoGenreCount] = useState<number>(0);
  const [isLoadingCount, setIsLoadingCount] = useState(true);
  const {
    mappings,
    isLoading,
    error,
    setOverride,
    removeOverride,
    setBulkOverrides,
    exportToCSV
  } = useGenreMapping();

  // Fetch count on mount and set up realtime updates
  useEffect(() => {
    if (!initialDataReady) return;

    const fetchNoGenreCount = async () => {
      try {
        setIsLoadingCount(true);
        const count = await GenreMappingService.getNoGenreCount();
        setNoGenreCount(count);
      } catch (error) {
        console.error('Error fetching no-genre count:', error);
      } finally {
        setIsLoadingCount(false);
      }
    };

    fetchNoGenreCount();

    // Set up realtime subscription for live updates
    const channel = supabase
      .channel('genre-mapping-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'spotify_liked'
        },
        () => {
          // Refetch count when spotify_liked table changes
          fetchNoGenreCount();
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [initialDataReady]);
  if (error) {
    return <div className="container mx-auto py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive mb-4">Error Loading Genre Mappings</h1>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Button asChild>
            <Link to="/">Return Home</Link>
          </Button>
        </div>
      </div>;
  }
  return <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Genre Mapper</h1>
            <p className="text-muted-foreground">Map Spotify genres to Supergenres</p>
          </div>
        </div>
      </div>

      {!isLoadingCount && noGenreCount > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              <span className="font-medium">{noGenreCount} Tracks Without Spotify Genre</span>
            </span>
            <Button variant="default" size="sm" asChild>
              <Link to="/no-genre-tracks">
                <Sparkles className="w-4 h-4 mr-2" />
                Process Tracks with AI
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <GenreMappingTable 
        mappings={mappings} 
        onSetOverride={setOverride} 
        onRemoveOverride={removeOverride} 
        onBulkOverrides={setBulkOverrides}
        onExport={exportToCSV} 
        isLoading={isLoading} 
      />
    </div>;
};