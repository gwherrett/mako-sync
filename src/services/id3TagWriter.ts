/**
 * ID3v2 Grouping Tag Writer
 *
 * Writes the SuperGenre to the Grouping frame (TIT1, or TT1 in ID3v2.2) of an MP3 in the browser
 * and changes nothing else. The tag is patched, not rebuilt: old Grouping frames are dropped, a
 * new one is appended after the remaining frames, and the padding absorbs the difference (the tag
 * only grows when the frames no longer fit). Every other frame (Serato GEOB data, POPM, UFID,
 * TBPM, TKEY, TXXX, described COMM, APIC, frames nobody has heard of) keeps its exact bytes, and
 * so does the audio data. Handles ID3v2.2, 2.3 and 2.4.
 *
 * A tag that can't be patched without risk (extended header, footer, unsynchronisation in
 * ID3v2.2/2.3, unknown flags, frames that don't parse cleanly) throws an error starting with
 * UNPATCHABLE_ID3_TAG_ERROR, so the caller can leave the file untouched and report it.
 *
 * Counterpart of flacTagWriter.ts: accepts an ArrayBuffer, returns a new Blob.
 */

export const UNPATCHABLE_ID3_TAG_ERROR = "Can't change this MP3's ID3 tag safely";

const HEADER_SIZE = 10;
// Room left after the frames when a tag has to grow (or is new), so later writes fit in place
const PADDING = 1024;
// Version for files that have no ID3v2 tag yet: read by every DJ tool and media player
const NEW_TAG_VERSION = 3;

// Header flags each version defines: unsynchronisation and compression (2.2) or extended
// header (2.3, 2.4), then experimental (2.3, 2.4) and footer (2.4)
const KNOWN_FLAGS: Record<number, number> = { 2: 0xc0, 3: 0xe0, 4: 0xf0 };
const FLAG_UNSYNCHRONISATION = 0x80;
const FLAG_EXTENDED_HEADER = 0x40; // compression in ID3v2.2
const FLAG_FOOTER = 0x10;

const unpatchable = (reason: string): Error => new Error(`${UNPATCHABLE_ID3_TAG_ERROR}: ${reason}`);

const ascii = (bytes: Uint8Array): string => String.fromCharCode(...bytes);
const asciiBytes = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

const uint24 = (value: number): number[] => [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
const uint32 = (value: number): number[] => [(value >>> 24) & 0xff, ...uint24(value)];
const synchsafe = (value: number): number[] => [
  (value >> 21) & 0x7f,
  (value >> 14) & 0x7f,
  (value >> 7) & 0x7f,
  value & 0x7f,
];

function readSynchsafe(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (const byte of bytes.subarray(offset, offset + 4)) {
    if (byte & 0x80) throw unpatchable('a size field is not synchsafe');
    value = (value << 7) | byte;
  }
  return value;
}

/**
 * Text frame payload. ASCII (every SuperGenre is) is written as ISO-8859-1, which every version
 * reads and which never needs unsynchronisation escapes. Anything else is UTF-8 in ID3v2.4 (it
 * never contains 0xFF either) and UTF-16 with a byte order mark in 2.2 and 2.3.
 */
function encodeText(text: string, version: number): number[] {
  if (/^[\x20-\x7e]*$/.test(text)) return [0x00, ...asciiBytes(text)];
  if (version === 4) return [0x03, ...new TextEncoder().encode(text)];

  const utf16 = [0xff, 0xfe];
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    utf16.push(unit & 0xff, unit >> 8);
  }
  return [0x01, ...utf16];
}

function buildGroupingFrame(text: string, version: number): Uint8Array {
  const payload = encodeText(text, version);
  if (version === 2) {
    return Uint8Array.from([...asciiBytes('TT1'), ...uint24(payload.length), ...payload]);
  }
  const size = version === 4 ? synchsafe(payload.length) : uint32(payload.length);
  return Uint8Array.from([...asciiBytes('TIT1'), ...size, 0x00, 0x00, ...payload]);
}

/**
 * Split the frames of a tag (from the end of the header up to `tagEnd`) into the exact bytes each
 * frame has in the file. Frames must tile the space up to the padding, and the padding must be
 * all zero bytes: a misread frame size usually lands inside another frame, and treating that
 * frame's bytes as padding would delete it.
 */
