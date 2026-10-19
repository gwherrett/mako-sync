/**
 * Runs the scanner and the tag writer against a real tagged MP3 and the real music-metadata
 * parser (no mocks). The other tests mock `parseBlob`, so they cannot notice when the shape of
 * what the parser returns changes between versions; this one can.
 */
import { describe, it, expect } from 'vitest';
import { parseBlob } from 'music-metadata';
import { extractMetadata } from '../metadataExtractor';
import { _testExports } from '../downloadProcessor.service';
import type { AudioComment } from '@/utils/audioTags';
import {
  comment,
  frame,
  object,
  picture,
  PNG,
  popularimeter,
  silentMp3Frames,
  tag,
  text,
  uniqueFileId,
  userText,
} from './fixtures/id3';

const { extractFileMetadata, writeSuperGenreTag } = _testExports;

/** An ID3v2.3 MP3 tagged the way DJ and library tools do, and analysed by Serato. */
const taggedMp3 = (): File => {
  const frames = [
    frame(3, 'TIT2', text('Real Title')),
    frame(3, 'TPE1', text('Real Artist')),
    frame(3, 'TALB', text('Real Album')),
    frame(3, 'TYER', text('2021')),
    frame(3, 'TRCK', text('3/12')),
    frame(3, 'TCON', text('Hip Hop/Rap')), // one frame holding two genres, as ID3v2.3 taggers write them
    frame(3, 'TBPM', text('124')),
    frame(3, 'TKEY', text('Am')),
    frame(3, 'TIT1', text('Old Grouping')),
    frame(3, 'COMM', comment('', 'plain comment')),
    frame(3, 'COMM', comment('Songs-DB_Custom1', 'House')),
    frame(3, 'COMM', comment('iTunNORM', ' 00000721 00000834')),
    frame(3, 'TXXX', userText('SERATO_PLAYCOUNT', '12')),
    frame(3, 'GEOB', object('Serato Markers2', [0x01, 0x01, 0x41, 0x51, 0x3d])),
    frame(3, 'POPM', popularimeter('traktor@native-instruments.de', 196, 7)),
    frame(3, 'UFID', uniqueFileId('http://musicbrainz.org', 'b1a9c0e9')),
    frame(3, 'APIC', picture(3, PNG, 'front')),
    frame(3, 'APIC', picture(3, PNG, 'back')),
  ];
  return new File([tag(3, frames, { padding: 256 }), silentMp3Frames()], 'track.mp3', { type: 'audio/mpeg' });
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
    const written = async () =>
      new File([await writeSuperGenreTag(taggedMp3(), 'House')], 'track.mp3', { type: 'audio/mpeg' });
    const rewrite = async () => parseBlob(await written(), { skipCovers: false });

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

    it('keeps BPM, key and genres for the next scan', async () => {
      const file = await written();

      expect(await extractMetadata(file)).toMatchObject({
        bpm: 124,
        key: 'Am',
        genre: 'Hip Hop',
        super_genre: 'House',
      });
      expect((await extractFileMetadata(file)).genres).toEqual(['Hip Hop', 'Rap']);
    });

    it('keeps every comment, including described ones', async () => {
      const { native } = await rewrite();

      const comments = native['ID3v2.3']
        .filter((tag) => tag.id === 'COMM')
        .map((tag) => tag.value as AudioComment);
      expect(comments.map(({ descriptor, text }) => ({ descriptor, text }))).toEqual([
        { descriptor: '', text: 'plain comment' },
        { descriptor: 'Songs-DB_Custom1', text: 'House' },
        { descriptor: 'iTunNORM', text: ' 00000721 00000834' },
      ]);
    });

    it('keeps Serato data, the play count, rating and file id', async () => {
      const { native } = await rewrite();

      const ids = native['ID3v2.3'].map((tag) => tag.id);
      expect(ids).toEqual(expect.arrayContaining(['TXXX:SERATO_PLAYCOUNT', 'GEOB', 'POPM', 'UFID']));
      expect(native['ID3v2.3'].find((tag) => tag.id === 'GEOB')?.value).toMatchObject({
        description: 'Serato Markers2',
      });
    });

    it('keeps every picture byte for byte', async () => {
      const { common } = await rewrite();

      expect(common.picture?.map((picture) => picture.data)).toEqual([PNG, PNG]);
    });
  });
});
