import { describe, it, expect } from 'vitest';
import { writeFlacGroupingTag, _testExports } from '../flacTagWriter';

const { parseFlacBlocks, buildVorbisCommentBlock } = _testExports;

// ---------------------------------------------------------------------------
// Minimal FLAC buffer helpers
// ---------------------------------------------------------------------------

const BLOCK_TYPE_STREAMINFO = 0;
const BLOCK_TYPE_VORBIS_COMMENT = 4;

/**
 * Build a FLAC metadata block header (4 bytes).
 * @param isLast - whether this is the last metadata block
 * @param type - block type (0-126)
 * @param length - length of the block data in bytes
 */
function makeBlockHeader(isLast: boolean, type: number, length: number): Uint8Array {
  const header = new Uint8Array(4);
  header[0] = (isLast ? 0x80 : 0x00) | (type & 0x7f);
  header[1] = (length >> 16) & 0xff;
  header[2] = (length >> 8) & 0xff;
  header[3] = length & 0xff;
  return header;
}

/**
 * Minimal STREAMINFO block data (34 bytes).
 * Sample rate=44100, mono, 16-bit, unknown total samples, zero MD5.
 */
function makeStreaminfoData(): Uint8Array {
  const data = new Uint8Array(34);
  const view = new DataView(data.buffer);
  // min/max block size
  view.setUint16(0, 4096, false);
  view.setUint16(2, 4096, false);
  // min/max frame size (0 = unknown)
  // bytes 4-9 remain 0
  // Packed: SR(20) CH-1(3) BPS-1(5) TotalSamples(36)
  // SR=44100=0xAC44, CH=1→0, BPS=16→15
  // Byte 10: 0x0A, Byte 11: 0xC4, Byte 12: 0x40, Byte 13: 0xF0, bytes 14-17: 0
  data[10] = 0x0a;
  data[11] = 0xc4;
  data[12] = 0x40;
  data[13] = 0xf0;
  // MD5 (bytes 18-33) remain 0
  return data;
}

/**
 * Build a Vorbis Comment block with the given comments.
 * comments: array of "KEY=value" strings
 */
function makeVorbisCommentData(vendor: string, comments: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const vendorBytes = encoder.encode(vendor);
  const commentBytes = comments.map((c) => encoder.encode(c));

  const size =
    4 + vendorBytes.length + 4 + commentBytes.reduce((s, b) => s + 4 + b.length, 0);

  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  let pos = 0;

  view.setUint32(pos, vendorBytes.length, true);
  pos += 4;
  data.set(vendorBytes, pos);
  pos += vendorBytes.length;

  view.setUint32(pos, commentBytes.length, true);
  pos += 4;

  for (const cb of commentBytes) {
    view.setUint32(pos, cb.length, true);
    pos += 4;
    data.set(cb, pos);
    pos += cb.length;
  }

  return data;
}

/**
 * Build a minimal FLAC buffer: fLaC marker + STREAMINFO + optional extra blocks.
 * extraBlocks: [{type, data}] inserted after STREAMINFO; last block flag is set correctly.
 */
function buildMinimalFlac(
  extraBlocks: Array<{ type: number; data: Uint8Array }> = [],
  audioData: Uint8Array = new Uint8Array(0)
): ArrayBuffer {
  const fLaC = new Uint8Array([0x66, 0x4c, 0x61, 0x43]); // "fLaC"
  const streaminfoData = makeStreaminfoData();

  const allBlocks = [{ type: BLOCK_TYPE_STREAMINFO, data: streaminfoData }, ...extraBlocks];

  const parts: Uint8Array[] = [fLaC];
  for (let i = 0; i < allBlocks.length; i++) {
    const isLast = i === allBlocks.length - 1;
    parts.push(makeBlockHeader(isLast, allBlocks[i].type, allBlocks[i].data.length));
    parts.push(allBlocks[i].data);
  }
  parts.push(audioData);

  const totalSize = parts.reduce((s, p) => s + p.length, 0);
  const buffer = new Uint8Array(totalSize);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  return buffer.buffer;
}

/**
 * Read Vorbis Comments from a raw VORBIS_COMMENT block data.
 * Returns { vendor, comments: string[] }.
 */
