import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractMetadata, extractMetadataBatch, type ScannedTrack } from '../metadataExtractor';

// Mock music-metadata-browser
vi.mock('music-metadata-browser', () => ({
  parseBlob: vi.fn(),
}));

// Mock fileHash
vi.mock('@/utils/fileHash', () => ({
  generateFileHash: vi.fn().mockResolvedValue('mock-hash-12345'),
}));

// Mock promiseUtils
vi.mock('@/utils/promiseUtils', () => ({
  withTimeout: vi.fn((promise) => promise),
}));

import { parseBlob } from 'music-metadata-browser';

describe('metadataExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractMetadata', () => {
    it('extracts basic metadata from common fields', async () => {
      const mockMetadata = {
        common: {
          title: 'Test Track',
          artist: 'Test Artist',
          album: 'Test Album',
          year: 2023,
          genre: ['House'],
          bpm: 128,
          key: 'Am',
        },
        format: {
          bitrate: 320000,
        },
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.title).toBe('Test Track');
      expect(result.artist).toBe('Test Artist');
      expect(result.album).toBe('Test Album');
      expect(result.year).toBe(2023);
      expect(result.genre).toBe('House');
      expect(result.bpm).toBe(128);
      expect(result.key).toBe('Am');
      expect(result.bitrate).toBe(320);
      expect(result.file_path).toBe('test.mp3');
    });

    it('handles null metadata gracefully', async () => {
      const mockMetadata = {
        common: {},
        format: {},
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.title).toBeNull();
      expect(result.artist).toBeNull();
      expect(result.album).toBeNull();
      expect(result.year).toBeNull();
      expect(result.genre).toBeNull();
    });

    it('extracts year from date field when year is not set', async () => {
      const mockMetadata = {
        common: {
          title: 'Test',
          artist: 'Artist',
          date: '2022-05-15',
        },
        format: {},
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.year).toBe(2022);
    });

    it('extracts year from originaldate when year and date are not set', async () => {
      const mockMetadata = {
        common: {
          title: 'Test',
          artist: 'Artist',
          originaldate: '2021-01-01',
        },
        format: {},
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.year).toBe(2021);
    });

    it('falls back to native ID3v2.4 tags when common is missing', async () => {
      const mockMetadata = {
        common: {},
        format: {},
        native: {
          'ID3v2.4': [
            { id: 'TIT2', value: 'Native Title' },
            { id: 'TPE1', value: 'Native Artist' },
            { id: 'TALB', value: 'Native Album' },
            { id: 'TDRC', value: '2020' },
            { id: 'TCON', value: 'Techno' },
            { id: 'TBPM', value: '140' },
            { id: 'TKEY', value: 'Dm' },
          ],
        },
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.title).toBe('Native Title');
      expect(result.artist).toBe('Native Artist');
      expect(result.album).toBe('Native Album');
      expect(result.year).toBe(2020);
      expect(result.genre).toBe('Techno');
      expect(result.bpm).toBe(140);
      expect(result.key).toBe('Dm');
    });

    it('falls back to native ID3v2.3 tags', async () => {
      const mockMetadata = {
        common: {},
        format: {},
        native: {
          'ID3v2.3': [
            { id: 'TIT2', value: 'ID3v2.3 Title' },
            { id: 'TPE1', value: 'ID3v2.3 Artist' },
            { id: 'TYER', value: '2019' },
          ],
        },
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.title).toBe('ID3v2.3 Title');
      expect(result.artist).toBe('ID3v2.3 Artist');
      expect(result.year).toBe(2019);
    });

    it('falls back to ID3v1 tags', async () => {
      const mockMetadata = {
        common: {},
        format: {},
        native: {
          'ID3v1': [
            { id: 'Title', value: 'ID3v1 Title' },
            { id: 'Artist', value: 'ID3v1 Artist' },
          ],
        },
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.title).toBe('ID3v1 Title');
      expect(result.artist).toBe('ID3v1 Artist');
    });

    it('normalizes title and artist fields', async () => {
      const mockMetadata = {
        common: {
          title: 'Test Track (Original Mix)',
          artist: 'Artist feat. Guest',
        },
        format: {},
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.normalized_title).toBeDefined();
      expect(result.normalized_artist).toBeDefined();
      expect(result.core_title).toBeDefined();
      expect(result.primary_artist).toBeDefined();
      expect(result.mix).toBeDefined();
    });

    it('calculates file hash', async () => {
      const mockMetadata = {
        common: { title: 'Test', artist: 'Artist' },
        format: {},
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.hash).toBe('mock-hash-12345');
    });

    it('handles parseBlob failure gracefully', async () => {
      vi.mocked(parseBlob).mockRejectedValue(new Error('Parse error'));

      const file = new File(['test'], 'error.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      // Should return track with null metadata fields
      expect(result.title).toBeNull();
      expect(result.artist).toBeNull();
      expect(result.file_path).toBe('error.mp3');
      expect(result.hash).toBe('mock-hash-12345');
    });

    it('handles null metadata object', async () => {
      vi.mocked(parseBlob).mockResolvedValue(null as any);

      const file = new File(['test'], 'null.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.title).toBeNull();
      expect(result.file_path).toBe('null.mp3');
    });

    it('validates BPM within reasonable range', async () => {
      const mockMetadata = {
        common: { title: 'Test', artist: 'Artist' },
        format: {},
        native: {
          'ID3v2.4': [
            { id: 'TBPM', value: '999' }, // Out of range
          ],
        },
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      // BPM > 300 should be rejected
      expect(result.bpm).toBeNull();
    });

    it('accepts valid BPM values', async () => {
      const mockMetadata = {
        common: { title: 'Test', artist: 'Artist' },
        format: {},
        native: {
          'ID3v2.4': [
            { id: 'TBPM', value: '175' },
          ],
        },
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.bpm).toBe(175);
    });

    it('extracts bitrate from format and converts to kbps', async () => {
      const mockMetadata = {
        common: { title: 'Test', artist: 'Artist' },
        format: { bitrate: 256000 },
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.bitrate).toBe(256);
    });

    it('handles vorbis tags (FLAC/OGG)', async () => {
      const mockMetadata = {
        common: {},
        format: {},
        native: {
          'vorbis': [
            { id: 'TITLE', value: 'Vorbis Title' },
            { id: 'ARTIST', value: 'Vorbis Artist' },
            { id: 'ALBUM', value: 'Vorbis Album' },
            { id: 'DATE', value: '2018' },
            { id: 'GENRE', value: 'Electronic' },
          ],
        },
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.flac', { type: 'audio/flac' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.title).toBe('Vorbis Title');
      expect(result.artist).toBe('Vorbis Artist');
      expect(result.album).toBe('Vorbis Album');
      expect(result.year).toBe(2018);
      expect(result.genre).toBe('Electronic');
    });

    it('extracts INITIALKEY tag', async () => {
      const mockMetadata = {
        common: { title: 'Test', artist: 'Artist' },
        format: {},
        native: {
          'ID3v2.4': [
            { id: 'INITIALKEY', value: 'Gm' },
          ],
        },
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.key).toBe('Gm');
    });

    it('includes file size in result', async () => {
      const mockMetadata = {
        common: { title: 'Test', artist: 'Artist' },
        format: {},
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const content = new ArrayBuffer(1024);
      const file = new File([content], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.file_size).toBe(1024);
    });

    it('includes last_modified timestamp', async () => {
      const mockMetadata = {
        common: { title: 'Test', artist: 'Artist' },
        format: {},
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const timestamp = 1700000000000;
      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: timestamp });

      const result = await extractMetadata(file);

      expect(result.last_modified).toBe(new Date(timestamp).toISOString());
    });
  });

  describe('extractMetadataBatch', () => {
    it('processes multiple files sequentially', async () => {
      const mockMetadata = {
        common: { title: 'Track', artist: 'Artist' },
        format: {},
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const files = [
        new File(['1'], 'track1.mp3', { type: 'audio/mpeg' }),
        new File(['2'], 'track2.mp3', { type: 'audio/mpeg' }),
        new File(['3'], 'track3.mp3', { type: 'audio/mpeg' }),
      ];

      files.forEach(f => Object.defineProperty(f, 'lastModified', { value: Date.now() }));

      const results = await extractMetadataBatch(files);

      expect(results).toHaveLength(3);
      expect(results[0].file_path).toBe('track1.mp3');
      expect(results[1].file_path).toBe('track2.mp3');
      expect(results[2].file_path).toBe('track3.mp3');
    });

    it('calls progress callback for each file', async () => {
      const mockMetadata = {
        common: { title: 'Track', artist: 'Artist' },
        format: {},
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const files = [
        new File(['1'], 'track1.mp3', { type: 'audio/mpeg' }),
        new File(['2'], 'track2.mp3', { type: 'audio/mpeg' }),
      ];

      files.forEach(f => Object.defineProperty(f, 'lastModified', { value: Date.now() }));

      const onProgress = vi.fn();

      await extractMetadataBatch(files, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
    });

    it('handles empty file list', async () => {
      const results = await extractMetadataBatch([]);
      expect(results).toHaveLength(0);
    });

    it('continues processing even if one file fails', async () => {
      vi.mocked(parseBlob)
        .mockResolvedValueOnce({
          common: { title: 'Track 1', artist: 'Artist' },
          format: {},
          native: {},
        } as any)
        .mockRejectedValueOnce(new Error('Parse failed'))
        .mockResolvedValueOnce({
          common: { title: 'Track 3', artist: 'Artist' },
          format: {},
          native: {},
        } as any);

      const files = [
        new File(['1'], 'track1.mp3', { type: 'audio/mpeg' }),
        new File(['2'], 'track2.mp3', { type: 'audio/mpeg' }),
        new File(['3'], 'track3.mp3', { type: 'audio/mpeg' }),
      ];

      files.forEach(f => Object.defineProperty(f, 'lastModified', { value: Date.now() }));

      const results = await extractMetadataBatch(files);

      expect(results).toHaveLength(3);
      expect(results[0].title).toBe('Track 1');
      expect(results[1].title).toBeNull(); // Failed extraction
      expect(results[2].title).toBe('Track 3');
    });
  });

  describe('year extraction helpers', () => {
    it('extracts year from ISO date format', async () => {
      const mockMetadata = {
        common: {
          title: 'Test',
          artist: 'Artist',
          date: '2020-12-25',
        },
        format: {},
        native: {},
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.year).toBe(2020);
    });

    it('extracts year from 4-digit string', async () => {
      const mockMetadata = {
        common: {},
        format: {},
        native: {
          'ID3v2.4': [
            { id: 'TDRC', value: '2015' },
          ],
        },
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.year).toBe(2015);
    });

    it('rejects invalid years', async () => {
      const mockMetadata = {
        common: {},
        format: {},
        native: {
          'ID3v2.4': [
            { id: 'TYER', value: '1700' }, // Too old
          ],
        },
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      // Year 1700 is < 1800, should be rejected
      expect(result.year).toBeNull();
    });

    it('extracts year from TORY (original release year)', async () => {
      const mockMetadata = {
        common: {},
        format: {},
        native: {
          'ID3v2.4': [
            { id: 'TORY', value: '1995' },
          ],
        },
      };

      vi.mocked(parseBlob).mockResolvedValue(mockMetadata as any);

      const file = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(file, 'lastModified', { value: Date.now() });

      const result = await extractMetadata(file);

      expect(result.year).toBe(1995);
    });
  });
});
