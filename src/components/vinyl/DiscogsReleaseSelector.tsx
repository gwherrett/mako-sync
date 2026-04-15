import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Search, CheckCircle2, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import type { DiscogsSearchResult, DiscogsRelease } from '@/types/discogs';

interface DiscogsReleaseSelectorProps {
  initialArtist: string;
  initialTitle: string;
  onSelect: (release: DiscogsRelease) => void;
  onSkip: () => void;
}

async function callDiscogsSearch(action: 'search', params: { artist: string; title: string }): Promise<{ results: DiscogsSearchResult[] }>;
async function callDiscogsSearch(action: 'release', params: { release_id: number }): Promise<{ release: DiscogsRelease }>;
async function callDiscogsSearch(action: string, params: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('discogs-search', {
    body: { action, ...params },
  });
  if (error) {
    // Try to surface the real error message from the edge function body
    let msg = error.message;
    try {
      const body = await (error as unknown as { context: Response }).context?.json?.();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data;
}

export const DiscogsReleaseSelector: React.FC<DiscogsReleaseSelectorProps> = ({
  initialArtist,
  initialTitle,
  onSelect,
  onSkip,
}) => {
  const [artist, setArtist] = useState(initialArtist);
  const [title, setTitle] = useState(initialTitle);
  const [results, setResults] = useState<DiscogsSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const runSearch = useCallback(async (searchArtist: string, searchTitle: string) => {
    if (!searchArtist && !searchTitle) return;
    setIsSearching(true);
    setSearchError(null);
    setResults([]);
    setSelectedId(null);
    setHasSearched(true);
    try {
      const data = await callDiscogsSearch('search', { artist: searchArtist, title: searchTitle });
      // Parse "Artist - Title" from Discogs title string
      const mapped = (data.results || []).map((r: DiscogsSearchResult) => {
        const parts = (r.title as string).split(' - ');
        return {
          ...r,
          artist: parts.length > 1 ? parts[0] : searchArtist,
          releaseTitle: parts.length > 1 ? parts.slice(1).join(' - ') : r.title,
        };
      });
      setResults(mapped);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Auto-search on mount
  useEffect(() => {
    runSearch(initialArtist, initialTitle);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirm = async () => {
    if (!selectedId) return;
    setIsFetching(true);
    try {
      const data = await callDiscogsSearch('release', { release_id: selectedId });
      onSelect(data.release);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : 'Failed to fetch release details');
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <Input
          placeholder="Artist"
          value={artist}
          onChange={e => setArtist(e.target.value)}
          className="flex-1"
        />
        <Input
          placeholder="Title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="flex-1"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => runSearch(artist, title)}
          disabled={isSearching}
        >
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      {/* Results */}
      {isSearching && (
        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Searching Discogs...</span>
        </div>
      )}

      {searchError && (
        <div className="text-destructive text-sm text-center py-4">{searchError}</div>
      )}

      {!isSearching && hasSearched && results.length === 0 && !searchError && (
        <div className="text-center py-8 text-muted-foreground">
          <p>No results found.</p>
          <p className="text-sm mt-1">Try adjusting the artist or title above.</p>
        </div>
      )}

      {results.length > 0 && (
        <ScrollArea className="h-72 rounded-md border">
          <div className="p-2 space-y-2">
            {results.map(r => (
              <Card
                key={r.id}
                className={`cursor-pointer transition-colors hover:bg-accent ${selectedId === r.id ? 'border-primary bg-accent' : ''}`}
                onClick={() => setSelectedId(r.id)}
              >
                <CardContent className="flex items-center gap-3 p-3">
                  {r.thumb ? (
                    <img src={r.thumb} alt="" className="w-12 h-12 object-cover rounded flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 bg-muted rounded flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{r.releaseTitle || r.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.artist}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {r.year && <Badge variant="secondary" className="text-xs">{r.year}</Badge>}
                      {r.country && <Badge variant="outline" className="text-xs">{r.country}</Badge>}
                      {r.format?.[0] && <Badge variant="outline" className="text-xs">{r.format[0]}</Badge>}
                      {r.catno && r.catno !== 'none' && (
                        <Badge variant="outline" className="text-xs font-mono">{r.catno}</Badge>
                      )}
                    </div>
                    {r.label?.[0] && (
                      <p className="text-xs text-muted-foreground mt-0.5">{r.label[0]}</p>
                    )}
                  </div>
                  {selectedId === r.id && (
                    <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={onSkip} className="text-muted-foreground">
          <SkipForward className="h-4 w-4 mr-2" />
          Skip Discogs
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={!selectedId || isFetching}
        >
          {isFetching ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Fetching details...</>
          ) : (
            'Confirm release'
          )}
        </Button>
      </div>
    </div>
  );
};

export default DiscogsReleaseSelector;