function readVorbisComments(data: Uint8Array): { vendor: string; comments: string[] } {
  const decoder = new TextDecoder();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;

  const vendorLength = view.getUint32(pos, true);
  pos += 4;
  const vendor = decoder.decode(data.slice(pos, pos + vendorLength));
  pos += vendorLength;

  const count = view.getUint32(pos, true);
  pos += 4;

  const comments: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = view.getUint32(pos, true);
    pos += 4;
    comments.push(decoder.decode(data.slice(pos, pos + len)));
    pos += len;
  }

  return { vendor, comments };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('flacTagWriter', () => {
  describe('writeFlacGroupingTag', () => {
    it('writes GROUPING tag to a FLAC with no existing VORBIS_COMMENT block', async () => {
      const buffer = buildMinimalFlac(); // STREAMINFO only
      const blob = writeFlacGroupingTag(buffer, 'Electronic');

      const outBuffer = await blob.arrayBuffer();
      const { blocks } = parseFlacBlocks(outBuffer);

      const vcBlock = blocks.find((b) => b.type === BLOCK_TYPE_VORBIS_COMMENT);
      expect(vcBlock).toBeDefined();

      const { comments } = readVorbisComments(vcBlock!.data);
      expect(comments).toContain('GROUPING=Electronic');
    });

    it('updates existing GROUPING when VORBIS_COMMENT block already exists', async () => {
      const vcData = makeVorbisCommentData('test-encoder', [
        'TITLE=Some Track',
        'ARTIST=Some Artist',
        'GROUPING=OldGenre',
      ]);
      const buffer = buildMinimalFlac([{ type: BLOCK_TYPE_VORBIS_COMMENT, data: vcData }]);

      const blob = writeFlacGroupingTag(buffer, 'House');

      const outBuffer = await blob.arrayBuffer();
      const { blocks } = parseFlacBlocks(outBuffer);

      const vcBlock = blocks.find((b) => b.type === BLOCK_TYPE_VORBIS_COMMENT);
      const { comments } = readVorbisComments(vcBlock!.data);

      // New GROUPING value
      expect(comments).toContain('GROUPING=House');
      // Old GROUPING removed
      expect(comments).not.toContain('GROUPING=OldGenre');
    });

    it('preserves non-GROUPING Vorbis comments', async () => {
      const vcData = makeVorbisCommentData('test-encoder', [
        'TITLE=Some Track',
        'ARTIST=Some Artist',
        'ALBUM=Some Album',
      ]);
      const buffer = buildMinimalFlac([{ type: BLOCK_TYPE_VORBIS_COMMENT, data: vcData }]);

      const blob = writeFlacGroupingTag(buffer, 'Drum & Bass');

      const outBuffer = await blob.arrayBuffer();
      const { blocks } = parseFlacBlocks(outBuffer);

      const vcBlock = blocks.find((b) => b.type === BLOCK_TYPE_VORBIS_COMMENT);
      const { comments } = readVorbisComments(vcBlock!.data);

      expect(comments).toContain('TITLE=Some Track');
      expect(comments).toContain('ARTIST=Some Artist');
      expect(comments).toContain('ALBUM=Some Album');
      expect(comments).toContain('GROUPING=Drum & Bass');
    });

    it('preserves STREAMINFO block unchanged', async () => {
      const buffer = buildMinimalFlac();
      const blob = writeFlacGroupingTag(buffer, 'Techno');

      const outBuffer = await blob.arrayBuffer();
      const { blocks } = parseFlacBlocks(outBuffer);

      const siBlock = blocks.find((b) => b.type === BLOCK_TYPE_STREAMINFO);
      expect(siBlock).toBeDefined();
      expect(siBlock!.data).toEqual(makeStreaminfoData());
    });

    it('preserves audio data after metadata blocks', async () => {
      const fakeAudio = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const buffer = buildMinimalFlac([], fakeAudio);
      const blob = writeFlacGroupingTag(buffer, 'Jungle');

      const outBuffer = await blob.arrayBuffer();
      const outBytes = new Uint8Array(outBuffer);

      // Audio data should be at the end
      const tail = outBytes.slice(outBytes.length - fakeAudio.length);
      expect(tail).toEqual(fakeAudio);
    });

    it('returns a Blob with audio/flac mime type', () => {
      const buffer = buildMinimalFlac();
      const blob = writeFlacGroupingTag(buffer, 'Ambient');
      expect(blob.type).toBe('audio/flac');
    });

    it('throws on non-FLAC input', () => {
      const notFlac = new Uint8Array([0x49, 0x44, 0x33, 0x00]).buffer; // "ID3\0"
      expect(() => writeFlacGroupingTag(notFlac, 'Techno')).toThrow(
        'Not a valid FLAC file'
      );
    });
  });

  describe('buildVorbisCommentBlock', () => {
    it('creates a block with only GROUPING when no existing data', () => {
      const block = buildVorbisCommentBlock(null, 'Jazz');
      const { comments } = readVorbisComments(block);
      expect(comments).toEqual(['GROUPING=Jazz']);
    });

    it('handles GROUPING key case-insensitively when stripping old entry', () => {
      const vcData = makeVorbisCommentData('enc', ['grouping=OldValue', 'TITLE=Track']);
      const block = buildVorbisCommentBlock(vcData, 'NewValue');
      const { comments } = readVorbisComments(block);
      expect(comments).toContain('GROUPING=NewValue');
      expect(comments).not.toContain('grouping=OldValue');
      expect(comments).toContain('TITLE=Track');
    });
  });
});
