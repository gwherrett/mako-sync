import { parseBlob } from 'music-metadata-browser';
import { Buffer } from 'buffer';
import { generateFileHash } from '@/utils/fileHash';
import { NormalizationService } from './normalization.service';
import { z } from 'zod';
import { withTimeout } from '@/utils/promiseUtils';

// Timeout constants for metadata extraction
const PARSE_BLOB_TIMEOUT_MS = 30000; // 30 seconds per file

// Binary ID3v2 frame IDs to filter from logging (contain large binary data from DJ software like Serato)
const BINARY_FRAME_IDS = ['GEOB', 'APIC', 'PRIV', 'SYLT', 'SYTC', 'ETCO', 'MLLT', 'AENC', 'ENCR', 'GRID', 'COMR', 'SIGN'];

/**
 * Extracts year from various value formats
 */
const extractYearFromValue = (value: any): number | null => {
  if (typeof value === 'number' && value > 1800 && value < 2100) {
    return value;
  }
  if (typeof value === 'string') {
    return extractYearFromString(value);
  }
  return null;
};

/**
 * Extracts year from string formats like "2023", "2023-01-01", "01/01/2023", etc.
 */
const extractYearFromString = (dateStr: string): number | null => {
  if (!dateStr) return null;
  
  // Try direct year format (4 digits)
  const directYear = dateStr.match(/\b(19|20)\d{2}\b/);
  if (directYear) {
    const year = parseInt(directYear[0]);
    if (year > 1800 && year < 2100) {
      return year;
    }
  }
  
  // Try ISO date format (YYYY-MM-DD)
  const isoMatch = dateStr.match(/^(\d{4})-\d{2}-\d{2}/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]);
    if (year > 1800 && year < 2100) {
      return year;
    }
  }
  
  return null;
};

// Make Buffer available globally for music-metadata-browser
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}

// Validation schema for MP3 metadata to prevent malicious data
const metadataSchema = z.object({
  title: z.string().max(500).nullable(),
  artist: z.string().max(500).nullable(),
  album: z.string().max(500).nullable(),
  genre: z.string().max(200).nullable(),
  year: z.number().int().min(1900).max(new Date().getFullYear() + 1).nullable(),
  bitrate: z.number().int().min(0).max(10000).nullable(),
  bpm: z.number().min(0).max(500).nullable(),
  key: z.string().max(50).nullable(),
  normalized_title: z.string().max(500),
  normalized_artist: z.string().max(500),
  core_title: z.string().max(500),
  primary_artist: z.string().max(500),
  featured_artists: z.array(z.string().max(500)).max(50),
  mix: z.string().max(200).nullable(),
  file_path: z.string().max(1000),
  file_size: z.number().int().min(0).max(10737418240), // 10GB max
  hash: z.string().max(128).nullable(),
  last_modified: z.string(),
});

export interface ScannedTrack {
  file_path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  genre: string | null;
  bpm: number | null;
  key: string | null;
  bitrate: number | null;
  hash: string | null;
  file_size: number;
  last_modified: string;
  user_id?: string; // Optional for backward compatibility
  // Normalized fields
  normalized_title: string;
  normalized_artist: string;
  core_title: string;
  primary_artist: string;
  featured_artists: string[];
  mix: string | null;
}

/**
 * Extracts metadata from an MP3 file
 */
