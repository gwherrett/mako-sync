import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Copy, Trash2, CheckCircle, AlertCircle, Music } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/NewAuthContext';
import { DuplicateDetectionService, DuplicateGroup, SpotifyDuplicateGroup } from '@/services/duplicateDetection.service';
import { SpotifyAuthManager, hasSpotifyScope } from '@/services/spotifyAuthManager.service';

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
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') === 'spotify' ? 'spotify' : 'local';

  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [keepSelections, setKeepSelections] = useState<Record<string, string>>({});
  const [resolvedKeys, setResolvedKeys] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [spotifyGroups, setSpotifyGroups] = useState<SpotifyDuplicateGroup[]>([]);
  const [spotifyKeepSelections, setSpotifyKeepSelections] = useState<Record<string, string>>({});
  const [spotifyResolvedKeys, setSpotifyResolvedKeys] = useState<Set<string>>(new Set());
  const [isSpotifyLoading, setIsSpotifyLoading] = useState(true);
  const [isSpotifyResolving, setIsSpotifyResolving] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);

  // Derive Spotify connection state on render, not in state
  const spotifyState = SpotifyAuthManager.getInstance().getState();
  const isSpotifyConnected = spotifyState.isConnected;
  const hasModifyScope = hasSpotifyScope(spotifyState.connection, 'user-library-modify');

  const groupKey = (g: DuplicateGroup) => `${g.normalized_artist}\0${g.normalized_title}`;
  const spotifyGroupKey = (g: SpotifyDuplicateGroup) => `${g.normalized_artist}\0${g.normalized_title}`;

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

  const loadSpotifyDuplicates = useCallback(async () => {
    if (!user) return;
    setIsSpotifyLoading(true);
    setSpotifyError(null);
    try {
      const found = await DuplicateDetectionService.findSpotifyDuplicates(user.id);
      setSpotifyGroups(found);
      const defaults: Record<string, string> = {};
      for (const g of found) {
        defaults[spotifyGroupKey(g)] = g.tracks[0].id;
      }
      setSpotifyKeepSelections(defaults);
      setSpotifyResolvedKeys(new Set());
    } catch (err) {
      console.error('Failed to load Spotify duplicates:', err);
      setSpotifyError('Failed to load Spotify duplicates. Please try again.');
    } finally {
      setIsSpotifyLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (initialDataReady) {
      loadDuplicates();
      loadSpotifyDuplicates();
    }
  }, [initialDataReady, loadDuplicates, loadSpotifyDuplicates]);

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

  const handleResolveSpotifyGroup = async (group: SpotifyDuplicateGroup) => {
    if (!user) return;
    const key = spotifyGroupKey(group);
    const keepId = spotifyKeepSelections[key];
    const deleteIds = group.tracks.map(t => t.id).filter(id => id !== keepId);

    setIsSpotifyResolving(true);
    try {
      const result = await DuplicateDetectionService.resolveSpotifyDuplicate(keepId, deleteIds, user.id);
      setSpotifyResolvedKeys(prev => new Set([...prev, key]));
      toast({
        title: 'Spotify duplicates resolved',
        description: `Removed ${result.removed} track${result.removed !== 1 ? 's' : ''} from your Spotify library${result.errors.length > 0 ? ` (${result.errors.length} error${result.errors.length !== 1 ? 's' : ''})` : ''}.`,
        variant: result.errors.length > 0 ? 'destructive' : 'default',
      });
    } catch (err) {
      console.error('Failed to resolve Spotify duplicates:', err);
      toast({
        title: 'Error',
        description: 'Failed to resolve Spotify duplicates. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSpotifyResolving(false);
    }
  };

  // Derived stats
  const pendingGroups = groups.filter(g => !resolvedKeys.has(groupKey(g)));
  const totalFilesToRemove = pendingGroups.reduce((sum, g) => sum + g.tracks.length - 1, 0);
  const pendingSpotifyGroups = spotifyGroups.filter(g => !spotifyResolvedKeys.has(spotifyGroupKey(g)));

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

        {/* Tabs */}
        <Tabs defaultValue={defaultTab}>
          <TabsList>
            <TabsTrigger value="local">Local Files</TabsTrigger>
            <TabsTrigger value="spotify">Spotify Library</TabsTrigger>
          </TabsList>

          {/* Local Files tab (existing content) */}
          <TabsContent value="local" className="space-y-6">
            {(!initialDataReady || isLoading) && (
              <p className="text-muted-foreground">Loading duplicates...</p>
            )}
            {!isLoading && error && (
              <>
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
                <Button onClick={loadDuplicates}>Retry</Button>
              </>
            )}
            {!isLoading && !error && (
              <>
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
              </>
            )}
          </TabsContent>

          {/* Spotify Library tab (new) */}
          <TabsContent value="spotify" className="space-y-6">
            {!isSpotifyConnected && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Spotify is not connected. Connect Spotify from the dashboard to detect duplicate liked songs.
                </AlertDescription>
              </Alert>
            )}

            {isSpotifyConnected && !hasModifyScope && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Your Spotify connection needs to be updated to allow track removal. Please disconnect and reconnect Spotify from the dashboard.
                </AlertDescription>
              </Alert>
            )}

            {isSpotifyConnected && hasModifyScope && isSpotifyLoading && (
              <p className="text-muted-foreground">Loading Spotify duplicates...</p>
            )}

            {isSpotifyConnected && hasModifyScope && !isSpotifyLoading && spotifyError && (
              <>
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{spotifyError}</AlertDescription>
                </Alert>
                <Button onClick={loadSpotifyDuplicates}>Retry</Button>
              </>
            )}

            {isSpotifyConnected && hasModifyScope && !isSpotifyLoading && !spotifyError && (
              <>
                {/* Summary cards for Spotify */}
                <div className="flex gap-4">
                  <Card className="flex-1">
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold">{pendingSpotifyGroups.length}</div>
                      <div className="text-sm text-muted-foreground">Duplicate groups remaining</div>
                    </CardContent>
                  </Card>
                  <Card className="flex-1">
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold">
                        {pendingSpotifyGroups.reduce((sum, g) => sum + g.tracks.length - 1, 0)}
                      </div>
                      <div className="text-sm text-muted-foreground">Tracks that will be removed</div>
                    </CardContent>
                  </Card>
                  <Card className="flex-1">
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold">{spotifyResolvedKeys.size}</div>
                      <div className="text-sm text-muted-foreground">Groups resolved this session</div>
                    </CardContent>
                  </Card>
                </div>

                {/* No duplicates */}
                {spotifyGroups.length === 0 && (
                  <div className="text-center py-16 text-muted-foreground">
                    <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
                    <p className="text-lg font-medium">No duplicates found</p>
                    <p className="text-sm mt-1">Your Spotify library has no liked songs with the same title and artist.</p>
                  </div>
                )}

                {/* All resolved */}
                {spotifyGroups.length > 0 && pendingSpotifyGroups.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
                    <p className="text-lg font-medium">All Spotify duplicates resolved!</p>
                    <Button className="mt-4" variant="outline" onClick={loadSpotifyDuplicates}>
                      Refresh
                    </Button>
                  </div>
                )}

                {/* Spotify duplicate groups */}
                {pendingSpotifyGroups.map((group) => {
                  const key = spotifyGroupKey(group);
                  const keepId = spotifyKeepSelections[key];

                  return (
                    <Card key={key}>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center justify-between text-base">
                          <div className="flex items-center gap-2">
                            <Music className="w-4 h-4 text-muted-foreground" />
                            <span>{group.tracks[0].title ?? '(no title)'}</span>
                            <span className="text-muted-foreground font-normal">—</span>
                            <span className="text-muted-foreground font-normal">{group.tracks[0].artist ?? '(no artist)'}</span>
                            <Badge variant="secondary">{group.tracks.length} copies</Badge>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleResolveSpotifyGroup(group)}
                            disabled={isSpotifyResolving}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Resolve
                          </Button>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <RadioGroup
                          value={keepId}
                          onValueChange={(val) => setSpotifyKeepSelections(prev => ({ ...prev, [key]: val }))}
                        >
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-10">Keep</TableHead>
                                <TableHead>Title</TableHead>
                                <TableHead>Artist</TableHead>
                                <TableHead>Album</TableHead>
                                <TableHead>Added</TableHead>
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
                                      <RadioGroupItem value={track.id} id={`spotify-keep-${track.id}`} />
                                      <Label htmlFor={`spotify-keep-${track.id}`} className="sr-only">Keep this copy</Label>
                                    </div>
                                  </TableCell>
                                  <TableCell>{track.title ?? '—'}</TableCell>
                                  <TableCell>{track.artist ?? '—'}</TableCell>
                                  <TableCell>{track.album ?? '—'}</TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {track.added_at ? new Date(track.added_at).toLocaleDateString() : '—'}
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
              </>
            )}
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}
