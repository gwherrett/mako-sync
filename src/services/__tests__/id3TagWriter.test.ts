/**
 * Byte-level tests for the ID3v2 Grouping writer. Fixtures are built frame by frame, so each
 * test can state the exact bytes it expects back: every frame except Grouping, and the audio
 * after the tag, must come out unchanged. The real music-metadata parser then reads the result.
 */
import { describe, it, expect } from 'vitest';
import { parseBlob } from 'music-metadata';
import { UNPATCHABLE_ID3_TAG_ERROR, writeId3GroupingTag } from '../id3TagWriter';
import {
  comment,
  concatBytes,
  frame,
  id3v1,
  object,
  picture,
  PNG,
  popularimeter,
  silentMp3Frames,
  synchsafe,
  tag,
  text,
  uniqueFileId,
  userText,
  type Id3Version,
} from './fixtures/id3';

const write = async (input: Uint8Array, superGenre = 'House'): Promise<Uint8Array> =>
  new Uint8Array(await writeId3GroupingTag(input.slice().buffer, superGenre).arrayBuffer());

const parse = (bytes: Uint8Array) =>
  parseBlob(new Blob([bytes], { type: 'audio/mpeg' }), { skipCovers: false });

const sizeOf = (frames: Uint8Array[]): number => frames.reduce((total, f) => total + f.length, 0);

const ID = {
  2: { title: 'TT2', grouping: 'TT1', bpm: 'TBP', key: 'TKE', picture: 'PIC' },
  3: { title: 'TIT2', grouping: 'TIT1', bpm: 'TBPM', key: 'TKEY', picture: 'APIC' },
  4: { title: 'TIT2', grouping: 'TIT1', bpm: 'TBPM', key: 'TKEY', picture: 'APIC' },
};

const grouping = (version: Id3Version, value: string) => frame(version, ID[version].grouping, text(value));
const title = (version: Id3Version) => frame(version, ID[version].title, text('Real Title'));

