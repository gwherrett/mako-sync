import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isFileSystemAccessSupported,
  storeDirectoryHandle,
  getStoredDirectoryHandle,
  clearStoredDirectoryHandle,
  verifyPermission,
  requestDirectoryAccess,
  getDownloadsDirectory,
  getAllAudioFiles,
  writeFileWithHandle
} from '../directoryHandle.service';

// Mock IndexedDB
const mockObjectStore = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn()
};

const mockTransaction = {
  objectStore: vi.fn().mockReturnValue(mockObjectStore),
  oncomplete: null as (() => void) | null
};

const mockDB = {
  transaction: vi.fn().mockReturnValue(mockTransaction),
  close: vi.fn(),
  objectStoreNames: {
    contains: vi.fn().mockReturnValue(true)
  },
  createObjectStore: vi.fn()
};

const mockIndexedDB = {
  open: vi.fn()
};

describe('directoryHandle.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup IndexedDB mock
    vi.stubGlobal('indexedDB', mockIndexedDB);

    // Default: simulate successful DB open
    mockIndexedDB.open.mockImplementation(() => {
      const request = {
        result: mockDB,
        error: null,
        onerror: null as ((e: any) => void) | null,
        onsuccess: null as ((e: any) => void) | null,
        onupgradeneeded: null as ((e: any) => void) | null
      };

      setTimeout(() => {
        if (request.onsuccess) {
          request.onsuccess({ target: request } as any);
        }
      }, 0);

      return request;
    });

    // Setup transaction complete callback
    mockTransaction.oncomplete = null;
    mockDB.transaction.mockImplementation(() => {
      setTimeout(() => {
        if (mockTransaction.oncomplete) {
          mockTransaction.oncomplete();
        }
      }, 0);
      return mockTransaction;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isFileSystemAccessSupported', () => {
    it('should return true when showDirectoryPicker is available', () => {
      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn()
      });

      expect(isFileSystemAccessSupported()).toBe(true);
    });

    it('should return false when showDirectoryPicker is not available', () => {
      vi.stubGlobal('window', {});

      expect(isFileSystemAccessSupported()).toBe(false);
    });

    it('should return false when window is undefined', () => {
      vi.stubGlobal('window', undefined);

      expect(isFileSystemAccessSupported()).toBe(false);
    });
  });

  describe('storeDirectoryHandle', () => {
    it('should store handle in IndexedDB', async () => {
      const mockHandle = { name: 'test-dir' } as FileSystemDirectoryHandle;

      mockObjectStore.put.mockImplementation(() => {
        const request = {
          error: null,
          onerror: null as ((e: any) => void) | null,
          onsuccess: null as ((e: any) => void) | null
        };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({} as any);
        }, 0);
        return request;
      });

      await storeDirectoryHandle(mockHandle);

      expect(mockObjectStore.put).toHaveBeenCalledWith(mockHandle, 'slskd-downloads');
      expect(mockDB.close).toHaveBeenCalled();
    });

    it('should reject on store error', async () => {
      const mockHandle = { name: 'test-dir' } as FileSystemDirectoryHandle;
      const mockError = new Error('Store failed');

      mockObjectStore.put.mockImplementation(() => {
        const request = {
          error: mockError,
          onerror: null as ((e: any) => void) | null,
          onsuccess: null as ((e: any) => void) | null
        };
        setTimeout(() => {
          if (request.onerror) request.onerror({} as any);
        }, 0);
        return request;
      });

      await expect(storeDirectoryHandle(mockHandle)).rejects.toEqual(mockError);
    });
  });

  describe('getStoredDirectoryHandle', () => {
    it('should retrieve handle from IndexedDB', async () => {
      const mockHandle = { name: 'stored-dir' } as FileSystemDirectoryHandle;

      mockObjectStore.get.mockImplementation(() => {
        const request = {
          result: mockHandle,
          error: null,
          onerror: null as ((e: any) => void) | null,
          onsuccess: null as ((e: any) => void) | null
        };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({} as any);
        }, 0);
        return request;
      });

      const result = await getStoredDirectoryHandle();

      expect(result).toEqual(mockHandle);
      expect(mockObjectStore.get).toHaveBeenCalledWith('slskd-downloads');
    });

    it('should return null when no handle is stored', async () => {
      mockObjectStore.get.mockImplementation(() => {
        const request = {
          result: undefined,
          error: null,
          onerror: null as ((e: any) => void) | null,
          onsuccess: null as ((e: any) => void) | null
        };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({} as any);
        }, 0);
        return request;
      });

      const result = await getStoredDirectoryHandle();

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockIndexedDB.open.mockImplementation(() => {
        throw new Error('DB failed');
      });

      const result = await getStoredDirectoryHandle();

      expect(result).toBeNull();
    });
  });

  describe('clearStoredDirectoryHandle', () => {
    it('should delete handle from IndexedDB', async () => {
      mockObjectStore.delete.mockImplementation(() => {
        const request = {
          error: null,
          onerror: null as ((e: any) => void) | null,
          onsuccess: null as ((e: any) => void) | null
        };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({} as any);
        }, 0);
        return request;
      });

      await clearStoredDirectoryHandle();

      expect(mockObjectStore.delete).toHaveBeenCalledWith('slskd-downloads');
      expect(mockDB.close).toHaveBeenCalled();
    });
  });

  describe('verifyPermission', () => {
    it('should return true when permission is already granted', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('granted'),
        requestPermission: vi.fn()
      } as unknown as FileSystemDirectoryHandle;

      const result = await verifyPermission(mockHandle);

      expect(result).toBe(true);
      expect(mockHandle.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
      expect(mockHandle.requestPermission).not.toHaveBeenCalled();
    });

    it('should request permission and return true when granted', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('prompt'),
        requestPermission: vi.fn().mockResolvedValue('granted')
      } as unknown as FileSystemDirectoryHandle;

      const result = await verifyPermission(mockHandle);

      expect(result).toBe(true);
      expect(mockHandle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    });

    it('should return false when permission is denied', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('prompt'),
        requestPermission: vi.fn().mockResolvedValue('denied')
      } as unknown as FileSystemDirectoryHandle;

      const result = await verifyPermission(mockHandle);

      expect(result).toBe(false);
    });

    it('should use read mode when specified', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('granted'),
        requestPermission: vi.fn()
      } as unknown as FileSystemDirectoryHandle;

      await verifyPermission(mockHandle, 'read');

      expect(mockHandle.queryPermission).toHaveBeenCalledWith({ mode: 'read' });
    });
  });

  describe('requestDirectoryAccess', () => {
    it('should throw error when File System Access API is not supported', async () => {
      vi.stubGlobal('window', {});

      await expect(requestDirectoryAccess()).rejects.toThrow(
        'File System Access API is not supported in this browser'
      );
    });

    it('should return handle when user selects directory', async () => {
      const mockHandle = { name: 'selected-dir' } as FileSystemDirectoryHandle;

      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn().mockResolvedValue(mockHandle)
      });

      mockObjectStore.put.mockImplementation(() => {
        const request = {
          error: null,
          onerror: null,
          onsuccess: null as ((e: any) => void) | null
        };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({} as any);
        }, 0);
        return request;
      });

      const result = await requestDirectoryAccess();

      expect(result).toEqual(mockHandle);
      expect(window.showDirectoryPicker).toHaveBeenCalledWith({
        id: 'slskd-downloads',
        mode: 'readwrite',
        startIn: 'downloads'
      });
    });

    it('should return null when user cancels', async () => {
      const abortError = new Error('User cancelled');
      abortError.name = 'AbortError';

      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn().mockRejectedValue(abortError)
      });

      const result = await requestDirectoryAccess();

      expect(result).toBeNull();
    });

    it('should re-throw non-abort errors', async () => {
      const otherError = new Error('Permission denied');

      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn().mockRejectedValue(otherError)
      });

      await expect(requestDirectoryAccess()).rejects.toThrow('Permission denied');
    });
  });

  describe('getDownloadsDirectory', () => {
    it('should return stored handle if valid', async () => {
      const mockHandle = {
        name: 'downloads',
        queryPermission: vi.fn().mockResolvedValue('granted')
      } as unknown as FileSystemDirectoryHandle;

      mockObjectStore.get.mockImplementation(() => {
        const request = {
          result: mockHandle,
          error: null,
          onerror: null,
          onsuccess: null as ((e: any) => void) | null
        };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({} as any);
        }, 0);
        return request;
      });

      const result = await getDownloadsDirectory();

      expect(result).toEqual(mockHandle);
    });

    it('should return null if no stored handle', async () => {
      mockObjectStore.get.mockImplementation(() => {
        const request = {
          result: null,
          error: null,
          onerror: null,
          onsuccess: null as ((e: any) => void) | null
        };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({} as any);
        }, 0);
        return request;
      });

      const result = await getDownloadsDirectory();

      expect(result).toBeNull();
    });

    it('should return null if stored handle has no permission', async () => {
      const mockHandle = {
        name: 'downloads',
        queryPermission: vi.fn().mockResolvedValue('denied'),
        requestPermission: vi.fn().mockResolvedValue('denied')
      } as unknown as FileSystemDirectoryHandle;

      mockObjectStore.get.mockImplementation(() => {
        const request = {
          result: mockHandle,
          error: null,
          onerror: null,
          onsuccess: null as ((e: any) => void) | null
        };
        setTimeout(() => {
          if (request.onsuccess) request.onsuccess({} as any);
        }, 0);
        return request;
      });

      const result = await getDownloadsDirectory();

      expect(result).toBeNull();
    });
  });

  describe('getAllAudioFiles', () => {
    it('should return audio files from directory', async () => {
      const mockFile = new File(['content'], 'song.mp3', { type: 'audio/mpeg' });

      const mockFileHandle = {
        kind: 'file',
        name: 'song.mp3',
        getFile: vi.fn().mockResolvedValue(mockFile)
      };

      const mockDirHandle = {
        values: vi.fn().mockImplementation(function* () {
          yield mockFileHandle;
        })
      } as unknown as FileSystemDirectoryHandle;

      const result = await getAllAudioFiles(mockDirHandle);

      expect(result).toHaveLength(1);
      expect(result[0].file).toEqual(mockFile);
      expect(result[0].relativePath).toBe('song.mp3');
      expect(result[0].handle).toEqual(mockFileHandle);
    });

    it('should recursively process subdirectories', async () => {
      const mockFile = new File(['content'], 'nested.mp3', { type: 'audio/mpeg' });

      const mockFileHandle = {
        kind: 'file',
        name: 'nested.mp3',
        getFile: vi.fn().mockResolvedValue(mockFile)
      };

      const mockSubDir = {
        kind: 'directory',
        name: 'subdir',
        values: vi.fn().mockImplementation(function* () {
          yield mockFileHandle;
        })
      };

      const mockDirHandle = {
        values: vi.fn().mockImplementation(function* () {
          yield mockSubDir;
        })
      } as unknown as FileSystemDirectoryHandle;

      const result = await getAllAudioFiles(mockDirHandle);

      expect(result).toHaveLength(1);
      expect(result[0].relativePath).toBe('subdir/nested.mp3');
    });

    it('should ignore unsupported file types', async () => {
      const mockFileHandle = {
        kind: 'file',
        name: 'document.pdf'
      };

      const mockDirHandle = {
        values: vi.fn().mockImplementation(function* () {
          yield mockFileHandle;
        })
      } as unknown as FileSystemDirectoryHandle;

      const result = await getAllAudioFiles(mockDirHandle);

      expect(result).toHaveLength(0);
    });

    it('should use provided base path', async () => {
      const mockFile = new File(['content'], 'song.mp3', { type: 'audio/mpeg' });

      const mockFileHandle = {
        kind: 'file',
        name: 'song.mp3',
        getFile: vi.fn().mockResolvedValue(mockFile)
      };

      const mockDirHandle = {
        values: vi.fn().mockImplementation(function* () {
          yield mockFileHandle;
        })
      } as unknown as FileSystemDirectoryHandle;

      const result = await getAllAudioFiles(mockDirHandle, 'base/path');

      expect(result[0].relativePath).toBe('base/path/song.mp3');
    });
  });

  describe('writeFileWithHandle', () => {
    it('should write data to file using handle', async () => {
      const mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined)
      };

      const mockHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable)
      } as unknown as FileSystemFileHandle;

      const blob = new Blob(['test content'], { type: 'text/plain' });

      await writeFileWithHandle(mockHandle, blob);

      expect(mockHandle.createWritable).toHaveBeenCalled();
      expect(mockWritable.write).toHaveBeenCalledWith(blob);
      expect(mockWritable.close).toHaveBeenCalled();
    });
  });
});
