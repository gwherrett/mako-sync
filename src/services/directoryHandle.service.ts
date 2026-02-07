/**
 * Directory Handle Service
 *
 * Manages persistent access to the slskd downloads folder using the
 * File System Access API. Stores the directory handle in IndexedDB
 * so permissions persist across sessions.
 *
 * Key features:
 * - Request read/write access to a directory
 * - Persist handle in IndexedDB for future sessions
 * - Verify permissions are still valid
 * - Recursively iterate files in the directory
 */

import { isSupportedAudioFile } from './fileScanner';

const DB_NAME = 'mako-sync-fs';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const DOWNLOADS_KEY = 'slskd-downloads';

/**
 * Open the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Check if File System Access API is supported
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Store a directory handle in IndexedDB
 */
export async function storeDirectoryHandle(
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(handle, DOWNLOADS_KEY);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    tx.oncomplete = () => db.close();
  });
}

/**
 * Retrieve the stored directory handle from IndexedDB
 */
export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(DOWNLOADS_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);

      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/**
 * Clear the stored directory handle
 */
export async function clearStoredDirectoryHandle(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(DOWNLOADS_KEY);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    tx.oncomplete = () => db.close();
  });
}

/**
 * Verify we have read/write permission for a directory handle
 * Returns true if permission is granted, false otherwise
 */
export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'readwrite'
): Promise<boolean> {
  // Check current permission state
  const options: FileSystemHandlePermissionDescriptor = { mode };

  // @ts-expect-error - queryPermission is not in the standard types yet
  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  // Request permission if not granted
  // @ts-expect-error - requestPermission is not in the standard types yet
  if ((await handle.requestPermission(options)) === 'granted') {
    return true;
  }

  return false;
}

/**
 * Request a directory from the user with read/write access
 * Stores the handle in IndexedDB for persistence
 */
export async function requestDirectoryAccess(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API is not supported in this browser');
  }

  try {
    const handle = await window.showDirectoryPicker!({
      id: 'slskd-downloads',
      mode: 'readwrite',
      startIn: 'downloads',
    });

    // Store for future sessions
    await storeDirectoryHandle(handle);

    return handle;
  } catch (error) {
    // User cancelled or error occurred
    if (error instanceof Error && error.name === 'AbortError') {
      return null; // User cancelled
    }
    throw error;
  }
}

/**
 * Get the downloads directory handle, either from storage or by requesting
 * Returns null if no handle is available or permission denied
 */
export async function getDownloadsDirectory(): Promise<FileSystemDirectoryHandle | null> {
  // Try to get stored handle first
  const storedHandle = await getStoredDirectoryHandle();

  if (storedHandle) {
    // Verify we still have permission
    const hasPermission = await verifyPermission(storedHandle);
    if (hasPermission) {
      return storedHandle;
    }
  }

  return null;
}

/**
 * File info with handle for writing
 */
export interface FileWithHandle {
  file: File;
  handle: FileSystemFileHandle;
  relativePath: string;
}

/**
 * Recursively get all supported audio files from a directory with their handles
 */
export async function getAllAudioFiles(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string = ''
): Promise<FileWithHandle[]> {
  const files: FileWithHandle[] = [];

  for await (const entry of dirHandle.values()) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.kind === 'directory') {
      // Recursively process subdirectories
      const subFiles = await getAllAudioFiles(
        entry as FileSystemDirectoryHandle,
        entryPath
      );
      files.push(...subFiles);
    } else if (entry.kind === 'file' && isSupportedAudioFile(entry.name)) {
      const fileHandle = entry as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      files.push({
        file,
        handle: fileHandle,
        relativePath: entryPath,
      });
    }
  }

  return files;
}

/** @deprecated Use getAllAudioFiles instead */
export const getAllMp3Files = getAllAudioFiles;

/**
 * Write data to a file using its handle
 */
export async function writeFileWithHandle(
  handle: FileSystemFileHandle,
  data: Blob
): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}