function readFrames(bytes: Uint8Array, tagEnd: number, version: number): Uint8Array[] {
  const idLength = version === 2 ? 3 : 4;
  const headerLength = version === 2 ? 6 : 10;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames: Uint8Array[] = [];
  let pos = HEADER_SIZE;

  while (pos < tagEnd && bytes[pos] !== 0) {
    if (pos + headerLength > tagEnd) throw unpatchable(`truncated frame header at byte ${pos}`);

    const id = ascii(bytes.subarray(pos, pos + idLength));
    if (!/^[A-Z0-9]+$/.test(id)) throw unpatchable(`invalid frame id at byte ${pos}`);

    const size =
      version === 2
        ? (bytes[pos + 3] << 16) | (bytes[pos + 4] << 8) | bytes[pos + 5]
        : version === 4
          ? readSynchsafe(bytes, pos + 4)
          : view.getUint32(pos + 4);
    const frameEnd = pos + headerLength + size;
    if (frameEnd > tagEnd) throw unpatchable(`frame ${id} runs past the end of the tag`);

    frames.push(bytes.subarray(pos, frameEnd));
    pos = frameEnd;
  }

  if (bytes.subarray(pos, tagEnd).some((byte) => byte !== 0)) {
    throw unpatchable(`unexpected data after the last frame, at byte ${pos}`);
  }
  return frames;
}

/**
 * Write the SuperGenre to the Grouping frame of an MP3.
 *
 * Existing Grouping frames are replaced; every other frame and the audio data are unchanged. A
 * file without an ID3v2 tag gets a new ID3v2.3 tag in front, and a trailing ID3v1 tag is left
 * alone.
 *
 * @param buffer - ArrayBuffer of the original MP3 file
 * @param superGenre - The SuperGenre value to write to Grouping
 * @returns A new Blob containing the updated MP3 data
 * @throws Error starting with UNPATCHABLE_ID3_TAG_ERROR if the tag can't be patched safely
 */
export function writeId3GroupingTag(buffer: ArrayBuffer, superGenre: string): Blob {
  const bytes = new Uint8Array(buffer);

  if (bytes.length < HEADER_SIZE || ascii(bytes.subarray(0, 3)) !== 'ID3') {
    const frame = buildGroupingFrame(superGenre, NEW_TAG_VERSION);
    const header = Uint8Array.from([
      ...asciiBytes('ID3'),
      NEW_TAG_VERSION,
      0x00, // revision
      0x00, // flags
      ...synchsafe(frame.length + PADDING),
    ]);
    return new Blob([header, frame, new Uint8Array(PADDING), bytes], { type: 'audio/mpeg' });
  }

  const [version, revision, flags] = bytes.subarray(3, 6);
  if (!(version in KNOWN_FLAGS) || revision === 0xff) {
    throw unpatchable(`unsupported version ID3v2.${version}.${revision}`);
  }
  if (flags & ~KNOWN_FLAGS[version]) throw unpatchable('unknown header flags');
  if (flags & FLAG_EXTENDED_HEADER) throw unpatchable(version === 2 ? 'compressed tag' : 'extended header');
  if (flags & FLAG_FOOTER) throw unpatchable('tag footer');
  // ID3v2.2/2.3 unsynchronise the whole tag, frame headers included. ID3v2.4 does it inside each
  // frame, and frame sizes count the stored bytes, so those frames can be copied as they are.
  if (flags & FLAG_UNSYNCHRONISATION && version < 4) throw unpatchable('unsynchronised tag');

  const tagSize = readSynchsafe(bytes, 6);
  const tagEnd = HEADER_SIZE + tagSize;
  if (tagEnd > bytes.length) throw unpatchable('the tag is longer than the file');
  // Readers merge consecutive tags, so a Grouping frame in the second one would still be read
  if (ascii(bytes.subarray(tagEnd, tagEnd + 3)) === 'ID3') throw unpatchable('a second ID3v2 tag follows the first');

  const groupingId = version === 2 ? 'TT1' : 'TIT1';
  const frames = readFrames(bytes, tagEnd, version).filter(
    (frame) => ascii(frame.subarray(0, groupingId.length)) !== groupingId
  );
  // The new frame goes last: music-metadata reports the last grouping frame it reads, so the
  // scanner sees this value even when the file also has an iTunes GRP1 frame.
  frames.push(buildGroupingFrame(superGenre, version));

  const framesSize = frames.reduce((total, frame) => total + frame.length, 0);
  const newTagSize = framesSize <= tagSize ? tagSize : framesSize + PADDING;
  const header = Uint8Array.from([...bytes.subarray(0, 6), ...synchsafe(newTagSize)]);

  return new Blob(
    [header, ...frames, new Uint8Array(newTagSize - framesSize), bytes.subarray(tagEnd)],
    { type: 'audio/mpeg' }
  );
}
