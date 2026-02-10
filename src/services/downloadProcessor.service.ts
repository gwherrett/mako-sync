/**
 * Download Processor Service
 *
 * Processes downloaded MP3 files from slskd:
 * - Extracts metadata (artist, title, album, genre) using music-metadata-browser
 * - Maps ID3 genre tags to SuperGenre using the effective genre map
 * - Writes SuperGenre to Grouping (TIT1) ID3 tag using browser-id3-writer
 * - Uses File System Access API to write tags back to original files in place
 *
 * Grouping (TIT1) is a standard ID3 field supported by all major DJ software
 * (Serato, Rekordbox, Traktor) and media players (MediaMonkey, iTunes).
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
import { isSupportedAudioFile, stripAudioExtension } from './fileScanner';

// Make Buffer available globally for music-metadata-browser
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}

// Timeout for parsing individual files (30 seconds)
const PARSE_TIMEOUT_MS = 30000;

// Default batch size for parallel processing
const DEFAULT_BATCH_SIZE = 5;

/**
 * Read the existing Grouping (TIT1) tag from a file
 * Used to check if we need to write or can skip
 */
async function getExistingGroupingTag(file: File): Promise<string | null> {
  try {
    const metadata = await withTimeout(
      parseBlob(file, {
        includeChapters: false,
        skipCovers: true,
      }),
      PARSE_TIMEOUT_MS,
      `Metadata parsing timed out for ${file.name}`
    );

    // Check native ID3v2 tags for TIT1 (Grouping)
    const id3v23 = metadata.native['ID3v2.3'] || [];
    const id3v24 = metadata.native['ID3v2.4'] || [];
    const id3v2Native = [...id3v23, ...id3v24];

    for (const tag of id3v2Native) {
      if (tag.id === 'TIT1' && tag.value) {
        return typeof tag.value === 'string' ? tag.value : String(tag.value);
      }
    }

    return null;
  } catch {
    // If we can't read metadata, assume we need to write
    return null;
  }
}

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
    title: metadata.common.title || stripAudioExtension(file.name),
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
      title: stripAudioExtension(file.name),
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
 * Filter files to only include supported audio formats (MP3, FLAC, M4A)
 */
