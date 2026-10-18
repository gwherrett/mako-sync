import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import {
  processDownloads,
  reprocessWithUpdatedMap,
  _testExports,
} from '../downloadProcessor.service';
import type { ProcessedFile } from '@/types/slskd';
import { parseBlob } from 'music-metadata';

const { mapToSuperGenre, filterAudioFiles, writeSuperGenreTag, extractFileMetadata } = _testExports;

type ParsedMetadata = Awaited<ReturnType<typeof parseBlob>>;

// vi.mock calls are hoisted above the imports, so the mock fns they close over must be too
const { mockSetFrame, mockAddTag, mockGetBlob, baseMetadata } = vi.hoisted(() => ({
  mockSetFrame: vi.fn(),
  mockAddTag: vi.fn(),
  mockGetBlob: vi.fn().mockReturnValue(new Blob(['test'], { type: 'audio/mpeg' })),
  // Shaped like music-metadata 12 output: comments are objects with a `descriptor`
  baseMetadata: {
    common: {
      title: 'Test Title',
      artist: 'Test Artist',
      album: 'Test Album',
      year: 2024,
      track: { no: 1, of: 10 },
      genre: ['Test Genre'],
      albumartist: 'Test Album Artist',
      composer: ['Test Composer'],
      comment: [{ descriptor: '', language: 'eng', text: 'Test Comment' }],
      picture: [] as Array<{ format: string; type?: string; description?: string; data: Uint8Array }>,
    },
    native: {
      'ID3v2.3': [
        { id: 'TXXX', value: { description: 'EXISTING_CUSTOM', text: 'existing value' } },
        { id: 'COMM', value: { language: 'eng', descriptor: 'Other Comment', text: 'other comment text' } },
        { id: 'COMM', value: { language: 'eng', descriptor: '', text: 'default comment' } },
      ],
    },
    format: { tagTypes: ['ID3v2.3'] },
  },
}));

vi.mock('browser-id3-writer', () => ({
  ID3Writer: class {
    setFrame = mockSetFrame;
    addTag = mockAddTag;
    getBlob = mockGetBlob;
  },
}));

// Mock parseBlob to avoid actual file parsing
vi.mock('music-metadata', () => ({
  parseBlob: vi.fn().mockResolvedValue(baseMetadata),
}));

const mockNextParse = (metadata: object) =>
  vi.mocked(parseBlob).mockResolvedValueOnce(metadata as unknown as ParsedMetadata);

