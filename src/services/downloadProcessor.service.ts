/**
 * Download Processor Service
 *
 * Processes downloaded MP3 files from slskd:
 * - Extracts metadata (artist, title, album, genre) using music-metadata-browser
 * - Maps ID3 genre tags to SuperGenre using the effective genre map
 * - Writes SuperGenre to TXXX:CUSTOM1 ID3 tag using browser-id3-writer
 * - Collects unmapped genres for inline mapping in UI
 */

import { parseBlob } from 'music-metadata-browser';
import { ID3Writer } from 'browser-id3-writer';
import { Buffer } from 'buffer';
import { withTimeout } from '@/utils/promiseUtils';
import type {
  ProcessedFile,
  ProcessingResult,
  ProcessingProgress,
  ProcessedFileStatus,
} from '@/types/slskd';

// Make Buffer available globally for music-metadata-browser
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}

// Timeout for parsing individual files (30 seconds)
const PARSE_TIMEOUT_MS = 30000;

// Default batch size for parallel processing
const DEFAULT_BATCH_SIZE = 5;

/**
 * Extract metadata from a single MP3 file
 */
async function extractFileMetadata(file: File): Promise<{
  artist: string;
  title: string;
  album: string | null;
  genres: string[];
}> {
  const metadata = await withTimeout(
    parseBlob(file, {
      includeChapters: false,
      skipCovers: true,
    }),
    PARSE_TIMEOUT_MS,
    `Metadata parsing timed out for ${file.name}`
  );

  // Extract genres - can be array or single value
  let genres: string[] = [];
  if (metadata.common.genre) {
    genres = Array.isArray(metadata.common.genre)
      ? metadata.common.genre
      : [metadata.common.genre];
  }

  return {
    artist: metadata.common.artist || 'Unknown Artist',
    title: metadata.common.title || file.name.replace(/\.mp3$/i, ''),
    album: metadata.common.album || null,
    genres: genres.filter(Boolean),
  };
}

/**
 * Map genre(s) to SuperGenre using the genre mapping
 *
 * Matching strategy:
 * 1. Exact match (case-insensitive)
 * 2. Partial match - genre contains a mapped key or vice versa
 *
 * Returns the first successful match, or null if no mapping found.
 */
function mapToSuperGenre(
  genres: string[],
  genreMap: Map<string, string>
): string | null {
  for (const genre of genres) {
    const normalizedGenre = genre.toLowerCase().trim();

    // Try exact match first
    if (genreMap.has(normalizedGenre)) {
      return genreMap.get(normalizedGenre)!;
    }

    // Try partial matching - check if any mapped genre is contained in this genre
    for (const [mappedGenre, superGenre] of genreMap.entries()) {
      if (
        normalizedGenre.includes(mappedGenre) ||
        mappedGenre.includes(normalizedGenre)
      ) {
        return superGenre;
      }
    }
  }

  return null;
}

/**
 * Process a single MP3 file
 */
async function processFile(
  file: File,
  genreMap: Map<string, string>
): Promise<ProcessedFile> {
  const relativePath =
    (file as any).webkitRelativePath || file.name;

  try {
    const metadata = await extractFileMetadata(file);
    const superGenre = mapToSuperGenre(metadata.genres, genreMap);

    // Files are only "mapped" if they have a SuperGenre assigned
    // Files with no genre tags OR unrecognized genres are "unmapped"
    const status: ProcessedFileStatus = superGenre ? 'mapped' : 'unmapped';

    return {
      filename: file.name,
      relativePath,
      artist: metadata.artist,
      title: metadata.title,
      album: metadata.album,
      genres: metadata.genres,
      superGenre,
      status,
      file,
    };
  } catch (error) {
    console.error(`Error processing ${file.name}:`, error);
    return {
      filename: file.name,
      relativePath,
      artist: 'Unknown',
      title: file.name.replace(/\.mp3$/i, ''),
      album: null,
      genres: [],
      superGenre: null,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      file,
    };
  }
}

/**
 * Filter files to only include MP3s
 */
function filterMp3Files(files: FileList | File[]): File[] {
  const fileArray = Array.from(files);
  return fileArray.filter((file) => {
    const name = file.name.toLowerCase();
    return name.endsWith('.mp3');
  });
}

/**
 * Process a batch of downloaded MP3 files
 *
 * @param files - FileList from input element or array of Files
 * @param genreMap - Map of genre -> SuperGenre from useGenreMap hook
 * @param onProgress - Optional callback for progress updates
 * @param batchSize - Number of files to process in parallel (default: 5)
 */