describe('writeId3GroupingTag', () => {
  it.each([2, 3, 4] as const)(
    'ID3v2.%i: replaces the Grouping frame and keeps the other frames and the audio byte for byte',
    async (version) => {
      const bpm = frame(version, ID[version].bpm, text('124'));
      const key = frame(version, ID[version].key, text('Am'));
      const cover = frame(version, ID[version].picture, picture(version, PNG, 'front'));
      const audio = silentMp3Frames();
      const input = concatBytes(
        tag(version, [title(version), grouping(version, 'Old Grouping'), bpm, key, cover], { padding: 256 }),
        audio
      );

      const output = await write(input);

      // The new frame is shorter than the old one, so the padding takes up the difference
      const frames = [title(version), bpm, key, cover, grouping(version, 'House')];
      const padding = input.length - audio.length - 10 - sizeOf(frames);
      expect(output).toEqual(concatBytes(tag(version, frames, { padding }), audio));

      const { common, format } = await parse(output);
      expect(common).toMatchObject({ grouping: 'House', title: 'Real Title', bpm: 124 });
      expect(common.picture?.[0].data).toEqual(PNG);
      expect(format.sampleRate).toBe(44100);
    }
  );

  it('adds a Grouping frame after the existing frames when there is none', async () => {
    const audio = silentMp3Frames();
    const input = concatBytes(tag(4, [title(4)], { padding: 64 }), audio);

    const output = await write(input);

    const frames = [title(4), grouping(4, 'House')];
    expect(output).toEqual(concatBytes(tag(4, frames, { padding: 64 + sizeOf([title(4)]) - sizeOf(frames) }), audio));
    expect((await parse(output)).common.grouping).toBe('House');
  });

  it('replaces every Grouping frame when a file has more than one', async () => {
    const audio = silentMp3Frames();
    const input = concatBytes(
      tag(3, [grouping(3, 'Rock'), title(3), grouping(3, 'Pop')], { padding: 32 }),
      audio
    );

    const output = await write(input);

    const frames = [title(3), grouping(3, 'House')];
    expect(output).toEqual(concatBytes(tag(3, frames, { padding: input.length - audio.length - 10 - sizeOf(frames) }), audio));
  });

  it('grows the tag when the padding is too small for the new frame', async () => {
    const audio = silentMp3Frames();
    const input = concatBytes(tag(3, [title(3), grouping(3, 'Pop')]), audio);

    const output = await write(input, 'Drum & Bass');

    // New tags get 1024 bytes of padding so the next write fits in place
    expect(output).toEqual(concatBytes(tag(3, [title(3), grouping(3, 'Drum & Bass')], { padding: 1024 }), audio));
    const { common, format } = await parse(output);
    expect(common.grouping).toBe('Drum & Bass');
    expect(format.duration).toBeGreaterThan(0);
  });

  it('puts a new ID3v2.3 tag in front of a file without one and leaves a trailing ID3v1 tag alone', async () => {
    const audio = silentMp3Frames();
    const v1 = id3v1('Title From ID3v1');

    const output = await write(concatBytes(audio, v1));

    expect(output).toEqual(concatBytes(tag(3, [grouping(3, 'House')], { padding: 1024 }), audio, v1));
    const { common, native } = await parse(output);
    expect(common.grouping).toBe('House');
    expect(native.ID3v1).toContainEqual({ id: 'title', value: 'Title From ID3v1' });
  });

  it('gives the same bytes back when the Grouping already holds the value', async () => {
    const input = concatBytes(tag(3, [title(3), grouping(3, 'Jazz')], { padding: 100 }), silentMp3Frames());

    const once = await write(input);

    expect(await write(once)).toEqual(once);
  });

  it.each([3, 4] as const)(
    'ID3v2.%i: keeps Serato data, ratings, BPM, key, custom text, described comments and every picture',
    async (version) => {
      const others = [
        title(version),
        frame(version, 'GEOB', object('Serato Markers2', [0x01, 0x01, 0xff, 0x00, 0x42])),
        frame(version, 'GEOB', object('Serato BeatGrid', [0x01, 0x00, 0x00, 0x00, 0x00, 0x01])),
        frame(version, 'POPM', popularimeter('traktor@native-instruments.de', 196, 7)),
        frame(version, 'UFID', uniqueFileId('http://musicbrainz.org', 'b1a9c0e9')),
        frame(version, 'TBPM', text('124')),
        frame(version, 'TKEY', text('Am')),
        frame(version, 'TXXX', userText('SERATO_PLAYCOUNT', '12')),
        frame(version, 'COMM', comment('', 'plain comment')),
        frame(version, 'COMM', comment('iTunNORM', ' 00000721 00000834')),
        frame(version, 'APIC', picture(version, PNG, 'front')),
        frame(version, 'APIC', picture(version, PNG, 'back')),
        frame(version, 'ZZZZ', [0xde, 0xad, 0xbe, 0xef]), // a frame nobody knows
      ];
      const audio = silentMp3Frames();
      const input = concatBytes(tag(version, [...others, grouping(version, 'Old')], { padding: 512 }), audio);

      const output = await write(input);

      const frames = [...others, grouping(version, 'House')];
      const padding = input.length - audio.length - 10 - sizeOf(frames);
      expect(output).toEqual(concatBytes(tag(version, frames, { padding }), audio));

      const { common, native } = await parse(output);
      expect(native[`ID3v2.${version}`].map((t) => t.id)).toEqual([
        'TIT2', 'GEOB', 'GEOB', 'POPM', 'UFID', 'TBPM', 'TKEY', 'TXXX:SERATO_PLAYCOUNT',
        'COMM', 'COMM', 'APIC', 'APIC', 'TIT1',
      ]);
      expect(common).toMatchObject({ grouping: 'House', bpm: 124, key: 'Am' });
      expect(common.picture).toHaveLength(2);
    }
  );

  it('keeps an unsynchronised ID3v2.4 tag, whose frames are unsynchronised one by one', async () => {
    // Per-frame unsynchronisation: the stored 0xFF 0x00 0xE0 reads back as 0xFF 0xE0
    const escaped = frame(4, 'GEOB', object('Serato Overview', [0xff, 0x00, 0xe0]), [0x00, 0x02]);
    const audio = silentMp3Frames();
    const input = concatBytes(tag(4, [escaped], { padding: 64, flags: 0x80 }), audio);

    const output = await write(input);

    const frames = [escaped, grouping(4, 'House')];
    expect(output).toEqual(
      concatBytes(tag(4, frames, { padding: 64 + sizeOf([escaped]) - sizeOf(frames), flags: 0x80 }), audio)
    );
    expect((await parse(output)).common.grouping).toBe('House');
  });

  it.each([2, 3, 4] as const)('ID3v2.%i: writes a non-ASCII value in an encoding the version supports', async (version) => {
    const output = await write(concatBytes(tag(version, [title(version)], { padding: 64 }), silentMp3Frames()), 'Électro');

    expect((await parse(output)).common.grouping).toBe('Électro');
  });

  describe('refuses a tag it cannot patch safely, instead of rewriting the file', () => {
    const header = (version: number, flags: number, size: number[]) => [0x49, 0x44, 0x33, version, 0x00, flags, ...size];
    const audio = silentMp3Frames();
    // A 301-byte body: its plain size bytes (00 00 01 2D) also read as a synchsafe 173
    const plainSizeTxxx = frame(3, 'TXXX', userText('LONG', 'x'.repeat(295)));

    it.each([
      ['an extended header', tag(3, [title(3)], { flags: 0x40 })],
      ['a compressed ID3v2.2 tag', tag(2, [title(2)], { flags: 0x40 })],
      ['a footer', tag(4, [title(4)], { flags: 0x10 })],
      ['an unsynchronised ID3v2.3 tag', tag(3, [title(3)], { flags: 0x80 })],
      ['unknown header flags', tag(3, [title(3)], { flags: 0x01 })],
      ['an unknown major version', concatBytes(header(5, 0, synchsafe(0)))],
      ['a tag size that is not synchsafe', concatBytes(header(3, 0, [0, 0, 0x80, 0]), new Uint8Array(200))],
      ['a tag longer than the file', concatBytes(header(3, 0, synchsafe(5000)), title(3))],
      ['a second ID3v2 tag right after the first', concatBytes(tag(3, [title(3)]), tag(3, [grouping(3, 'Old')]))],
      ['an invalid frame id', tag(3, [frame(3, 'tit2', text('lowercase'))])],
      ['a frame that runs past the end of the tag', tag(3, [title(3).subarray(0, 12)])],
      ['a frame header cut short by the end of the tag', tag(3, [title(3), Uint8Array.from([0x54, 0x49, 0x54])])],
      ['data where the padding should be', tag(3, [title(3), Uint8Array.from([0x00, 0x00, 0x07])])],
      // iTunes wrote some ID3v2.4 tags with plain frame sizes; read as synchsafe they land mid-frame
      ['ID3v2.4 frames with plain sizes', tag(4, [plainSizeTxxx, title(4)])],
    ])('%s', (_, tagBytes) => {
      const input = concatBytes(tagBytes, audio);

      expect(() => writeId3GroupingTag(input.slice().buffer, 'House')).toThrow(UNPATCHABLE_ID3_TAG_ERROR);
    });
  });
});
