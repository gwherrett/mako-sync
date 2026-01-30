/**
 * Download Processor Service
 *
 * Processes downloaded MP3 files from slskd:
 * - Extracts metadata (artist, title, album, genre) using music-metadata-browser
 * - Maps ID3 genre tags to SuperGenre using the effective genre map
 * - Writes SuperGenre to TXXX:CUSTOM1 ID3 tag using browser-id3-writer
 * - Uses File System Access API to write tags back to original files in place
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
import type { FileWithHandle } from './directoryHandle.service';

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
 *
 * Looks for genres in multiple locations:
 * 1. metadata.common.genre (standard ID3v2 TCON frame)
 * 2. ID3v2 native TCON frames
 * 3. ID3v1 genre (older format)
 * 4. TXXX custom frames that might contain genre info
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

  // Collect genres from multiple sources
  const genresSet = new Set<string>();

  // 1. Standard common.genre (ID3v2 TCON)
  if (metadata.common.genre) {
    const commonGenres = Array.isArray(metadata.common.genre)
      ? metadata.common.genre
      : [metadata.common.genre];
    commonGenres.forEach((g) => g && genresSet.add(g));
  }

  // 2. Check native ID3v2 tags for additional genre info
  const id3v23 = metadata.native['ID3v2.3'] || [];
  const id3v24 = metadata.native['ID3v2.4'] || [];
  const id3v2Native = [...id3v23, ...id3v24];

  for (const tag of id3v2Native) {
    // TCON = Content type (genre)
    if (tag.id === 'TCON' && tag.value) {
      const val = typeof tag.value === 'string' ? tag.value : String(tag.value);
      // Handle numeric genre codes like "(17)" for Rock
      const cleaned = val.replace(/^\(\d+\)/, '').trim();
      if (cleaned) genresSet.add(cleaned);
    }
    // TXXX frames - check for genre-related custom tags
    if (tag.id === 'TXXX' && tag.value) {
      const txxx = tag.value as { description?: string; text?: string };
      const desc = (txxx.description || '').toLowerCase();
      // Look for genre-related TXXX frames (MediaMonkey and others use these)
      if (desc.includes('genre') || desc === 'style' || desc === 'styles') {
        const text = txxx.text || '';
        if (text) {
          // Split on common delimiters (semicolon, slash, comma)
          text.split(/[;/,]/).forEach((g) => {
            const trimmed = g.trim();
            if (trimmed) genresSet.add(trimmed);
          });
        }
      }
    }
  }

  // 3. Check ID3v1 tags (older format, stored at end of file)
  const id3v1Native = metadata.native['ID3v1'] || [];
  for (const tag of id3v1Native) {
    if (tag.id === 'genre' && tag.value) {
      const val = typeof tag.value === 'string' ? tag.value : String(tag.value);
      if (val) genresSet.add(val);
    }
  }

  // Debug: log files with no genres found but have native tags
  if (genresSet.size === 0) {
    const nativeKeys = Object.keys(metadata.native);
    if (nativeKeys.length > 0) {
      console.log(`🔍 No genre found for "${file.name}". Native tag formats:`, nativeKeys);
      // Log all native tags to help debug
      for (const format of nativeKeys) {
        const tags = metadata.native[format];
        console.log(`  ${format} tags:`, tags?.map((t: { id: string; value: unknown }) => ({ id: t.id, value: t.value })));
      }
    }
  }

  return {
    artist: metadata.common.artist || 'Unknown Artist',
    title: metadata.common.title || file.name.replace(/\.mp3$/i, ''),
    album: metadata.common.album || null,
    genres: Array.from(genresSet).filter(Boolean),
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
  genreMap: Map<string, string>,
  relativePath?: string,
  fileHandle?: FileSystemFileHandle
): Promise<ProcessedFile> {
  const path = relativePath || (file as any).webkitRelativePath || file.name;

  try {
    const metadata = await extractFileMetadata(file);
    const superGenre = mapToSuperGenre(metadata.genres, genreMap);

    // Files are only "mapped" if they have a SuperGenre assigned
    // Files with no genre tags OR unrecognized genres are "unmapped"
    const status: ProcessedFileStatus = superGenre ? 'mapped' : 'unmapped';

    return {
      filename: file.name,
      relativePath: path,
      artist: metadata.artist,
      title: metadata.title,
      album: metadata.album,
      genres: metadata.genres,
      superGenre,
      status,
      file,
      fileHandle,
    };
  } catch (error) {
    console.error(`Error processing ${file.name}:`, error);
    return {
      filename: file.name,
      relativePath: path,
      artist: 'Unknown',
      title: file.name.replace(/\.mp3$/i, ''),
      album: null,
      genres: [],
      superGenre: null,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      file,
      fileHandle,
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
 * Process files from File System Access API with handles for write-back
 *
 * @param filesWithHandles - Array of files with their handles from getAllMp3Files
 * @param genreMap - Map of genre -> SuperGenre from useGenreMap hook
 * @param onProgress - Optional callback for progress updates
 * @param batchSize - Number of files to process in parallel (default: 5)
 */
