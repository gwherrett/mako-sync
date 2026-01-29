/**
 * DownloadProcessingSection Component
 *
 * Processes downloaded MP3 files from slskd:
 * - Uses File System Access API for persistent folder access
 * - Extracts metadata and maps genres to SuperGenre
 * - Inline genre mapping for unmapped genres
 * - Writes SuperGenre to TXXX:CUSTOM1 ID3 tag in place
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FolderOpen,
  Loader2,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  Music,
  Save,
  FolderSync,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { SUPER_GENRES } from '@/types/genreMapping';
import { useGenreMap } from '@/hooks/useGenreMap';
import {
  processDownloadsWithHandles,
  reprocessWithUpdatedMap,
  writeTagsInPlace,
} from '@/services/downloadProcessor.service';
import {
  isFileSystemAccessSupported,
  getDownloadsDirectory,
  getAllMp3Files,
} from '@/services/directoryHandle.service';
import { Link } from 'react-router-dom';
import type { ProcessedFile, ProcessingProgress, ProcessingResult } from '@/types/slskd';

export function DownloadProcessingSection() {
  const { toast } = useToast();
  const { genreMap, isLoading: isGenreMapLoading, refetch: refetchGenreMap } = useGenreMap();

  // Directory handle state (loaded from persisted storage, configured in Security)
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(true);

  // Processing state
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Tag writing state
  const [isWritingTags, setIsWritingTags] = useState(false);
  const [writeProgress, setWriteProgress] = useState<{
    current: number;
    total: number;
    filename: string;
  } | null>(null);

  // Inline mapping state
  const [savingGenre, setSavingGenre] = useState<string | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<'all' | 'mapped' | 'unmapped' | 'error'>('all');

  // Check for File System Access API support
  const isSupported = isFileSystemAccessSupported();

  // Load the saved directory handle on mount (configured in Security settings)
  useEffect(() => {
    async function loadHandle() {
      if (!isSupported) {
        setIsLoadingDirectory(false);
        return;
      }

      try {
        const handle = await getDownloadsDirectory();
        setDirectoryHandle(handle);
      } catch (error) {
        console.error('Failed to load directory handle:', error);
      } finally {
        setIsLoadingDirectory(false);
      }
    }

    loadHandle();
  }, [isSupported]);

  // Process files from the directory
  const handleProcessFiles = async () => {
    if (!directoryHandle) return;

    setIsProcessing(true);
    setProgress(null);
    setResult(null);

    try {
      // Get all MP3 files with their handles
      const filesWithHandles = await getAllMp3Files(directoryHandle);

      if (filesWithHandles.length === 0) {
        toast({
          title: 'No MP3 Files Found',
          description: 'No MP3 files were found in the selected folder',
          variant: 'destructive',
        });
        setIsProcessing(false);
        return;
      }

      // Process files
      const processingResult = await processDownloadsWithHandles(
        filesWithHandles,
        genreMap,
        (prog) => setProgress(prog)
      );

      setResult(processingResult);
    } catch (error) {
      console.error('Processing failed:', error);
      toast({
        title: 'Processing Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  // Re-process with updated genre map
  const handleReprocessFiles = useCallback(() => {
    if (!result) return;
    const updatedResult = reprocessWithUpdatedMap(result.files, genreMap);
    setResult(updatedResult);
  }, [result, genreMap]);

  // Update a single file's SuperGenre
  const updateFileSuperGenre = useCallback((filename: string, superGenre: string) => {
    setResult((prevResult) => {
      if (!prevResult) return prevResult;

      const updatedFiles = prevResult.files.map((f) => {
        if (f.filename === filename) {
          return { ...f, superGenre, status: 'mapped' as const };
        }
        return f;
      });

      const summary = {
        total: updatedFiles.length,
        mapped: updatedFiles.filter((f) => f.status === 'mapped').length,
        unmapped: updatedFiles.filter((f) => f.status === 'unmapped').length,
        errors: updatedFiles.filter((f) => f.status === 'error').length,
      };

      // Recalculate unmapped genres
      const unmappedGenresSet = new Set<string>();
      updatedFiles.forEach((f) => {
        if (f.status === 'unmapped' && f.genres.length > 0) {
          f.genres.forEach((g) => unmappedGenresSet.add(g.toLowerCase().trim()));
        }
      });

      return {
        files: updatedFiles,
        unmappedGenres: Array.from(unmappedGenresSet).sort(),
        summary,
      };
    });
  }, []);

  // Save a new genre mapping and update the file
  const handleSaveMapping = async (file: ProcessedFile, superGenre: string) => {
    // For files with no genre tags, just update local state (no mapping to save)
    if (file.genres.length === 0) {
      updateFileSuperGenre(file.filename, superGenre);
      toast({
        title: 'SuperGenre Assigned',
        description: `Assigned ${superGenre} to "${file.artist} - ${file.title}"`,
      });
      return;
    }

    const genreToMap = file.genres[0];
    setSavingGenre(genreToMap);

    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/genre-mapping`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.session.access_token}`,
          },
          body: JSON.stringify({
            spotify_genre: genreToMap,
            super_genre: superGenre,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save mapping');
      }

      updateFileSuperGenre(file.filename, superGenre);
      await refetchGenreMap();

      toast({
        title: 'Mapping Saved',
        description: `"${genreToMap}" → ${superGenre}`,
      });
    } catch (error) {
      console.error('Failed to save genre mapping:', error);
      toast({
        title: 'Failed to Save Mapping',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSavingGenre(null);
    }
  };

  // Write tags to files in place
  const handleWriteTags = async () => {
    if (!result || result.summary.mapped === 0) return;

    // Check if files have handles
    const filesWithHandles = result.files.filter((f) => f.fileHandle);
    if (filesWithHandles.length === 0) {
      toast({
        title: 'Cannot Write Tags',
        description: 'Files do not have write access. Please re-select the folder.',
        variant: 'destructive',
      });
      return;
    }

    setIsWritingTags(true);
    setWriteProgress(null);

    try {
      const { success, errors } = await writeTagsInPlace(
        result.files,
        (prog) => setWriteProgress(prog)
      );

      if (errors.length > 0) {
        toast({
          title: 'Tag Writing Complete (with errors)',
          description: `${success} files updated, ${errors.length} failed`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Tags Written Successfully',
          description: `${success} files updated with SuperGenre tags`,
        });
      }
    } catch (error) {
      console.error('Tag writing failed:', error);
      toast({
        title: 'Tag Writing Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsWritingTags(false);
      setWriteProgress(null);
    }
  };

  // Reset results
  const handleReset = () => {
    setResult(null);
    setProgress(null);
    setStatusFilter('all');
  };

  // Filter files based on status
  const filteredFiles = result?.files.filter((file) => {
    if (statusFilter === 'all') return true;
    return file.status === statusFilter;
  }) ?? [];

  // Get status badge
  const getStatusBadge = (status: ProcessedFile['status']) => {
    switch (status) {
      case 'mapped':
        return (
          <Badge variant="default" className="bg-green-500">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Mapped
          </Badge>
        );
      case 'unmapped':
        return (
          <Badge variant="secondary" className="bg-yellow-500 text-white">
            <AlertCircle className="h-3 w-3 mr-1" />
            Unmapped
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
    }
  };

  const progressPercent = progress ? (progress.current / progress.total) * 100 : 0;

  // Browser not supported
  if (!isSupported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Process Downloads
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your browser does not support the File System Access API.
              Please use Chrome, Edge, or another Chromium-based browser.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5" />
          Process Downloads
        </CardTitle>
        <CardDescription>
          Scan downloaded files from slskd, map genres to SuperGenre, and write
          CUSTOM1 tags for MediaMonkey organization.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Directory status */}
        <div className="space-y-2">
          {isLoadingDirectory ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking for saved folder access...
            </div>
          ) : directoryHandle ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md">
                <FolderOpen className="h-4 w-4" />
                <span className="font-medium">{directoryHandle.name}</span>
                <Badge variant="outline" className="text-xs">Read/Write</Badge>
              </div>
              <Link to="/security">
                <Button variant="outline" size="sm">
                  Change in Settings
                </Button>
              </Link>
            </div>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No downloads folder configured.{' '}
                <Link to="/security" className="font-medium underline">
                  Configure in Security Settings
                </Link>{' '}
                to enable tag writing.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Scan button */}
        {directoryHandle && !result && (
          <Button
            onClick={handleProcessFiles}
            disabled={isProcessing || isGenreMapLoading}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FolderSync className="h-4 w-4 mr-2" />
            )}
            Scan for MP3 Files
          </Button>
        )}

        {/* Processing progress */}
        {isProcessing && progress && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">
                Processing {progress.current} of {progress.total}...
              </span>
            </div>
            <Progress value={progressPercent} className="h-2" />
            <p className="text-xs text-muted-foreground truncate">
              {progress.currentFile}
            </p>
          </div>
        )}

        {/* Genre map loading */}
        {isGenreMapLoading && !isProcessing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading genre mappings...
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Summary with filter buttons */}
            <div className="flex flex-wrap gap-2 text-sm">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('all')}
                className="h-8"
              >
                <Music className="h-4 w-4 mr-1" />
                All ({result.summary.total})
              </Button>
              <Button
                variant={statusFilter === 'mapped' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('mapped')}
                className={`h-8 ${statusFilter !== 'mapped' ? 'text-green-600 border-green-300 hover:bg-green-50' : 'bg-green-600 hover:bg-green-700'}`}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Mapped ({result.summary.mapped})
              </Button>
              <Button
                variant={statusFilter === 'unmapped' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('unmapped')}
                className={`h-8 ${statusFilter !== 'unmapped' ? 'text-yellow-600 border-yellow-300 hover:bg-yellow-50' : 'bg-yellow-600 hover:bg-yellow-700'}`}
              >
                <AlertCircle className="h-4 w-4 mr-1" />
                Unmapped ({result.summary.unmapped})
              </Button>
              <Button
                variant={statusFilter === 'error' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('error')}
                className={`h-8 ${statusFilter !== 'error' ? 'text-red-600 border-red-300 hover:bg-red-50' : 'bg-red-600 hover:bg-red-700'}`}
              >
                <XCircle className="h-4 w-4 mr-1" />
                Errors ({result.summary.errors})
              </Button>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={handleReset}>
                  Clear
                </Button>
                {result.summary.unmapped > 0 && (
                  <Button variant="ghost" size="sm" onClick={handleReprocessFiles}>
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Re-check
                  </Button>
                )}
                {result.summary.mapped > 0 && (
                  <Button
                    size="sm"
                    onClick={handleWriteTags}
                    disabled={isWritingTags}
                  >
                    {isWritingTags ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Write Tags ({result.summary.mapped})
                  </Button>
                )}
              </div>
            </div>

            {/* Tag writing progress */}
            {isWritingTags && writeProgress && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">
                    Writing tags: {writeProgress.current} of {writeProgress.total}...
                  </span>
                </div>
                <Progress
                  value={(writeProgress.current / writeProgress.total) * 100}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground truncate">
                  {writeProgress.filename}
                </p>
              </div>
            )}

            {/* Unmapped genres alert */}
            {result.unmappedGenres.length > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <span className="font-medium">
                    {result.unmappedGenres.length} unmapped genre(s):
                  </span>{' '}
                  {result.unmappedGenres.slice(0, 5).join(', ')}
                  {result.unmappedGenres.length > 5 &&
                    ` and ${result.unmappedGenres.length - 5} more`}
                  <br />
                  <span className="text-xs">
                    Use the dropdown below to assign SuperGenres. Mappings are
                    saved for future use.
                  </span>
                </AlertDescription>
              </Alert>
            )}

            {/* Files table */}
            {filteredFiles.length > 0 && (
              <div className="border rounded-lg max-h-96 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead className="w-[300px]">Track</TableHead>
                      <TableHead>ID3 Genre(s)</TableHead>
                      <TableHead>SuperGenre</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFiles.map((file) => (
                      <TableRow key={file.relativePath}>
                        <TableCell>
                          <div className="font-medium truncate max-w-[280px]">
                            {file.artist} - {file.title}
                          </div>
                          {file.album && (
                            <div className="text-xs text-muted-foreground truncate">
                              {file.album}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {file.genres.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {file.genres.map((genre, idx) => (
                                <Badge
                                  key={idx}
                                  variant="outline"
                                  className="text-xs"
                                >
                                  {genre}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              No genre tag
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {file.status === 'mapped' && file.superGenre ? (
                            <Badge>{file.superGenre}</Badge>
                          ) : file.status === 'unmapped' ? (
                            <Select
                              onValueChange={(value) =>
                                handleSaveMapping(file, value)
                              }
                              disabled={savingGenre === file.genres[0]}
                            >
                              <SelectTrigger className="w-36 h-8">
                                <SelectValue placeholder="Select..." />
                              </SelectTrigger>
                              <SelectContent>
                                {[...SUPER_GENRES].sort().map((sg) => (
                                  <SelectItem key={sg} value={sg}>
                                    {sg}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : file.status === 'error' ? (
                            <span
                              className="text-xs text-destructive truncate"
                              title={file.error}
                            >
                              {file.error}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>{getStatusBadge(file.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Empty state for filtered results */}
            {result.files.length > 0 && filteredFiles.length === 0 && (
              <div className="text-center py-8 text-muted-foreground border rounded-lg">
                <p>No files match the current filter.</p>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setStatusFilter('all')}
                  className="mt-2"
                >
                  Show all files
                </Button>
              </div>
            )}

            {/* Instructions */}
            <p className="text-sm text-muted-foreground">
              Click "Write Tags" to save SuperGenre to TXXX:CUSTOM1 tag directly in your files.
              Then use MediaMonkey to organize files into Supercrates/[genre]/ folders.
            </p>
          </>
        )}

        {/* Empty state - folder configured */}
        {directoryHandle && !result && !isProcessing && (
          <div className="text-center py-8 text-muted-foreground">
            <FolderSync className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Click "Scan for MP3 Files" to process your downloads.</p>
          </div>
        )}

        {/* Empty state - no folder configured */}
        {!directoryHandle && !isLoadingDirectory && (
          <div className="text-center py-8 text-muted-foreground">
            <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Configure your downloads folder in Security Settings to get started.</p>
            <Link to="/security">
              <Button variant="outline" className="mt-4">
                Go to Security Settings
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