export const extractMetadata = async (file: File): Promise<ScannedTrack> => {
  console.log(`🚀 STARTING metadata extraction for: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
  
  try {
    console.log(`📊 File details:`, {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: new Date(file.lastModified).toISOString()
    });

    console.log(`🔍 About to call parseBlob for: ${file.name}`);
    
    // Try parseBlob with specific error handling and timeout protection
    let metadata;
    try {
      metadata = await withTimeout(
        parseBlob(file, {
          includeChapters: false,
          skipCovers: true,
          skipPostHeaders: false
        }),
        PARSE_BLOB_TIMEOUT_MS,
        `Metadata parsing timed out for ${file.name} after ${PARSE_BLOB_TIMEOUT_MS / 1000}s`
      );
      console.log(`✅ parseBlob completed successfully for: ${file.name}`);
    } catch (parseError: any) {
      console.error(`❌ parseBlob FAILED for ${file.name}:`, parseError);
      throw new Error(`parseBlob failed: ${parseError.message}`);
    }
    
    // Validate metadata object structure
    if (!metadata) {
      console.error(`❌ metadata is null/undefined for: ${file.name}`);
      throw new Error('Metadata object is null or undefined');
    }
    
    // Log metadata summary without binary data (GEOB frames can be huge from Serato/DJ software)
    const metadataSummary = {
      format: metadata.format,
      common: metadata.common,
      nativeFormats: metadata.native ? Object.keys(metadata.native) : [],
      nativeTagCounts: metadata.native
        ? Object.fromEntries(
            Object.entries(metadata.native).map(([format, tags]) => [
              format,
              Array.isArray(tags) ? tags.length : 0
            ])
          )
        : {}
    };
    console.log(`📋 Metadata summary for "${file.name}":`, JSON.stringify(metadataSummary, null, 2));
    
    // Check for expected properties
    console.log(`📊 Metadata validation for "${file.name}":`, {
      hasFormat: !!metadata.format,
      hasCommon: !!metadata.common,
      hasNative: !!metadata.native,
      formatKeys: metadata.format ? Object.keys(metadata.format) : [],
      commonKeys: metadata.common ? Object.keys(metadata.common) : [],
      nativeKeys: metadata.native ? Object.keys(metadata.native) : []
    });
    
    // Log available tag formats (filter out binary frames like GEOB, APIC, PRIV)
    if (metadata.native) {
      Object.keys(metadata.native).forEach(tagFormat => {
        const tags = metadata.native[tagFormat];
        const textTags = Array.isArray(tags)
          ? tags.filter((tag: { id: string }) => !BINARY_FRAME_IDS.includes(tag.id))
          : tags;
        const skippedCount = Array.isArray(tags) ? tags.length - textTags.length : 0;
        console.log(`🏷️  ${tagFormat} tags (${skippedCount} binary frames filtered):`, textTags);
      });
    }
    
    const hash = await generateFileHash(file);
    
    // Enhanced metadata extraction with multiple fallback attempts
    let title = null;
    let artist = null;
    let album = null;
    let year = null;
    let genre = null;
    let bpm = null;
    let key = null;
    let bitrate = null;
    
    // Primary extraction from common metadata
    if (metadata.common) {
      title = metadata.common.title || null;
      artist = metadata.common.artist || null;
      album = metadata.common.album || null;
      year = metadata.common.year || null;
      genre = metadata.common.genre?.[0] || null;
      bpm = metadata.common.bpm || null;
      key = metadata.common.key || null;
      
      console.log(`📊 Common metadata for "${file.name}":`, {
        title: metadata.common.title,
        artist: metadata.common.artist,
        album: metadata.common.album,
        year: metadata.common.year,
        date: metadata.common.date,
        originaldate: metadata.common.originaldate,
        genre: metadata.common.genre,
        track: metadata.common.track,
        albumartist: metadata.common.albumartist
      });
      
      // Try additional common fields for year if not found
      if (!year) {
        const dateStr = metadata.common.date || metadata.common.originaldate;
        if (dateStr) {
          const extractedYear = extractYearFromString(dateStr);
          if (extractedYear) {
            year = extractedYear;
            console.log(`📅 Extracted year from date field: ${year}`);
          }
        }
      }
    }

    // Extract format metadata (bitrate, etc.)
    if (metadata.format) {
      bitrate = metadata.format.bitrate ? Math.round(metadata.format.bitrate / 1000) : null;
      console.log(`🎵 Format metadata for "${file.name}":`, {
        bitrate: metadata.format.bitrate,
        roundedBitrate: bitrate,
        sampleRate: metadata.format.sampleRate,
        numberOfChannels: metadata.format.numberOfChannels,
        duration: metadata.format.duration
      });
    }
    
    // Fallback: Try extracting from native tags if common is missing
    if (metadata.native && (!title || !artist || !album || !year || !genre || !bpm || !key)) {
      console.log(`🔄 Attempting fallback extraction from native tags...`);
      
      // Try ID3v2.4 first, then ID3v2.3, then ID3v1
      const tagFormats = ['ID3v2.4', 'ID3v2.3', 'ID3v1', 'vorbis'];
      
      for (const format of tagFormats) {
        if (metadata.native[format]) {
          const tags = metadata.native[format];
          // Filter binary frames for logging only
          const textTagsForLog = Array.isArray(tags)
            ? tags.filter((tag: { id: string }) => !BINARY_FRAME_IDS.includes(tag.id))
            : tags;
          console.log(`🏷️  Trying ${format} tags (text only):`, textTagsForLog);
          
          // Extract from native tags
          for (const tag of tags) {
            if (!title && (tag.id === 'TIT2' || tag.id === 'TITLE' || tag.id === 'Title')) {
              title = typeof tag.value === 'string' ? tag.value : null;
            }
            if (!artist && (tag.id === 'TPE1' || tag.id === 'ARTIST' || tag.id === 'Artist')) {
              artist = typeof tag.value === 'string' ? tag.value : null;
            }
            if (!album && (tag.id === 'TALB' || tag.id === 'ALBUM' || tag.id === 'Album')) {
              album = typeof tag.value === 'string' ? tag.value : null;
            }
            if (!year && (
              tag.id === 'TYER' || tag.id === 'TDRC' || tag.id === 'TDAT' || 
              tag.id === 'TORY' || tag.id === 'TDOR' || tag.id === 'TRDA' ||
              tag.id === 'DATE' || tag.id === 'Date' || tag.id === 'YEAR' || 
              tag.id === 'Year' || tag.id === 'ORIGINALDATE'
            )) {
              const extractedYear = extractYearFromValue(tag.value);
              if (extractedYear) {
                year = extractedYear;
                console.log(`📅 Extracted year from ${tag.id}: ${year}`);
              }
            }
            if (!genre && (tag.id === 'TCON' || tag.id === 'GENRE' || tag.id === 'Genre')) {
              genre = typeof tag.value === 'string' ? tag.value : null;
            }
            if (!bpm && (tag.id === 'TBPM' || tag.id === 'BPM' || tag.id === 'Bpm')) {
              const bpmValue = typeof tag.value === 'string' ? parseFloat(tag.value) : (typeof tag.value === 'number' ? tag.value : null);
              if (bpmValue && bpmValue > 0 && bpmValue < 300) {
                bpm = Math.round(bpmValue);
              }
            }
            if (!key && (tag.id === 'TKEY' || tag.id === 'KEY' || tag.id === 'Key' || tag.id === 'INITIALKEY')) {
              key = typeof tag.value === 'string' ? tag.value : null;
            }
          }
          
          // If we found some data in this format, log it
          if (title || artist || album || year || genre || bpm || key) {
            console.log(`✅ Found metadata in ${format}:`, { title, artist, album, year, genre, bpm, key });
            break;
          }
        }
      }
    }
    
    // Apply normalization
    const normalizationService = new NormalizationService();
    const normalized = normalizationService.processMetadata(title, artist);
    
    const trackData = {
      file_path: file.name,
      title,
      artist,
      album,
      year,
      genre,
      bpm,
      key,
      bitrate,
      hash,
      file_size: file.size,
      last_modified: new Date(file.lastModified).toISOString(),
      // Normalized fields (map camelCase to snake_case for DB)
      normalized_title: normalized.normalizedTitle,
      normalized_artist: normalized.normalizedArtist,
      core_title: normalized.coreTitle,
      primary_artist: normalized.primaryArtist,
      featured_artists: normalized.featuredArtists,
      mix: normalized.mix,
    };

    // Final extraction results
    console.log(`🎵 Final metadata extracted for "${file.name}":`, {
      artist: trackData.artist || '❌ MISSING',
      album: trackData.album || '❌ MISSING', 
      genre: trackData.genre || '❌ MISSING',
      year: trackData.year || '❌ MISSING',
      title: trackData.title || '❌ MISSING',
      bpm: trackData.bpm || '❌ MISSING',
      key: trackData.key || '❌ MISSING',
      bitrate: trackData.bitrate ? `${trackData.bitrate} kbps` : '❌ MISSING',
      fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      hash: trackData.hash?.substring(0, 8) + '...',
      normalized: {
        title: trackData.normalized_title,
        artist: trackData.normalized_artist,
        core_title: trackData.core_title,
        primary_artist: trackData.primary_artist,
        mix: trackData.mix || 'none'
      }
    });

    // Validate the extracted metadata before returning
    const validationResult = metadataSchema.safeParse(trackData);
    
    if (!validationResult.success) {
      console.error(`❌ Metadata validation failed for ${file.name}:`, validationResult.error.issues);
      throw new Error(`Invalid metadata in ${file.name}: ${validationResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
    }
    
    console.log(`✅ Metadata validation passed for: ${file.name}`);
    return validationResult.data as ScannedTrack;
  } catch (error) {
    console.error(`❌ Failed to extract metadata from ${file.name}:`, error);
    
    // Apply normalization even for failed extractions (with null values)
    const normalizationService = new NormalizationService();
    const normalized = normalizationService.processMetadata(null, null);
    
    // Return track with all metadata fields as null (no filename fallback)
    const errorTrackData = {
      file_path: file.name,
      title: null,
      artist: null,
      album: null,
      year: null,
      genre: null,
      bpm: null,
      key: null,
      bitrate: null,
      hash: await generateFileHash(file),
      file_size: file.size,
      last_modified: new Date(file.lastModified).toISOString(),
      // Normalized fields (empty when extraction fails, map camelCase to snake_case)
      normalized_title: normalized.normalizedTitle,
      normalized_artist: normalized.normalizedArtist,
      core_title: normalized.coreTitle,
      primary_artist: normalized.primaryArtist,
      featured_artists: normalized.featuredArtists,
      mix: normalized.mix,
    };
    
    // Validate even error case data
    const validationResult = metadataSchema.safeParse(errorTrackData);
    if (!validationResult.success) {
      console.error(`❌ Error case validation failed for ${file.name}:`, validationResult.error.issues);
      throw new Error(`Failed to extract and validate metadata from ${file.name}`);
    }
    
    return validationResult.data as ScannedTrack;
  }
};

/**
 * Process multiple files in batches to extract metadata
 */
export const extractMetadataBatch = async (
  files: File[],
  onProgress?: (current: number, total: number) => void,
  batchSize: number = 5
): Promise<ScannedTrack[]> => {
  const scannedTracks: ScannedTrack[] = [];
  
  console.log('🚀 Starting metadata extraction for all files...');
  
  // Process files in batches
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}: files ${i + 1}-${Math.min(i + batchSize, files.length)}`);
    
    const batchResults = await Promise.all(
      batch.map(async (file, index) => {
        console.log(`🎯 About to extract metadata for: ${file.name}`);
        const track = await extractMetadata(file);
        console.log(`✅ Metadata extraction completed for: ${file.name}`);
        
        if (onProgress) {
          onProgress(i + index + 1, files.length);
        }
        
        return track;
      })
    );
    scannedTracks.push(...batchResults);
  }

  return scannedTracks;
};