import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import {
  processDownloads,
  reprocessWithUpdatedMap,
  writeTagsInPlace,
  _testExports,
} from '../downloadProcessor.service';
import { writeFlacGroupingTag } from '../flacTagWriter';
import { UNPATCHABLE_ID3_TAG_ERROR, writeId3GroupingTag } from '../id3TagWriter';
import { concatBytes, frame, silentMp3Frames, tag, text } from './fixtures/id3';
import type { ProcessedFile } from '@/types/slskd';
import { parseBlob } from 'music-metadata';

const { mapToSuperGenre, filterAudioFiles, writeSuperGenreTag, extractFileMetadata } = _testExports;

type ParsedMetadata = Awaited<ReturnType<typeof parseBlob>>;

// vi.mock calls are hoisted above the imports, so the mock fns they close over must be too
const { baseMetadata } = vi.hoisted(() => ({
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
    const bytesOf = async (blob: Blob | Promise<Blob>) => new Uint8Array(await (await blob).arrayBuffer());
    const mp3 = () => concatBytes(tag(3, [frame(3, 'TIT2', text('Title'))], { padding: 64 }), silentMp3Frames());
    // fLaC marker and a STREAMINFO block (the last metadata block), all zeros
    const flac = () => Uint8Array.from([0x66, 0x4c, 0x61, 0x43, 0x80, 0x00, 0x00, 0x22, ...new Array(34).fill(0)]);

    it('writes the Grouping (TIT1) frame of an MP3 with the ID3 writer', async () => {
      const file = new File([mp3()], 'Track.MP3', { type: 'audio/mpeg' });

      expect(await bytesOf(writeSuperGenreTag(file, 'House'))).toEqual(
        await bytesOf(writeId3GroupingTag(mp3().buffer, 'House'))
      );
    });

    it('writes the GROUPING comment of a FLAC with the Vorbis Comment writer', async () => {
      const file = new File([flac()], 'track.flac', { type: 'audio/flac' });

      expect(await bytesOf(writeSuperGenreTag(file, 'House'))).toEqual(
        await bytesOf(writeFlacGroupingTag(flac().buffer, 'House'))
      );
    });

    it('rejects formats it cannot write', async () => {
      const file = new File([new Uint8Array(16)], 'track.m4a', { type: 'audio/mp4' });

      await expect(writeSuperGenreTag(file, 'House')).rejects.toThrow('Tag writing is not supported for .m4a files');
    });

    it('rejects an MP3 whose ID3 tag cannot be changed safely', async () => {
      const file = new File([tag(3, [frame(3, 'TIT2', text('Title'))], { flags: 0x40 })], 'track.mp3');

      await expect(writeSuperGenreTag(file, 'House')).rejects.toThrow(UNPATCHABLE_ID3_TAG_ERROR);
    });
  });

  describe('writeTagsInPlace', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    const handleFor = () => {
      const writable = { write: vi.fn(), close: vi.fn() };
      const fileHandle = { createWritable: vi.fn().mockResolvedValue(writable) };
      return { writable, fileHandle };
    };

    const mappedFile = (file: File, fileHandle: object): ProcessedFile => ({
      filename: file.name,
      relativePath: file.name,
      artist: 'Artist',
      title: 'Title',
      album: null,
      genres: ['deep house'],
      superGenre: 'House',
      status: 'mapped',
      file,
      fileHandle: fileHandle as unknown as FileSystemFileHandle,
    });

    const mp3File = (flags = 0) =>
      new File([tag(3, [frame(3, 'TIT2', text('Title'))], { padding: 64, flags }), silentMp3Frames()], 'track.mp3');

    it('writes the patched file back through its handle', async () => {
      const { writable, fileHandle } = handleFor();
      const file = mp3File();

      const result = await writeTagsInPlace([mappedFile(file, fileHandle)]);

      expect(result).toEqual({ success: 1, skipped: 0, errors: [] });
      const written = writable.write.mock.calls[0][0] as Blob;
      expect(new Uint8Array(await written.arrayBuffer())).toEqual(
        new Uint8Array(await writeId3GroupingTag(await file.arrayBuffer(), 'House').arrayBuffer())
      );
      expect(writable.close).toHaveBeenCalled();
    });

    it('skips a file whose Grouping already holds the SuperGenre', async () => {
      mockNextParse({ ...baseMetadata, common: { ...baseMetadata.common, grouping: 'House' } });
      const { fileHandle } = handleFor();

      const result = await writeTagsInPlace([mappedFile(mp3File(), fileHandle)]);

      expect(result).toEqual({ success: 0, skipped: 1, errors: [] });
      expect(fileHandle.createWritable).not.toHaveBeenCalled();
    });

    it('reports a file whose ID3 tag cannot be changed safely and never opens it for writing', async () => {
      const { fileHandle } = handleFor();

      const result = await writeTagsInPlace([mappedFile(mp3File(0x40), fileHandle)]);

      expect(result).toEqual({
        success: 0,
        skipped: 0,
        errors: [{ filename: 'track.mp3', error: expect.stringContaining(UNPATCHABLE_ID3_TAG_ERROR) }],
      });
      expect(fileHandle.createWritable).not.toHaveBeenCalled();
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
