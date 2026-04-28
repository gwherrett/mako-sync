import { useState } from 'react';
import { Disc3, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useVinylCollectionGaps } from '@/hooks/useVinylCollectionGaps';
import { SUPER_GENRES } from '@/types/genreMapping';

interface VinylGapsViewProps {
  superGenreFilter: string;
  onSuperGenreChange: (value: string) => void;
}

export const VinylGapsView: React.FC<VinylGapsViewProps> = ({ superGenreFilter, onSuperGenreChange }) => {
  const { records, totalMissing, isLoading, error } = useVinylCollectionGaps(
    superGenreFilter !== 'all' ? superGenreFilter : undefined
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin mr-3 text-muted-foreground" />
          <span className="text-muted-foreground">Analysing vinyl collection…</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <p className="text-destructive">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Super genre filter */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Supergenre:</span>
        <Select value={superGenreFilter} onValueChange={onSuperGenreChange}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {[...SUPER_GENRES].sort().map(g => (
              <SelectItem key={g} value={g}>{g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Empty state */}
      {records.length === 0 && (
        <Card>
          <CardContent className="text-center py-12">
            <Disc3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">All Vinyl Accounted For</h3>
            <p className="text-muted-foreground">
              Every track in your vinyl collection was found in your local files.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {records.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Disc3 className="h-5 w-5" />
                  Vinyl Gaps
                </CardTitle>
                <CardDescription>
                  {records.length} record{records.length !== 1 ? 's' : ''} with {totalMissing} missing track{totalMissing !== 1 ? 's' : ''}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {records.map(({ record, missing }) => {
                const isExpanded = expandedIds.has(record.id);
                return (
                  <div
                    key={record.id}
                    className="border rounded-lg overflow-hidden"
                  >
                    {/* Record header row */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors text-left"
                      onClick={() => toggleExpanded(record.id)}
                    >
                      {/* Cover thumbnail */}
                      {record.cover_image_url ? (
                        <img
                          src={record.cover_image_url}
                          alt={record.title}
                          className="h-12 w-12 rounded object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded bg-muted flex items-center justify-center shrink-0">
                          <Disc3 className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}

                      {/* Title / artist */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{record.artist}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {record.title}{record.year ? ` (${record.year})` : ''}
                        </p>
                        {record.super_genre && (
                          <Badge variant="outline" className="text-xs mt-0.5">{record.super_genre}</Badge>
                        )}
                      </div>

                      {/* Missing count + expand chevron */}
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="destructive" className="text-xs">
                          {missing.length} missing
                        </Badge>
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        }
                      </div>
                    </button>

                    {/* Missing track list */}
                    {isExpanded && (
                      <div className="border-t bg-muted/30 px-4 py-2 space-y-1">
                        {missing.map(t => (
                          <div key={`${t.position}-${t.title}`} className="flex items-center gap-3 text-sm py-0.5">
                            <span className="text-xs text-muted-foreground w-8 shrink-0 font-mono">{t.position}</span>
                            <span className="text-foreground truncate">{t.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