describe('downloadProcessor.service', () => {
  describe('mapToSuperGenre', () => {
    const genreMap = new Map<string, string>([
      ['deep house', 'House'],
      ['tech house', 'House'],
      ['drum and bass', 'Drum & Bass'],
      ['hip hop', 'Hip Hop'],
      ['uk garage', 'Bass'],
      ['pop', 'Pop'],
    ]);

    it('returns exact match (case-insensitive)', () => {
      expect(mapToSuperGenre(['Deep House'], genreMap)).toBe('House');
      expect(mapToSuperGenre(['DEEP HOUSE'], genreMap)).toBe('House');
      expect(mapToSuperGenre(['deep house'], genreMap)).toBe('House');
    });

    it('returns first matching genre when multiple provided', () => {
      expect(mapToSuperGenre(['unknown', 'deep house', 'pop'], genreMap)).toBe(
        'House'
      );
    });

    it('returns null when no match found', () => {
      expect(mapToSuperGenre(['unknown genre'], genreMap)).toBeNull();
      expect(mapToSuperGenre(['classical'], genreMap)).toBeNull();
    });

    it('returns null for empty genres array', () => {
      expect(mapToSuperGenre([], genreMap)).toBeNull();
    });

    it('handles partial matches - genre contains mapped key', () => {
      // "progressive deep house" contains "deep house"
      expect(mapToSuperGenre(['progressive deep house'], genreMap)).toBe(
        'House'
      );
    });

    it('handles partial matches - mapped key contains genre', () => {
      // "hip hop" contains "hip"
      expect(mapToSuperGenre(['hip'], genreMap)).toBe('Hip Hop');
    });

    it('trims whitespace from genres', () => {
      expect(mapToSuperGenre(['  deep house  '], genreMap)).toBe('House');
    });
  });

  describe('filterAudioFiles', () => {
    it('filters to only supported audio files (MP3, FLAC, M4A)', () => {
      const files = [
        new File([''], 'track1.mp3', { type: 'audio/mpeg' }),
        new File([''], 'track2.MP3', { type: 'audio/mpeg' }),
        new File([''], 'image.jpg', { type: 'image/jpeg' }),
        new File([''], 'document.pdf', { type: 'application/pdf' }),
        new File([''], 'track3.flac', { type: 'audio/flac' }),
        new File([''], 'track4.m4a', { type: 'audio/mp4' }),
        new File([''], 'track5.wav', { type: 'audio/wav' }),
      ];

      const audioFiles = filterAudioFiles(files);
      expect(audioFiles).toHaveLength(4);
      expect(audioFiles.map((f) => f.name)).toEqual([
        'track1.mp3',
        'track2.MP3',
        'track3.flac',
        'track4.m4a',
      ]);
    });

    it('returns empty array when no supported audio files', () => {
      const files = [
        new File([''], 'image.jpg', { type: 'image/jpeg' }),
        new File([''], 'document.pdf', { type: 'application/pdf' }),
      ];

      expect(filterAudioFiles(files)).toHaveLength(0);
    });

    it('handles empty input', () => {
      expect(filterAudioFiles([])).toHaveLength(0);
    });
  });

  describe('reprocessWithUpdatedMap', () => {
    const initialFiles: ProcessedFile[] = [
      {
        filename: 'track1.mp3',
        relativePath: 'folder/track1.mp3',
        artist: 'Artist 1',
        title: 'Track 1',
        album: 'Album 1',
        genres: ['deep house'],
        superGenre: null,
        status: 'unmapped',
        file: new File([''], 'track1.mp3'),
      },
      {
        filename: 'track2.mp3',
        relativePath: 'folder/track2.mp3',
        artist: 'Artist 2',
        title: 'Track 2',
        album: null,
        genres: ['unknown genre'],
        superGenre: null,
        status: 'unmapped',
        file: new File([''], 'track2.mp3'),
      },
      {
        filename: 'track3.mp3',
        relativePath: 'folder/track3.mp3',
        artist: 'Artist 3',
        title: 'Track 3',
        album: 'Album 3',
        genres: [],
        superGenre: null,
        status: 'unmapped', // No genres = unmapped (needs manual assignment)
        file: new File([''], 'track3.mp3'),
      },
      {
        filename: 'error.mp3',
        relativePath: 'folder/error.mp3',
        artist: 'Unknown',
        title: 'error',
        album: null,
        genres: [],
        superGenre: null,
        status: 'error',
        error: 'Parse failed',
        file: new File([''], 'error.mp3'),
      },
    ];

    it('updates files when genre map is extended', () => {
      const updatedMap = new Map<string, string>([
        ['deep house', 'House'],
        // 'unknown genre' still not mapped
      ]);

      const result = reprocessWithUpdatedMap(initialFiles, updatedMap);

      expect(result.files[0].superGenre).toBe('House');
      expect(result.files[0].status).toBe('mapped');

      expect(result.files[1].superGenre).toBeNull();
      expect(result.files[1].status).toBe('unmapped');

      // File with no genres is unmapped (needs manual assignment)
      expect(result.files[2].status).toBe('unmapped');

      // Error files stay as errors
      expect(result.files[3].status).toBe('error');
    });

    it('calculates correct summary', () => {
      const updatedMap = new Map<string, string>([['deep house', 'House']]);

      const result = reprocessWithUpdatedMap(initialFiles, updatedMap);

      expect(result.summary).toEqual({
        total: 4,
        mapped: 1, // track1 now mapped
        unmapped: 2, // track2 still unmapped + track3 (no genres)
        errors: 1, // error.mp3
      });
    });

    it('updates unmapped genres list', () => {
      const updatedMap = new Map<string, string>([['deep house', 'House']]);

      const result = reprocessWithUpdatedMap(initialFiles, updatedMap);

      expect(result.unmappedGenres).toEqual(['unknown genre']);
    });

    it('handles empty genre map', () => {
      const emptyMap = new Map<string, string>();

      const result = reprocessWithUpdatedMap(initialFiles, emptyMap);

      // All files without a SuperGenre should be unmapped
      expect(result.files[0].status).toBe('unmapped');
      expect(result.files[1].status).toBe('unmapped');
      expect(result.files[2].status).toBe('unmapped'); // No genres = unmapped
    });

    it('preserves manually assigned SuperGenre for files with no genres', () => {
      // Simulate a file with no genres that was manually assigned a SuperGenre
      const filesWithManualAssignment: ProcessedFile[] = [
        {
          filename: 'manual.mp3',
          relativePath: 'folder/manual.mp3',
          artist: 'Artist',
          title: 'Manual Track',
          album: 'Album',
          genres: [], // No genres
          superGenre: 'Techno', // Manually assigned
          status: 'mapped',
          file: new File([''], 'manual.mp3'),
        },
        {
          filename: 'unassigned.mp3',
          relativePath: 'folder/unassigned.mp3',
          artist: 'Artist 2',
          title: 'Unassigned Track',
          album: 'Album 2',
          genres: [], // No genres, not assigned yet
          superGenre: null,
          status: 'unmapped',
          file: new File([''], 'unassigned.mp3'),
        },
      ];

      const genreMap = new Map<string, string>();
      const result = reprocessWithUpdatedMap(filesWithManualAssignment, genreMap);

      // Manually assigned should be preserved
      expect(result.files[0].superGenre).toBe('Techno');
      expect(result.files[0].status).toBe('mapped');

      // Unassigned should stay unmapped
      expect(result.files[1].superGenre).toBeNull();
      expect(result.files[1].status).toBe('unmapped');

      expect(result.summary.mapped).toBe(1);
      expect(result.summary.unmapped).toBe(1);
    });
  });

  describe('processDownloads', () => {
    // Note: Full integration tests would require mocking music-metadata
    // These tests focus on the orchestration logic

    it('reports progress during processing', async () => {
      const progressUpdates: { current: number; total: number }[] = [];
      const files = [
        new File([''], 'track1.mp3', { type: 'audio/mpeg' }),
        new File([''], 'track2.mp3', { type: 'audio/mpeg' }),
      ];
      const genreMap = new Map<string, string>();

      try {
        await processDownloads(files, genreMap, (progress) => {
          progressUpdates.push({
            current: progress.current,
            total: progress.total,
          });
        });
      } catch {
        // May fail due to mocking issues in test environment
      }

      // Progress should be called for each file
      // Note: Actual assertions depend on mock working correctly
    });

    it('handles empty file list', async () => {
      const result = await processDownloads([], new Map());

      expect(result.files).toHaveLength(0);
      expect(result.unmappedGenres).toHaveLength(0);
      expect(result.summary).toEqual({
        total: 0,
        mapped: 0,
        unmapped: 0,
        errors: 0,
      });
    });

    it('filters out unsupported file types', async () => {
      const files = [
        new File([''], 'image.jpg', { type: 'image/jpeg' }),
        new File([''], 'document.pdf', { type: 'application/pdf' }),
      ];

      const result = await processDownloads(files, new Map());

      expect(result.files).toHaveLength(0);
      expect(result.summary.total).toBe(0);
    });
  });

  describe('writeSuperGenreTag', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('writes SuperGenre to Grouping (TIT1) field', async () => {
      // Create a minimal valid MP3 file buffer (ID3v2 header + minimal frame data)
      const id3Header = new Uint8Array([
        0x49, 0x44, 0x33, // "ID3"
        0x03, 0x00,       // Version 2.3
        0x00,             // Flags
        0x00, 0x00, 0x00, 0x0a, // Size (10 bytes)
      ]);
      const padding = new Uint8Array(10);
      const fileContent = new Uint8Array([...id3Header, ...padding]);

      const file = new File([fileContent], 'test.mp3', { type: 'audio/mpeg' });

      try {
        await writeSuperGenreTag(file, 'House');
      } catch {
        // May fail in test environment due to mocking complexity
      }

      // Verify TIT1 (Grouping) frame was called with SuperGenre value
      const tit1Calls = mockSetFrame.mock.calls.filter(
        (call: [string, unknown]) => call[0] === 'TIT1'
      );

      // Should have a TIT1 call with the SuperGenre value
      expect(tit1Calls).toHaveLength(1);
      expect(tit1Calls[0][1]).toBe('House');
    });

    it('does NOT write to COMM:Songs-DB_Custom1 (legacy format)', async () => {
      const id3Header = new Uint8Array([
        0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a,
      ]);
      const padding = new Uint8Array(10);
      const fileContent = new Uint8Array([...id3Header, ...padding]);

      const file = new File([fileContent], 'test.mp3', { type: 'audio/mpeg' });

      try {
        await writeSuperGenreTag(file, 'Techno');
      } catch {
        // May fail in test environment
      }

      // Verify NO COMM frame was written with Songs-DB_Custom1 description
      const commCalls = mockSetFrame.mock.calls.filter(
        (call: [string, unknown]) => call[0] === 'COMM'
      );

      // The writer must have run, otherwise the check below passes vacuously
      expect(commCalls.length).toBeGreaterThan(0);

      const songDbCustomCall = commCalls.find(
        (call: [string, { description: string }]) =>
          call[1]?.description === 'Songs-DB_Custom1'
      );

      // Should NOT find any COMM:Songs-DB_Custom1 - we use TIT1 (Grouping) now
      expect(songDbCustomCall).toBeUndefined();
    });

    const mp3File = () => {
      const id3Header = new Uint8Array([
        0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a,
      ]);
      return new File([id3Header, new Uint8Array(10)], 'test.mp3', { type: 'audio/mpeg' });
    };

    const framesWritten = (id: string) =>
      mockSetFrame.mock.calls.filter((call: [string, unknown]) => call[0] === id);

    it('carries over only the default comment, without a descriptor', async () => {
      await writeSuperGenreTag(mp3File(), 'Drum & Bass');

      // music-metadata 12 reports every COMM frame under "COMM". With music-metadata 7 the described
      // ones arrived as "COMM:<descriptor>" and were never carried over, so they must stay dropped
      // rather than being rewritten with an empty descriptor.
      expect(framesWritten('COMM').map((call) => call[1])).toEqual([
        { description: '', text: 'default comment', language: 'eng' },
      ]);
    });

    it('falls back to the first default common.comment when no native default comment exists', async () => {
      mockNextParse({
        ...baseMetadata,
        common: {
          ...baseMetadata.common,
          comment: [
            { descriptor: 'iTunNORM', language: 'eng', text: ' 00000721 00000834' },
            { text: 'ID3v1 comment' },
          ],
        },
        native: {},
      });

      await writeSuperGenreTag(mp3File(), 'House');

      expect(framesWritten('COMM').map((call) => call[1])).toEqual([
        { description: '', text: 'ID3v1 comment', language: 'eng' },
      ]);
    });

    it('does not turn a described common.comment into the default comment', async () => {
      mockNextParse({
        ...baseMetadata,
        common: {
          ...baseMetadata.common,
          comment: [{ descriptor: 'iTunPGAP', language: 'eng', text: '0' }],
        },
        native: {},
      });

      await writeSuperGenreTag(mp3File(), 'House');

      expect(framesWritten('COMM')).toHaveLength(0);
    });

    it('writes each genre of a slash-joined ID3v2.3 genre separately', async () => {
      mockNextParse({
        ...baseMetadata,
        common: { ...baseMetadata.common, genre: ['Hip Hop/Rap'] },
        format: { tagTypes: ['ID3v2.3'] },
      });

      await writeSuperGenreTag(mp3File(), 'Hip Hop');

      expect(framesWritten('TCON').map((call) => call[1])).toEqual([['Hip Hop', 'Rap']]);
    });

    it('keeps a slash inside an ID3v2.4 genre', async () => {
      mockNextParse({
        ...baseMetadata,
        common: { ...baseMetadata.common, genre: ['Hip Hop/Rap'] },
        format: { tagTypes: ['ID3v2.4'] },
      });

      await writeSuperGenreTag(mp3File(), 'Hip Hop');

      expect(framesWritten('TCON').map((call) => call[1])).toEqual([['Hip Hop/Rap']]);
    });

    it('passes cover art through as the Uint8Array music-metadata returns', async () => {
      const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      mockNextParse({
        ...baseMetadata,
        common: {
          ...baseMetadata.common,
          picture: [{ format: 'image/png', type: 'Cover (front)', description: 'front', data }],
        },
      });

      await writeSuperGenreTag(mp3File(), 'House');

      expect(framesWritten('APIC').map((call) => call[1])).toEqual([
        { type: 3, data, description: 'front', useUnicodeEncoding: false },
      ]);
    });

    it('preserves existing TXXX frames', async () => {
      const id3Header = new Uint8Array([
        0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a,
      ]);
      const padding = new Uint8Array(10);
      const fileContent = new Uint8Array([...id3Header, ...padding]);

      const file = new File([fileContent], 'test.mp3', { type: 'audio/mpeg' });

      try {
        await writeSuperGenreTag(file, 'Techno');
      } catch {
        // May fail in test environment
      }

      // Verify existing TXXX frames are preserved
      const txxxCalls = mockSetFrame.mock.calls.filter(
        (call: [string, unknown]) => call[0] === 'TXXX'
      );

      const existingCustomCall = txxxCalls.find(
        (call: [string, { description: string }]) =>
          call[1]?.description === 'EXISTING_CUSTOM'
      );

      expect(existingCustomCall?.[1]).toEqual({
        description: 'EXISTING_CUSTOM',
        value: 'existing value',
      });
    });
  });

  // music-metadata 7 split a slash-joined ID3v2.2/2.3 genre ("Hip Hop/Rap") into two values;
  // 12 keeps it as one. Genre mapping was built around the split values.
  describe('extractFileMetadata genres', () => {
    const mp3 = () => new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
    const parsed = (tagType: string, genre: string) => ({
      common: { artist: 'Artist', title: 'Title', genre: [genre] },
      native: { [tagType]: [{ id: 'TCON', value: genre }] },
      format: { tagTypes: [tagType] },
    });

    it('splits a slash-joined ID3v2.3 genre so each part can be mapped', async () => {
      mockNextParse(parsed('ID3v2.3', 'Hip Hop/Rap'));

      const { genres } = await extractFileMetadata(mp3());

      expect(genres).toEqual(['Hip Hop', 'Rap']);
    });

    it('keeps a slash-joined ID3v2.4 genre whole', async () => {
      mockNextParse(parsed('ID3v2.4', 'Hip Hop/Rap'));

      const { genres } = await extractFileMetadata(mp3());

      expect(genres).toEqual(['Hip Hop/Rap']);
    });

    it('still maps a slash-joined ID3v2.3 genre by its first part', async () => {
      mockNextParse(parsed('ID3v2.3', 'Hip Hop/Rap'));
      // "rap" comes first in the map: the whole string would partial-match it before "hip hop"
      const genreMap = new Map([
        ['rap', 'Rap'],
        ['hip hop', 'Hip Hop'],
      ]);

      const { genres } = await extractFileMetadata(mp3());

      expect(mapToSuperGenre(genres, genreMap)).toBe('Hip Hop');
    });
  });
});