export async function processDownloads(
  files: FileList | File[],
  genreMap: Map<string, string>,
  onProgress?: (progress: ProcessingProgress) => void,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<ProcessingResult> {
  const mp3Files = filterMp3Files(files);
  const processedFiles: ProcessedFile[] = [];
  const unmappedGenresSet = new Set<string>();

  console.log(`🎵 Processing ${mp3Files.length} MP3 files...`);

  // Process files in batches
  for (let i = 0; i < mp3Files.length; i += batchSize) {
    const batch = mp3Files.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (file, index) => {
        const result = await processFile(file, genreMap);

        // Report progress
        if (onProgress) {
          onProgress({
            current: i + index + 1,
            total: mp3Files.length,
            currentFile: file.name,
          });
        }

        return result;
      })
    );

    processedFiles.push(...batchResults);

    // Collect unmapped genres
    batchResults.forEach((result) => {
      if (result.status === 'unmapped') {
        result.genres.forEach((genre) => {
          unmappedGenresSet.add(genre.toLowerCase().trim());
        });
      }
    });
  }

  // Calculate summary
  const summary = {
    total: processedFiles.length,
    mapped: processedFiles.filter((f) => f.status === 'mapped').length,
    unmapped: processedFiles.filter((f) => f.status === 'unmapped').length,
    errors: processedFiles.filter((f) => f.status === 'error').length,
  };

  console.log(`✅ Processing complete:`, summary);

  return {
    files: processedFiles,
    unmappedGenres: Array.from(unmappedGenresSet).sort(),
    summary,
  };
}

/**
 * Re-process files after genre mappings are updated
 * Useful after user adds inline mappings for unmapped genres
 */
export function reprocessWithUpdatedMap(
  processedFiles: ProcessedFile[],
  genreMap: Map<string, string>
): ProcessingResult {
  const unmappedGenresSet = new Set<string>();

  const updatedFiles = processedFiles.map((file) => {
    // Skip files that had errors - they stay as errors
    if (file.status === 'error') {
      return file;
    }

    // For files with no genre tags, preserve any manually assigned SuperGenre
    if (file.genres.length === 0) {
      // Keep existing superGenre if it was manually assigned
      if (file.superGenre) {
        return file; // Already mapped manually, keep as-is
      }
      // Still unmapped, no genres to map
      return {
        ...file,
        superGenre: null,
        status: 'unmapped' as ProcessedFileStatus,
      };
    }

    // Re-attempt mapping for files with genres
    const superGenre = mapToSuperGenre(file.genres, genreMap);

    // Files are only "mapped" if they have a SuperGenre assigned
    const status: ProcessedFileStatus = superGenre ? 'mapped' : 'unmapped';

    if (!superGenre) {
      file.genres.forEach((genre) => {
        unmappedGenresSet.add(genre.toLowerCase().trim());
      });
    }

    return {
      ...file,
      superGenre,
      status,
    };
  });

  const summary = {
    total: updatedFiles.length,
    mapped: updatedFiles.filter((f) => f.status === 'mapped').length,
    unmapped: updatedFiles.filter((f) => f.status === 'unmapped').length,
    errors: updatedFiles.filter((f) => f.status === 'error').length,
  };

  return {
    files: updatedFiles,
    unmappedGenres: Array.from(unmappedGenresSet).sort(),
    summary,
  };
}

/**
 * Write SuperGenre to TXXX:CUSTOM1 ID3 tag
 *
 * @param file - The original MP3 file
 * @param superGenre - The SuperGenre to write
 * @returns A new Blob with the updated ID3 tag
 */
async function writeSuperGenreTag(file: File, superGenre: string): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const writer = new ID3Writer(arrayBuffer);

  // Write SuperGenre to TXXX frame with description "CUSTOM1"
  // This is the tag MediaMonkey and other tools can read
  writer.setFrame('TXXX', {
    description: 'CUSTOM1',
    value: superGenre,
  });

  writer.addTag();
  return writer.getBlob();
}

/**
 * Write SuperGenre tags to all mapped files and trigger download
 *
 * @param files - Array of processed files to write tags to
 * @param onProgress - Optional callback for progress updates
 * @returns Object with success count and any errors
 */
export async function writeTagsAndDownload(
  files: ProcessedFile[],
  onProgress?: (progress: { current: number; total: number; filename: string }) => void
): Promise<{ success: number; errors: Array<{ filename: string; error: string }> }> {
  const mappedFiles = files.filter((f) => f.status === 'mapped' && f.superGenre);
  const errors: Array<{ filename: string; error: string }> = [];
  let success = 0;

  console.log(`📝 Writing tags to ${mappedFiles.length} files...`);

  for (let i = 0; i < mappedFiles.length; i++) {
    const file = mappedFiles[i];

    if (onProgress) {
      onProgress({
        current: i + 1,
        total: mappedFiles.length,
        filename: file.filename,
      });
    }

    try {
      const taggedBlob = await writeSuperGenreTag(file.file, file.superGenre!);

      // Create download link and trigger download
      const url = URL.createObjectURL(taggedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      success++;
    } catch (error) {
      console.error(`Failed to write tag to ${file.filename}:`, error);
      errors.push({
        filename: file.filename,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  console.log(`✅ Tag writing complete: ${success} success, ${errors.length} errors`);

  return { success, errors };
}

// Export for testing
export const _testExports = {
  extractFileMetadata,
  mapToSuperGenre,
  processFile,
  filterMp3Files,
  writeSuperGenreTag,
};
