/**
 * useDownloadProcessor Hook
 *
 * Manages state for processing downloaded MP3 files from slskd.
 * Integrates with useGenreMap for genre mapping and provides
 * progress tracking, error handling, and re-processing after
 * inline genre mapping updates.
 */

import { useState, useCallback } from 'react';
import { useGenreMap } from '@/hooks/useGenreMap';
import {
  processDownloads,
  reprocessWithUpdatedMap,
} from '@/services/downloadProcessor.service';
import type {
  ProcessedFile,
  ProcessingResult,
  ProcessingProgress,
} from '@/types/slskd';
import { useToast } from '@/hooks/use-toast';

interface UseDownloadProcessorReturn {
  /** Process a folder of downloaded files */
  processFiles: (files: FileList | File[]) => Promise<void>;
  /** Re-process files after genre map updates */
  reprocessFiles: () => void;
  /** Clear all results and reset state */
  reset: () => void;
  /** Processing result (files, unmapped genres, summary) */
  result: ProcessingResult | null;
  /** Current processing progress */
  progress: ProcessingProgress | null;
  /** Whether currently processing */
  isProcessing: boolean;
  /** Processing error if any */
  error: Error | null;
  /** Genre map loading state */
  isGenreMapLoading: boolean;
  /** Refetch genre map (after inline mapping) */
  refetchGenreMap: () => Promise<void>;
  /** Update a single file's superGenre (for inline mapping) */
  updateFileSuperGenre: (filename: string, superGenre: string) => void;
}

export function useDownloadProcessor(): UseDownloadProcessorReturn {
  const { toast } = useToast();
  const {
    genreMap,
    isLoading: isGenreMapLoading,
    refetch: refetchGenreMapQuery,
  } = useGenreMap();

  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Process a batch of files from folder selection
   */
  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      setIsProcessing(true);
      setError(null);
      setProgress({ current: 0, total: files.length, currentFile: '' });

      try {
        // Ensure genre map is loaded
        if (genreMap.size === 0) {
          console.log('⏳ Waiting for genre map to load...');
          await refetchGenreMapQuery();
        }

        const processingResult = await processDownloads(
          files,
          genreMap,
          (prog) => setProgress(prog)
        );

        setResult(processingResult);

        // Show toast with summary
        const { summary } = processingResult;
        if (summary.total === 0) {
          toast({
            title: 'No audio files found',
            description: 'The selected folder contains no supported audio files (MP3, FLAC, M4A).',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Processing Complete',
            description: `Processed ${summary.total} files: ${summary.mapped} mapped, ${summary.unmapped} unmapped, ${summary.errors} errors`,
          });
        }
      } catch (err) {
        const processError =
          err instanceof Error ? err : new Error('Unknown processing error');
        setError(processError);
        toast({
          title: 'Processing Failed',
          description: processError.message,
          variant: 'destructive',
        });
      } finally {
        setIsProcessing(false);
        setProgress(null);
      }
    },
    [genreMap, refetchGenreMapQuery, toast]
  );

  /**
   * Re-process existing files after genre map updates
   */
  const reprocessFiles = useCallback(() => {
    if (!result) return;

    const updatedResult = reprocessWithUpdatedMap(result.files, genreMap);
    setResult(updatedResult);

    toast({
      title: 'Re-processed',
      description: `${updatedResult.summary.mapped} files now mapped`,
    });
  }, [result, genreMap, toast]);

  /**
   * Update a single file's superGenre (used for inline mapping in UI)
   */
  const updateFileSuperGenre = useCallback(
    (filename: string, superGenre: string) => {
      if (!result) return;

      const updatedFiles = result.files.map((file) => {
        if (file.filename === filename) {
          return {
            ...file,
            superGenre,
            status: 'mapped' as const,
          };
        }
        return file;
      });

      // Recalculate unmapped genres
      const unmappedGenresSet = new Set<string>();
      updatedFiles.forEach((file) => {
        if (file.status === 'unmapped') {
          file.genres.forEach((genre) => {
            unmappedGenresSet.add(genre.toLowerCase().trim());
          });
        }
      });

      const summary = {
        total: updatedFiles.length,
        mapped: updatedFiles.filter((f) => f.status === 'mapped').length,
        unmapped: updatedFiles.filter((f) => f.status === 'unmapped').length,
        errors: updatedFiles.filter((f) => f.status === 'error').length,
      };

      setResult({
        files: updatedFiles,
        unmappedGenres: Array.from(unmappedGenresSet).sort(),
        summary,
      });
    },
    [result]
  );

  /**
   * Reset all state
   */
  const reset = useCallback(() => {
    setResult(null);
    setProgress(null);
    setError(null);
    setIsProcessing(false);
  }, []);

  /**
   * Refetch genre map and re-process files
   */
  const refetchGenreMap = useCallback(async () => {
    await refetchGenreMapQuery();
    // Automatically re-process if we have results
    if (result) {
      reprocessFiles();
    }
  }, [refetchGenreMapQuery, result, reprocessFiles]);

  return {
    processFiles,
    reprocessFiles,
    reset,
    result,
    progress,
    isProcessing,
    error,
    isGenreMapLoading,
    refetchGenreMap,
    updateFileSuperGenre,
  };
}
