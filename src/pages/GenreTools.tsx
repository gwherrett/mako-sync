import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GenreMappingTable } from '@/components/GenreMapping/GenreMappingTable';
import { TrackLevelProcessor } from '@/components/NoGenreTracks/TrackLevelProcessor';
import { useGenreMapping } from '@/hooks/useGenreMapping';
import { GenreMappingService } from '@/services/genreMapping.service';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/NewAuthContext';

export const GenreTools = () => {
  const { initialDataReady } = useAuth();
  const [noGenreCount, setNoGenreCount] = useState<number>(0);

  const {
    mappings,
    isLoading,
    error,
    setOverride,
    removeOverride,
    setBulkOverrides,
    exportToCSV,
  } = useGenreMapping();

  // Fetch no-genre count + realtime updates (mirrors existing GenreMapping page pattern)
  useEffect(() => {
    if (!initialDataReady) return;

    const fetchCount = async () => {
      try {
        const count = await GenreMappingService.getNoGenreCount();
        setNoGenreCount(count);
      } catch (err) {
        console.error('Error fetching no-genre count:', err);
      }
    };

    fetchCount();

    const channel = supabase
      .channel('genre-tools-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spotify_liked' }, fetchCount)
      .subscribe();

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [initialDataReady]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <MapPin className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-2xl font-bold text-foreground">Genre Tools</h1>
                <p className="text-muted-foreground">Map Spotify genres and assign missing SuperGenres</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {error && (
          <div className="text-center py-12">
            <p className="text-destructive font-semibold mb-2">Error loading genre mappings</p>
            <p className="text-muted-foreground">{error}</p>
          </div>
        )}

        {!error && (
          <Tabs defaultValue="mappings" className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="mappings" className="gap-2">
                <MapPin className="h-4 w-4" />
                Genre Mappings
              </TabsTrigger>
              <TabsTrigger value="assign" className="gap-2">
                <Sparkles className="h-4 w-4" />
                Assign Genres
                {noGenreCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                    {noGenreCount.toLocaleString()}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="mappings">
              <GenreMappingTable
                mappings={mappings}
                onSetOverride={setOverride}
                onRemoveOverride={removeOverride}
                onBulkOverrides={setBulkOverrides}
                onExport={exportToCSV}
                isLoading={isLoading}
              />
            </TabsContent>

            <TabsContent value="assign">
              <TrackLevelProcessor />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
};

export default GenreTools;
