/**
 * Builds raw ID3v2.2, 2.3 and 2.4 tags for tests, byte by byte, so the tests control exactly
 * what is in the file and can compare the writer's output against the bytes they expect.
 * Text is ISO-8859-1.
 */

export type Id3Version = 2 | 3 | 4;

const latin1 = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

export const synchsafe = (value: number): number[] => [
  (value >> 21) & 0x7f,
  (value >> 14) & 0x7f,
  (value >> 7) & 0x7f,
  value & 0x7f,
];

export function concatBytes(...chunks: ArrayLike<number>[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** A frame with the header layout of the given version. */
export function frame(
  version: Id3Version,
  id: string,
  body: ArrayLike<number>,
  flags: [number, number] = [0, 0]
): Uint8Array {
  const size = body.length;
  if (version === 2) {
    return concatBytes(latin1(id), [(size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff], body);
  }
  const sizeBytes =
    version === 4
      ? synchsafe(size)
      : [(size >>> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff];
  return concatBytes(latin1(id), sizeBytes, flags, body);
}

/** A whole tag: header, frames, then `padding` zero bytes. */
export function tag(
  version: Id3Version,
  frames: Uint8Array[],
  { padding = 0, flags = 0 }: { padding?: number; flags?: number } = {}
): Uint8Array {
  const body = concatBytes(...frames);
  return concatBytes(
    [0x49, 0x44, 0x33, version, 0x00, flags, ...synchsafe(body.length + padding)],
    body,
    new Uint8Array(padding)
  );
}

// Frame bodies

export const text = (value: string): number[] => [0x00, ...latin1(value)];

export const comment = (descriptor: string, value: string): number[] => [
  0x00,
  ...latin1('eng'),
  ...latin1(descriptor),
  0x00,
  ...latin1(value),
];

export const userText = (description: string, value: string): number[] => [
  0x00,
  ...latin1(description),
  0x00,
  ...latin1(value),
];

/** APIC (PIC in ID3v2.2, which names the image format with three letters instead of a MIME type). */
export const picture = (version: Id3Version, data: ArrayLike<number>, description: string): number[] => [
  0x00,
  ...(version === 2 ? latin1('PNG') : [...latin1('image/png'), 0x00]),
  0x03, // front cover
  ...latin1(description),
  0x00,
  ...Array.from(data),
];

/** GEOB, the frame Serato keeps its analysis, cues, loops and beatgrid in. */
export const object = (description: string, data: ArrayLike<number>): number[] => [
  0x00,
  ...latin1('application/octet-stream'),
  0x00,
  0x00, // empty filename
  ...latin1(description),
  0x00,
  ...Array.from(data),
];

export const popularimeter = (email: string, rating: number, playCount: number): number[] => [
  ...latin1(email),
  0x00,
  rating,
  0x00,
  0x00,
  0x00,
  playCount,
];

export const uniqueFileId = (owner: string, id: string): number[] => [...latin1(owner), 0x00, ...latin1(id)];

/** A 1x1 PNG. */
export const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0)
);

/** Eight silent MPEG-1 Layer III frames (128 kbps, 44.1 kHz): enough for a parser to read the format. */
export const silentMp3Frames = (): Uint8Array => {
  const FRAME_LENGTH = 417;
  const frames = new Uint8Array(FRAME_LENGTH * 8);
  for (let i = 0; i < 8; i++) frames.set([0xff, 0xfb, 0x90, 0x00], i * FRAME_LENGTH);
  return frames;
};

/** A 128-byte ID3v1 tag. */
export const id3v1 = (title: string): Uint8Array => {
  const v1 = new Uint8Array(128);
  v1.set(latin1('TAG'));
  v1.set(latin1(title), 3);
  v1[127] = 0xff; // genre: none
  return v1;
};
