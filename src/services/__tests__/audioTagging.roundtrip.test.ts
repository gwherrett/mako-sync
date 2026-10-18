/**
 * Runs the scanner and the tag writer against a real tagged MP3 and the real music-metadata
 * parser (no mocks). The other tests mock `parseBlob`, so they cannot notice when the shape of
 * what the parser returns changes between versions; this one can.
 */
import { describe, it, expect } from 'vitest';
import { ID3Writer } from 'browser-id3-writer';
import { parseBlob } from 'music-metadata';
import { extractMetadata } from '../metadataExtractor';
import { _testExports } from '../downloadProcessor.service';
import type { AudioComment } from '@/utils/audioTags';

const { extractFileMetadata, writeSuperGenreTag } = _testExports;

// 1x1 PNG
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0)
);

/** Eight silent MPEG-1 Layer III frames (128 kbps, 44.1 kHz): enough for a parser to read the format. */
const silentMp3Frames = (): Uint8Array => {
  const FRAME_LENGTH = 417;
  const frames = new Uint8Array(FRAME_LENGTH * 8);
  for (let i = 0; i < 8; i++) frames.set([0xff, 0xfb, 0x90, 0x00], i * FRAME_LENGTH);
  return frames;
};

/** An ID3v2.3 MP3 tagged the way DJ and library tools do. */
const taggedMp3 = (): File => {
  const writer = new ID3Writer(silentMp3Frames().buffer as ArrayBuffer);
  writer
    .setFrame('TIT2', 'Real Title')
    .setFrame('TPE1', ['Real Artist'])
    .setFrame('TALB', 'Real Album')
    .setFrame('TYER', 2021)
    .setFrame('TRCK', '3/12')
    .setFrame('TCON', ['Hip Hop/Rap']) // one frame holding two genres, as ID3v2.3 taggers write them
    .setFrame('TBPM', 124)
    .setFrame('TKEY', 'Am')
    .setFrame('TIT1', 'Old Grouping')
    .setFrame('COMM', { description: '', text: 'plain comment', language: 'eng' })
    .setFrame('COMM', { description: 'Songs-DB_Custom1', text: 'House', language: 'eng' })
    .setFrame('COMM', { description: 'iTunNORM', text: ' 00000721 00000834', language: 'eng' })
    .setFrame('APIC', {
      type: 3,
      data: PNG.buffer as ArrayBuffer,
      description: 'front',
      useUnicodeEncoding: false,
    });
  writer.addTag();
  return new File([writer.getBlob()], 'track.mp3', { type: 'audio/mpeg' });
};

describe('scanner and tag writer against the real music-metadata parser', () => {
  it('scans the fields stored for each local file', async () => {
    const result = await extractMetadata(taggedMp3());

    expect(result).toMatchObject({
      title: 'Real Title',
      artist: 'Real Artist',
      album: 'Real Album',
      year: 2021,
      genre: 'Hip Hop', // first part of the slash-joined genre
      bpm: 124,
      key: 'Am',
      super_genre: 'Old Grouping',
      sample_rate: 44100,
      audio_format: 'mp3',
    });
    expect(result.bitrate).toBe(128);
    expect(result.duration_seconds).toBeGreaterThan(0);
  });

  it('extracts each part of a slash-joined ID3v2.3 genre for SuperGenre mapping', async () => {
    const { genres, artist, title } = await extractFileMetadata(taggedMp3());

    expect(genres).toEqual(['Hip Hop', 'Rap']);
    expect(artist).toBe('Real Artist');
    expect(title).toBe('Real Title');
  });

  describe('writing the SuperGenre', () => {
    const rewrite = async () => parseBlob(await writeSuperGenreTag(taggedMp3(), 'House'), { skipCovers: false });

    it('replaces the grouping and keeps the core tags', async () => {
      const { common } = await rewrite();

      expect(common.grouping).toBe('House');
      expect(common).toMatchObject({
        title: 'Real Title',
        artist: 'Real Artist',
        album: 'Real Album',
        year: 2021,
        track: { no: 3, of: 12 },
      });
    });

    it('writes both parts of the slash-joined genre', async () => {
      const { native } = await rewrite();

      const genreText = native['ID3v2.3'].filter((tag) => tag.id === 'TCON').map((tag) => String(tag.value));
      expect(genreText.join(';')).toContain('Hip Hop');
      expect(genreText.join(';')).toContain('Rap');
    });

    it('keeps the default comment and does not rewrite described comments as default ones', async () => {
      const { native } = await rewrite();

      const comments = native['ID3v2.3']
        .filter((tag) => tag.id === 'COMM')
        .map((tag) => tag.value as AudioComment);
      expect(comments).toEqual([expect.objectContaining({ descriptor: '', text: 'plain comment' })]);
    });

    it('keeps the cover art byte for byte', async () => {
      const { common } = await rewrite();

      expect(common.picture).toHaveLength(1);
      expect(common.picture?.[0].data).toEqual(PNG);
    });
  });
});
