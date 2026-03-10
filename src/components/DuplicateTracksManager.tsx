import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Copy, Trash2, CheckCircle, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/NewAuthContext';
import { DuplicateDetectionService, DuplicateGroup } from '@/services/duplicateDetection.service';

function formatBitrate(bitrate: number | null): string {
  if (bitrate === null) return '—';
  return `${bitrate} kbps`;
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPath(filePath: string): string {
  // Show just the last two path segments for readability
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}

export function DuplicateTracksManager() {
  const { user, initialDataReady } = useAuth();
  const { toast } = useToast();

  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [keepSelections, setKeepSelections] = useState<Record<string, string>>({});
  const [resolvedKeys, setResolvedKeys] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupKey = (g: DuplicateGroup) => `${g.normalized_artist}\0${g.normalized_title}`;

  const loadDuplicates = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const found = await DuplicateDetectionService.findDuplicates(user.id);
      setGroups(found);
      // Default keep = highest bitrate (first in each group)
      const defaults: Record<string, string> = {};
      for (const g of found) {
        defaults[groupKey(g)] = g.tracks[0].id;
      }
      setKeepSelections(defaults);
      setResolvedKeys(new Set());
    } catch (err) {
      console.error('Failed to load duplicates:', err);
      setError('Failed to load duplicates. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (initialDataReady) {
      loadDuplicates();
    }
  }, [initialDataReady, loadDuplicates]);

  const handleResolveGroup = async (group: DuplicateGroup) => {
    const key = groupKey(group);
    const keepId = keepSelections[key];
    const deleteIds = group.tracks.map(t => t.id).filter(id => id !== keepId);

    setIsResolving(true);
    try {
      await DuplicateDetectionService.resolveDuplicate(keepId, deleteIds);
      setResolvedKeys(prev => new Set([...prev, key]));
      toast({
        title: 'Duplicates resolved',
        description: `Removed ${deleteIds.length} duplicate${deleteIds.length !== 1 ? 's' : ''} for "${group.tracks[0].title}"`,
      });
    } catch (err) {
      console.error('Failed to resolve duplicates:', err);
      toast({
        title: 'Error',
        description: 'Failed to resolve duplicates. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsResolving(false);
    }
  };

  const handleResolveAll = async () => {
    const pending = groups.filter(g => !resolvedKeys.has(groupKey(g)));
    if (pending.length === 0) return;

    setIsResolving(true);
    let resolved = 0;
    let failed = 0;
    for (const group of pending) {
      const key = groupKey(group);
      const keepId = keepSelections[key];
      const deleteIds = group.tracks.map(t => t.id).filter(id => id !== keepId);
      try {
        await DuplicateDetectionService.resolveDuplicate(keepId, deleteIds);
        setResolvedKeys(prev => new Set([...prev, key]));
        resolved++;
      } catch {
        failed++;
      }
    }
    setIsResolving(false);
    if (resolved > 0) {
      toast({
        title: 'Bulk resolve complete',
        description: `Resolved ${resolved} group${resolved !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}.`,
        variant: failed > 0 ? 'destructive' : 'default',
      });
    }
  };

  // Derived stats
  const pendingGroups = groups.filter(g => !resolvedKeys.has(groupKey(g)));
  const totalFilesToRemove = pendingGroups.reduce((sum, g) => sum + g.tracks.length - 1, 0);

  if (!initialDataReady || isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <p className="text-muted-foreground">Loading duplicates...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button className="mt-4" onClick={loadDuplicates}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" asChild>
              <Link to="/">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Duplicate Tracks</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Review and resolve duplicate tracks in your local library
              </p>
            </div>
          </div>

          {pendingGroups.length > 0 && (
            <Button
              variant="destructive"
              onClick={handleResolveAll}
              disabled={isResolving}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Resolve All ({pendingGroups.length} groups, {totalFilesToRemove} files to remove)
            </Button>
          )}
        </div>

        {/* Summary */}
        <div className="flex gap-4">
          <Card className="flex-1">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{pendingGroups.length}</div>
              <div className="text-sm text-muted-foreground">Duplicate groups remaining</div>
            </CardContent>
          </Card>
          <Card className="flex-1">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{totalFilesToRemove}</div>
              <div className="text-sm text-muted-foreground">Files that will be removed</div>
            </CardContent>
          </Card>
          <Card className="flex-1">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{resolvedKeys.size}</div>
              <div className="text-sm text-muted-foreground">Groups resolved this session</div>
            </CardContent>
          </Card>
        </div>

        {/* No duplicates */}
        {groups.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
            <p className="text-lg font-medium">No duplicates found</p>
            <p className="text-sm mt-1">Your local library has no tracks with the same title and artist.</p>
          </div>
        )}

        {/* All resolved */}
        {groups.length > 0 && pendingGroups.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
            <p className="text-lg font-medium">All duplicates resolved!</p>
            <Button className="mt-4" variant="outline" onClick={loadDuplicates}>
              Refresh
            </Button>
          </div>
        )}

        {/* Duplicate groups */}
        {pendingGroups.map((group) => {
          const key = groupKey(group);
          const keepId = keepSelections[key];

          return (
            <Card key={key}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <div className="flex items-center gap-2">
                    <Copy className="w-4 h-4 text-muted-foreground" />
                    <span>{group.tracks[0].title ?? '(no title)'}</span>
                    <span className="text-muted-foreground font-normal">—</span>
                    <span className="text-muted-foreground font-normal">{group.tracks[0].artist ?? '(no artist)'}</span>
                    <Badge variant="secondary">{group.tracks.length} copies</Badge>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleResolveGroup(group)}
                    disabled={isResolving}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Resolve
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={keepId}
                  onValueChange={(val) => setKeepSelections(prev => ({ ...prev, [key]: val }))}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">Keep</TableHead>
                        <TableHead>Format</TableHead>
                        <TableHead>Bitrate</TableHead>
                        <TableHead>File Size</TableHead>
                        <TableHead>Path</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.tracks.map((track) => (
                        <TableRow
                          key={track.id}
                          className={track.id === keepId ? 'bg-muted/40' : ''}
                        >
                          <TableCell>
                            <div className="flex items-center">
                              <RadioGroupItem value={track.id} id={`keep-${track.id}`} />
                              <Label htmlFor={`keep-${track.id}`} className="sr-only">Keep this copy</Label>
                            </div>
                          </TableCell>
                          <TableCell>
                            {track.audio_format ? (
                              <Badge variant="outline" className="uppercase text-xs">
                                {track.audio_format}
                              </Badge>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {formatBitrate(track.bitrate)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {formatFileSize(track.file_size)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono max-w-xs truncate" title={track.file_path}>
                            {formatPath(track.file_path)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </RadioGroup>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
