/**
 * Service for scanning directories and collecting local music files
 */

/** Audio file extensions supported for scanning and metadata extraction */
export const SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a'];

export function isSupportedAudioFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Strip supported audio extension from a filename (for title fallback) */
export function stripAudioExtension(filename: string): string {
  const lower = filename.toLowerCase();
  for (const ext of SUPPORTED_AUDIO_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return filename.slice(0, -ext.length);
    }
  }
  return filename;
}

export interface ScanOptions {
  onProgress?: (current: number, total: number) => void;
}

/**
 * Shows directory picker and collects all local music files recursively
 */
export const scanDirectoryForLocalFiles = async (options?: ScanOptions): Promise<File[]> => {
  // Check if File System Access API is supported
  if (!('showDirectoryPicker' in window)) {
    throw new Error("Your browser doesn't support the File System Access API. Please use Chrome, Edge, or another Chromium-based browser.");
  }

  // Check if we're in an iframe (like Lovable preview)
  if (window.self !== window.top) {
    throw new Error("File picker doesn't work in preview. Please open your deployed app in a new tab to test local file scanning.");
  }

  console.log('📂 About to show directory picker');
  
  // Let user select a directory
  // Checked above that the picker exists. Typed in src/types/slskd.ts.
  const dirHandle = await window.showDirectoryPicker!({
    mode: 'read'
  });

  console.log(`📁 Directory selected: ${dirHandle.name}`);

  const localFiles: File[] = [];
  let lastLoggedCount = 0;

  // Recursively collect local music files
  const collectLocalFiles = async (dirHandle: FileSystemDirectoryHandle, path = '') => {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && isSupportedAudioFile(entry.name)) {
        const file = await (entry as FileSystemFileHandle).getFile();
        localFiles.push(file);

        // Log progress every 100 files to reduce console noise
        if (localFiles.length - lastLoggedCount >= 100) {
          console.log(`🎵 Found ${localFiles.length} files...`);
          lastLoggedCount = localFiles.length;
        }

        // Report progress if callback provided
        if (options?.onProgress) {
          options.onProgress(localFiles.length, localFiles.length);
        }
      } else if (entry.kind === 'directory') {
        await collectLocalFiles(entry as FileSystemDirectoryHandle, `${path}/${entry.name}`);
      }
    }
  };

  await collectLocalFiles(dirHandle);
  
  console.log(`📊 Total local files found: ${localFiles.length}`);
  
  if (localFiles.length === 0) {
    throw new Error("No music files were found in the selected directory.");
  }

  return localFiles;
};