export async function processDownloadsWithHandles(
  filesWithHandles: FileWithHandle[],
  genreMap: Map<string, string>,
  onProgress?: (progress: ProcessingProgress) => void,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<ProcessingResult> {
  const processedFiles: ProcessedFile[] = [];
  const unmappedGenresSet = new Set<string>();

  console.log(`🎵 Processing ${filesWithHandles.length} MP3 files with handles...`);

  // Process files in batches
  for (let i = 0; i < filesWithHandles.length; i += batchSize) {
    const batch = filesWithHandles.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (fileWithHandle, index) => {
        const result = await processFile(
          fileWithHandle.file,
          genreMap,
          fileWithHandle.relativePath,
          fileWithHandle.handle
        );

        // Report progress
        if (onProgress) {
          onProgress({
            current: i + index + 1,
            total: filesWithHandles.length,
            currentFile: fileWithHandle.file.name,
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
 * Write SuperGenre to TXXX:CUSTOM1 ID3 tag while preserving existing tags
 *
 * ID3Writer replaces all tags by default, so we need to:
 * 1. Read existing metadata
 * 2. Re-write all important tags
 * 3. Add our CUSTOM1 tag
 *
 * @param file - The original MP3 file
 * @param superGenre - The SuperGenre to write
 * @returns A new Blob with the updated ID3 tag
 */
async function writeSuperGenreTag(file: File, superGenre: string): Promise<Blob> {
  // First, read existing metadata so we can preserve it
  const metadata = await parseBlob(file, {
    includeChapters: false,
    skipCovers: false, // We want to preserve cover art
  });

  const arrayBuffer = await file.arrayBuffer();
  const writer = new ID3Writer(arrayBuffer);

  // Preserve common tags
  const common = metadata.common;

  if (common.title) {
    writer.setFrame('TIT2', common.title);
  }
  if (common.artist) {
    writer.setFrame('TPE1', [common.artist]);
  }
  if (common.album) {
    writer.setFrame('TALB', common.album);
  }
  if (common.year) {
    writer.setFrame('TYER', common.year);
  }
  if (common.track?.no) {
    writer.setFrame('TRCK', common.track.of
      ? `${common.track.no}/${common.track.of}`
      : String(common.track.no));
  }
  if (common.genre && common.genre.length > 0) {
    writer.setFrame('TCON', common.genre);
  }
  if (common.albumartist) {
    writer.setFrame('TPE2', common.albumartist);
  }
  if (common.composer && common.composer.length > 0) {
    writer.setFrame('TCOM', common.composer);
  }
  if (common.comment && common.comment.length > 0) {
    writer.setFrame('COMM', {
      description: '',
      text: common.comment[0],
      language: 'eng',
    });
  }

  // Preserve existing TXXX frames (except CUSTOM1 which we'll overwrite)
  const id3v23 = metadata.native['ID3v2.3'] || [];
  const id3v24 = metadata.native['ID3v2.4'] || [];
  const id3v2Native = [...id3v23, ...id3v24];

  for (const tag of id3v2Native) {
    if (tag.id === 'TXXX' && tag.value) {
      const txxx = tag.value as { description?: string; text?: string };
      const desc = txxx.description || '';
      // Skip CUSTOM1 - we'll write our own
      if (desc.toUpperCase() !== 'CUSTOM1' && txxx.text) {
        writer.setFrame('TXXX', {
          description: desc,
          value: txxx.text,
        });
      }
    }
  }

  // Preserve cover art if present
  if (common.picture && common.picture.length > 0) {
    const pic = common.picture[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (writer as any).setFrame('APIC', {
      type: pic.type === 'Cover (front)' ? 3 : 0,
      data: pic.data,
      description: pic.description || '',
      useUnicodeEncoding: false,
    });
  }

  // Now add our SuperGenre to TXXX frame with description "CUSTOM1"
  writer.setFrame('TXXX', {
    description: 'CUSTOM1',
    value: superGenre,
  });

  writer.addTag();
  return writer.getBlob();
}

/**
 * Write SuperGenre tags to all mapped files in place using File System Access API
 *
 * @param files - Array of processed files to write tags to (must have fileHandle)
 * @param onProgress - Optional callback for progress updates
 * @returns Object with success count and any errors
 */
export async function writeTagsInPlace(
  files: ProcessedFile[],
  onProgress?: (progress: { current: number; total: number; filename: string }) => void
): Promise<{ success: number; errors: Array<{ filename: string; error: string }> }> {
  const mappedFiles = files.filter(
    (f) => f.status === 'mapped' && f.superGenre && f.fileHandle
  );
  const errors: Array<{ filename: string; error: string }> = [];
  let success = 0;

  console.log(`📝 Writing tags to ${mappedFiles.length} files in place...`);

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
      // Create tagged blob
      const taggedBlob = await writeSuperGenreTag(file.file, file.superGenre!);

      // Write back to original file using the handle
      const writable = await file.fileHandle!.createWritable();
      await writable.write(taggedBlob);
      await writable.close();

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

// Re-export for convenience
export { processDownloadsWithHandles as processDownloadsFromDirectory };
