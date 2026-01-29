/**
 * slskd Integration Types
 *
 * Types for interacting with slskd REST API and managing configuration.
 * Configuration is stored in browser localStorage (not Supabase).
 */

/**
 * User's slskd configuration stored in localStorage
 */
export interface SlskdConfig {
  apiEndpoint: string;           // e.g., "http://localhost:5030"
  apiKey: string;                // slskd API key
  downloadsFolder: string;       // e.g., "D:\Downloads\slskd"
  searchFormat: 'primary' | 'full';  // Search query format preference
  lastConnectionTest?: string;   // ISO timestamp
  connectionStatus: boolean;     // Last known connection status
}

/**
 * Request body for creating a new search/wishlist item
 */
export interface SlskdSearchRequest {
  searchText: string;
}

/**
 * Response from slskd search API
 */
export interface SlskdSearchResponse {
  id: string;
  searchText: string;
  state: 'InProgress' | 'Completed' | 'Errored' | 'TimedOut' | 'Cancelled';
  responseCount?: number;
  fileCount?: number;
}

/**
 * slskd session info returned from /api/v0/session
 */
export interface SlskdSessionResponse {
  username: string;
  isLoggedIn: boolean;
}

/**
 * Result of syncing tracks to slskd wishlist
 */
export interface SlskdSyncResult {
  totalTracks: number;
  addedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: SlskdSyncError[];
}

/**
 * Individual sync error
 */
export interface SlskdSyncError {
  track: string;
  error: string;
}

/**
 * Track to be synced to slskd
 */
export interface SlskdTrackToSync {
  id: string;
  title: string;
  artist: string;
  primary_artist?: string;
}

// =============================================================================
// Phase 4: Download Processing Types
// =============================================================================

/**
 * File System Access API types (for writing tags back to original files)
 * These extend the standard File API with handle references
 */
declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

/**
 * Status of a processed file
 */
export type ProcessedFileStatus = 'mapped' | 'unmapped' | 'error';

/**
 * A single processed MP3 file with extracted metadata and genre mapping
 */
export interface ProcessedFile {
  /** Original filename */
  filename: string;
  /** Relative path from selected folder (via webkitRelativePath) */
  relativePath: string;
  /** Extracted artist from ID3 tags */
  artist: string;
  /** Extracted title from ID3 tags */
  title: string;
  /** Extracted album from ID3 tags */
  album: string | null;
  /** All genre tags found in the file */
  genres: string[];
  /** Mapped SuperGenre (null if unmapped) */
  superGenre: string | null;
  /** Processing status */
  status: ProcessedFileStatus;
  /** Error message if status is 'error' */
  error?: string;
  /** Reference to original File object for reading */
  file: File;
  /** File System Access API handle for writing back to original location */
  fileHandle?: FileSystemFileHandle;
}

/**
 * Result of processing a batch of downloaded files
 */
export interface ProcessingResult {
  /** All processed files */
  files: ProcessedFile[];
  /** Unique genres that couldn't be mapped to a SuperGenre */
  unmappedGenres: string[];
  /** Summary counts */
  summary: {
    total: number;
    mapped: number;
    unmapped: number;
    errors: number;
  };
}

/**
 * Progress callback for batch processing
 */
export interface ProcessingProgress {
  current: number;
  total: number;
  currentFile: string;
}
