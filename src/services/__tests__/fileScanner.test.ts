import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scanDirectoryForLocalFiles, type ScanOptions } from '../fileScanner';

describe('fileScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('scanDirectoryForLocalFiles', () => {
    it('should throw error when File System Access API is not supported', async () => {
      vi.stubGlobal('window', {
        self: {},
        top: {}
      });

      await expect(scanDirectoryForLocalFiles()).rejects.toThrow(
        "Your browser doesn't support the File System Access API"
      );
    });

    it('should throw error when running in an iframe', async () => {
      const top = {};
      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn(),
        self: {},
        top: top // Different from self
      });

      await expect(scanDirectoryForLocalFiles()).rejects.toThrow(
        "File picker doesn't work in preview"
      );
    });

    it('should throw error when no music files are found', async () => {
      const self = {};
      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn().mockResolvedValue({
          name: 'test-dir',
          values: vi.fn().mockImplementation(function* () {
            // Empty directory - no files
          })
        }),
        self: self,
        top: self // Same as self (not in iframe)
      });

      await expect(scanDirectoryForLocalFiles()).rejects.toThrow(
        "No music files were found in the selected directory"
      );
    });

    it('should collect MP3 files from directory', async () => {
      const self = {};
      const mockFile = new File(['content'], 'song.mp3', { type: 'audio/mpeg' });

      const mockFileEntry = {
        kind: 'file',
        name: 'song.mp3',
        getFile: vi.fn().mockResolvedValue(mockFile)
      };

      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn().mockResolvedValue({
          name: 'test-dir',
          values: vi.fn().mockImplementation(function* () {
            yield mockFileEntry;
          })
        }),
        self: self,
        top: self
      });

      const result = await scanDirectoryForLocalFiles();

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mockFile);
    });

    it('should recursively collect MP3 files from subdirectories', async () => {
      const self = {};
      const mockFile1 = new File(['content1'], 'song1.mp3', { type: 'audio/mpeg' });
      const mockFile2 = new File(['content2'], 'song2.mp3', { type: 'audio/mpeg' });

      const mockFileEntry1 = {
        kind: 'file',
        name: 'song1.mp3',
        getFile: vi.fn().mockResolvedValue(mockFile1)
      };

      const mockFileEntry2 = {
        kind: 'file',
        name: 'song2.mp3',
        getFile: vi.fn().mockResolvedValue(mockFile2)
      };

      const mockSubDir = {
        kind: 'directory',
        name: 'subdir',
        values: vi.fn().mockImplementation(function* () {
          yield mockFileEntry2;
        })
      };

      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn().mockResolvedValue({
          name: 'test-dir',
          values: vi.fn().mockImplementation(function* () {
            yield mockFileEntry1;
            yield mockSubDir;
          })
        }),
        self: self,
        top: self
      });

      const result = await scanDirectoryForLocalFiles();

      expect(result).toHaveLength(2);
      expect(result).toContain(mockFile1);
      expect(result).toContain(mockFile2);
    });

    it('should collect FLAC and M4A files alongside MP3', async () => {
      const self = {};
      const mockMp3 = new File(['content'], 'song.mp3', { type: 'audio/mpeg' });
      const mockFlac = new File(['content'], 'song.flac', { type: 'audio/flac' });
      const mockM4a = new File(['content'], 'song.m4a', { type: 'audio/mp4' });

      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn().mockResolvedValue({
          name: 'test-dir',
          values: vi.fn().mockImplementation(function* () {
            yield { kind: 'file', name: 'song.mp3', getFile: vi.fn().mockResolvedValue(mockMp3) };
            yield { kind: 'file', name: 'song.flac', getFile: vi.fn().mockResolvedValue(mockFlac) };
            yield { kind: 'file', name: 'song.m4a', getFile: vi.fn().mockResolvedValue(mockM4a) };
          })
        }),
        self: self,
        top: self
      });

      const result = await scanDirectoryForLocalFiles();

      expect(result).toHaveLength(3);
      expect(result).toContain(mockMp3);
      expect(result).toContain(mockFlac);
      expect(result).toContain(mockM4a);
    });

    it('should ignore unsupported file types', async () => {
      const self = {};
      const mockMp3 = new File(['content'], 'song.mp3', { type: 'audio/mpeg' });

      const mockMp3Entry = {
        kind: 'file',
        name: 'song.mp3',
        getFile: vi.fn().mockResolvedValue(mockMp3)
      };

      const mockTxtEntry = {
        kind: 'file',
        name: 'notes.txt'
      };

      const mockWavEntry = {
        kind: 'file',
        name: 'audio.wav'
      };

      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn().mockResolvedValue({
          name: 'test-dir',
          values: vi.fn().mockImplementation(function* () {
            yield mockMp3Entry;
            yield mockTxtEntry;
            yield mockWavEntry;
          })
        }),
        self: self,
        top: self
      });

      const result = await scanDirectoryForLocalFiles();

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mockMp3);
    });

    it('should handle MP3 files with uppercase extension', async () => {
      const self = {};
      const mockFile = new File(['content'], 'song.MP3', { type: 'audio/mpeg' });

      const mockFileEntry = {
        kind: 'file',
        name: 'song.MP3',
        getFile: vi.fn().mockResolvedValue(mockFile)
      };

      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn().mockResolvedValue({
          name: 'test-dir',
          values: vi.fn().mockImplementation(function* () {
            yield mockFileEntry;
          })
        }),
        self: self,
        top: self
      });

      const result = await scanDirectoryForLocalFiles();

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mockFile);
    });

    it('should call onProgress callback for each file', async () => {
      const self = {};
      const mockFile1 = new File(['content1'], 'song1.mp3', { type: 'audio/mpeg' });
      const mockFile2 = new File(['content2'], 'song2.mp3', { type: 'audio/mpeg' });

      const mockFileEntry1 = {
        kind: 'file',
        name: 'song1.mp3',
        getFile: vi.fn().mockResolvedValue(mockFile1)
      };

      const mockFileEntry2 = {
        kind: 'file',
        name: 'song2.mp3',
        getFile: vi.fn().mockResolvedValue(mockFile2)
      };

      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn().mockResolvedValue({
          name: 'test-dir',
          values: vi.fn().mockImplementation(function* () {
            yield mockFileEntry1;
            yield mockFileEntry2;
          })
        }),
        self: self,
        top: self
      });

      const onProgress = vi.fn();
      const options: ScanOptions = { onProgress };

      await scanDirectoryForLocalFiles(options);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 1);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
    });

    it('should work without options parameter', async () => {
      const self = {};
      const mockFile = new File(['content'], 'song.mp3', { type: 'audio/mpeg' });

      vi.stubGlobal('window', {
        showDirectoryPicker: vi.fn().mockResolvedValue({
          name: 'test-dir',
          values: vi.fn().mockImplementation(function* () {
            yield {
              kind: 'file',
              name: 'song.mp3',
              getFile: vi.fn().mockResolvedValue(mockFile)
            };
          })
        }),
        self: self,
        top: self
      });

      // Should not throw
      const result = await scanDirectoryForLocalFiles();
      expect(result).toHaveLength(1);
    });
  });
});