function filterAudioFiles(files: FileList | File[]): File[] {
  const fileArray = Array.from(files);
  return fileArray.filter((file) => isSupportedAudioFile(file.name));
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
  const audioFiles = filterAudioFiles(files);
  const processedFiles: ProcessedFile[] = [];
  const unmappedGenresSet = new Set<string>();

  console.log(`🎵 Processing ${audioFiles.length} audio files...`);

  // Process files in batches
  for (let i = 0; i < audioFiles.length; i += batchSize) {
    const batch = audioFiles.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (file, index) => {
        const result = await processFile(file, genreMap);

        // Report progress
        if (onProgress) {
          onProgress({
            current: i + index + 1,
            total: audioFiles.length,
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

  console.log(`🎵 Processing ${filesWithHandles.length} audio files with handles...`);

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
 * Write SuperGenre to Grouping (TIT1) ID3 tag while preserving existing tags
 *
 * Grouping (TIT1) is a standard ID3 field supported by all major DJ software
 * (Serato, Rekordbox, Traktor) and media players (MediaMonkey, iTunes).
 *
 * ID3Writer replaces all tags by default, so we need to:
 * 1. Read existing metadata
 * 2. Re-write all important tags
 * 3. Add SuperGenre to Grouping field
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

  return writeSuperGenreTagFromMetadata(file, superGenre, metadata);
}

/**
 * Write SuperGenre tag using pre-parsed metadata (avoids re-parsing the file)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeSuperGenreTagFromMetadata(file: File, superGenre: string, metadata: any): Promise<Blob> {
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
  // Preserve existing TXXX and COMM frames from native tags
  const id3v23 = metadata.native['ID3v2.3'] || [];
  const id3v24 = metadata.native['ID3v2.4'] || [];
  const id3v2Native = [...id3v23, ...id3v24];

  let hasDefaultComment = false;
  for (const tag of id3v2Native) {
    // Preserve TXXX frames
    if (tag.id === 'TXXX' && tag.value) {
      const txxx = tag.value as { description?: string; text?: string };
      const desc = txxx.description || '';
      if (txxx.text) {
        writer.setFrame('TXXX', {
          description: desc,
          value: txxx.text,
        });
      }
    }
    // Preserve all COMM frames
    if (tag.id === 'COMM' && tag.value) {
      const comm = tag.value as { description?: string; text?: string; language?: string };
      const desc = comm.description || '';
      if (comm.text) {
        writer.setFrame('COMM', {
          description: desc,
          text: comm.text,
          language: comm.language || 'eng',
        });
        if (desc === '') hasDefaultComment = true;
      }
    }
  }

  // If no native COMM frame with empty description was found, use common.comment as fallback
  if (!hasDefaultComment && common.comment && common.comment.length > 0) {
    writer.setFrame('COMM', {
      description: '',
      text: common.comment[0],
      language: 'eng',
    });
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

  // Write SuperGenre to Grouping field (TIT1)
  // Standard ID3 field supported by Serato, Rekordbox, Traktor, MediaMonkey, iTunes
  writer.setFrame('TIT1', superGenre);

  writer.addTag();
  return writer.getBlob();
}

// Batch size for parallel tag writing
const TAG_WRITE_BATCH_SIZE = 5;

/**
 * Process a single file for tag writing: parse once, check if skip needed, write if not.
 * Returns 'skipped' | 'written' | error string.
 */
async function writeTagForSingleFile(
  file: ProcessedFile
): Promise<'skipped' | 'written'> {
  // Single parse: read metadata (with covers for preservation) and check existing TIT1
  const metadata = await withTimeout(
    parseBlob(file.file, {
      includeChapters: false,
      skipCovers: false,
    }),
    PARSE_TIMEOUT_MS,
    `Metadata parsing timed out for ${file.filename}`
  );

  // Check existing grouping tag from the already-parsed metadata
  const id3v23 = metadata.native['ID3v2.3'] || [];
  const id3v24 = metadata.native['ID3v2.4'] || [];
  const id3v2Native = [...id3v23, ...id3v24];

  for (const tag of id3v2Native) {
    if (tag.id === 'TIT1' && tag.value) {
      const existingGrouping = typeof tag.value === 'string' ? tag.value : String(tag.value);
      if (existingGrouping === file.superGenre) {
        return 'skipped';
      }
      break;
    }
  }

  // Write tag using the already-parsed metadata (no second parse)
  const taggedBlob = await writeSuperGenreTagFromMetadata(file.file, file.superGenre!, metadata);

  // Write back to original file using the handle
  const writable = await file.fileHandle!.createWritable();
  await writable.write(taggedBlob);
  await writable.close();

  return 'written';
}

/**
 * Write SuperGenre tags to all mapped files in place using File System Access API
 *
 * Optimized with:
 * - Single parse per file (check existing tag + read metadata in one pass)
 * - Parallel batching (processes TAG_WRITE_BATCH_SIZE files concurrently)
 * - Skip files where existing Grouping tag already matches target
 *
 * @param files - Array of processed files to write tags to (must have fileHandle)
 * @param onProgress - Optional callback for progress updates
 * @returns Object with success count, skipped count, and any errors
 */
export async function writeTagsInPlace(
  files: ProcessedFile[],
  onProgress?: (progress: { current: number; total: number; filename: string; skipped?: boolean }) => void
): Promise<{ success: number; skipped: number; errors: Array<{ filename: string; error: string }> }> {
  const mappedFiles = files.filter(
    (f) => f.status === 'mapped' && f.superGenre && f.fileHandle
  );
  const errors: Array<{ filename: string; error: string }> = [];
  let success = 0;
  let skipped = 0;

  console.log(`📝 Processing ${mappedFiles.length} mapped files for tag writing...`);

  // Process in parallel batches
  for (let i = 0; i < mappedFiles.length; i += TAG_WRITE_BATCH_SIZE) {
    const batch = mappedFiles.slice(i, i + TAG_WRITE_BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (file, index) => {
        try {
          const result = await writeTagForSingleFile(file);

          if (onProgress) {
            onProgress({
              current: i + index + 1,
              total: mappedFiles.length,
              filename: file.filename,
              skipped: result === 'skipped',
            });
          }

          return { filename: file.filename, result };
        } catch (error) {
          console.error(`Failed to write tag to ${file.filename}:`, error);

          if (onProgress) {
            onProgress({
              current: i + index + 1,
              total: mappedFiles.length,
              filename: file.filename,
              skipped: false,
            });
          }

          return {
            filename: file.filename,
            result: 'error' as const,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      })
    );

    for (const res of batchResults) {
      if (res.result === 'written') success++;
      else if (res.result === 'skipped') skipped++;
      else if (res.result === 'error') errors.push({ filename: res.filename, error: (res as any).error });
    }
  }

  console.log(`✅ Tag writing complete: ${success} written, ${skipped} skipped (already correct), ${errors.length} errors`);

  return { success, skipped, errors };
}

/**
 * Debug metadata result type
 */
export interface FileDebugMetadata {
  nativeFormats: string[];
  tags: Record<string, Array<{ id: string; value: unknown }>>;
  extracted: {
    artist: string;
    title: string;
    album: string | null;
    genres: string[];
  };
  common: {
    title?: string;
    artist?: string;
    album?: string;
    genre?: string[];
    year?: number;
    track?: { no: number | null; of: number | null };
    albumartist?: string;
    composer?: string[];
    comment?: string[];
    bpm?: number;
    key?: string;
  };
}

/**
 * Get detailed debug metadata for a single file
 * Shows all native tag formats and their contents for debugging
 */
export async function getFileDebugMetadata(file: File): Promise<FileDebugMetadata> {
  const metadata = await parseBlob(file, {
    includeChapters: false,
    skipCovers: true,
  });

  const nativeFormats = Object.keys(metadata.native);
  const tags: Record<string, Array<{ id: string; value: unknown }>> = {};

  for (const format of nativeFormats) {
    tags[format] = metadata.native[format].map((t: { id: string; value: unknown }) => ({
      id: t.id,
      value: t.value,
    }));
  }

  const extracted = await extractFileMetadata(file);

  return {
    nativeFormats,
    tags,
    extracted,
    common: {
      title: metadata.common.title,
      artist: metadata.common.artist,
      album: metadata.common.album,
      genre: metadata.common.genre,
      year: metadata.common.year,
      track: metadata.common.track,
      albumartist: metadata.common.albumartist,
      composer: metadata.common.composer,
      comment: metadata.common.comment,
      bpm: metadata.common.bpm,
      key: metadata.common.key,
    },
  };
}

// Export for testing
export const _testExports = {
  extractFileMetadata,
  mapToSuperGenre,
  processFile,
  filterAudioFiles,
  writeSuperGenreTag,
  getExistingGroupingTag,
};

// Re-export for convenience
export { processDownloadsWithHandles as processDownloadsFromDirectory };
