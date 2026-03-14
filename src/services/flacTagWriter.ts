/**
 * FLAC Vorbis Comment Tag Writer
 *
 * Writes a GROUPING Vorbis Comment tag to a FLAC file in the browser without
 * any native dependencies. Follows the FLAC format spec and Vorbis Comment spec
 * (key=value pairs, UTF-8, little-endian lengths).
 *
 * Mirrors the write-back pattern of the MP3 path in downloadProcessor.service.ts:
 * accepts an ArrayBuffer, returns a new Blob with updated tags.
 */

const FLAC_MARKER = 'fLaC';
const BLOCK_TYPE_STREAMINFO = 0;
const BLOCK_TYPE_VORBIS_COMMENT = 4;
const VENDOR_STRING = 'mako-sync';

interface FlacMetadataBlock {
  type: number;
  data: Uint8Array;
}

/**
 * Parse FLAC metadata blocks from an ArrayBuffer.
 * Returns the parsed blocks and the byte offset where audio frames begin.
 */
function parseFlacBlocks(buffer: ArrayBuffer): {
  blocks: FlacMetadataBlock[];
  audioDataOffset: number;
} {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Verify fLaC marker
  const marker = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (marker !== FLAC_MARKER) {
    throw new Error('Not a valid FLAC file: missing fLaC marker');
  }

  const blocks: FlacMetadataBlock[] = [];
  let offset = 4; // Skip fLaC marker

  while (offset < buffer.byteLength) {
    const headerByte = view.getUint8(offset);
    const isLast = (headerByte & 0x80) !== 0;
    const blockType = headerByte & 0x7f;
    const blockLength =
      (view.getUint8(offset + 1) << 16) |
      (view.getUint8(offset + 2) << 8) |
      view.getUint8(offset + 3);

    offset += 4;

    // Copy block data to avoid holding a reference to the original buffer
    const data = new Uint8Array(buffer, offset, blockLength);
    blocks.push({ type: blockType, data: new Uint8Array(data) });

    offset += blockLength;

    if (isLast) break;
  }

  return { blocks, audioDataOffset: offset };
}

/**
 * Build a Vorbis Comment block with GROUPING set to the given value.
 * Existing comments are preserved; any existing GROUPING entry is replaced.
 */
function buildVorbisCommentBlock(
  existingData: Uint8Array | null,
  groupingValue: string
): Uint8Array {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let vendorString = VENDOR_STRING;
  const comments: string[] = [];

  if (existingData && existingData.length > 0) {
    const view = new DataView(
      existingData.buffer,
      existingData.byteOffset,
      existingData.byteLength
    );
    let pos = 0;

    // Vendor string (little-endian uint32 length + UTF-8 bytes)
    const vendorLength = view.getUint32(pos, true);
    pos += 4;
    vendorString = decoder.decode(existingData.slice(pos, pos + vendorLength));
    pos += vendorLength;

    // User comment list
    const commentCount = view.getUint32(pos, true);
    pos += 4;

    for (let i = 0; i < commentCount; i++) {
      const commentLength = view.getUint32(pos, true);
      pos += 4;
      const comment = decoder.decode(existingData.slice(pos, pos + commentLength));
      pos += commentLength;

      // Skip existing GROUPING entries — we'll write the new value below
      if (!comment.toUpperCase().startsWith('GROUPING=')) {
        comments.push(comment);
      }
    }
  }

  // Append new GROUPING entry
  comments.push(`GROUPING=${groupingValue}`);

  const vendorBytes = encoder.encode(vendorString);
  const commentByteArrays = comments.map((c) => encoder.encode(c));

  const totalSize =
    4 + vendorBytes.length + // vendor string
    4 + // comment count
    commentByteArrays.reduce((sum, b) => sum + 4 + b.length, 0); // comments

  const block = new Uint8Array(totalSize);
  const view = new DataView(block.buffer);
  let pos = 0;

  // Vendor string
  view.setUint32(pos, vendorBytes.length, true);
  pos += 4;
  block.set(vendorBytes, pos);
  pos += vendorBytes.length;

  // Comment count
  view.setUint32(pos, commentByteArrays.length, true);
  pos += 4;

  // Comments
  for (const commentBytes of commentByteArrays) {
    view.setUint32(pos, commentBytes.length, true);
    pos += 4;
    block.set(commentBytes, pos);
    pos += commentBytes.length;
  }

  return block;
}

/**
 * Reassemble a FLAC file from metadata blocks and audio data.
 * Sets the last-metadata-block flag on the final block.
 */
function reassembleFlac(
  blocks: FlacMetadataBlock[],
  audioData: Uint8Array
): ArrayBuffer {
  const blocksSize = blocks.reduce((sum, b) => sum + 4 + b.data.length, 0);
  const totalSize = 4 + blocksSize + audioData.length;

  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  let pos = 0;

  // fLaC marker
  output.set(new TextEncoder().encode(FLAC_MARKER), pos);
  pos += 4;

  // Metadata blocks
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const isLast = i === blocks.length - 1;

    // Header byte: bit 7 = last-metadata-block flag, bits 6-0 = block type
    view.setUint8(pos, (isLast ? 0x80 : 0x00) | (block.type & 0x7f));
    // 24-bit big-endian block length
    view.setUint8(pos + 1, (block.data.length >> 16) & 0xff);
    view.setUint8(pos + 2, (block.data.length >> 8) & 0xff);
    view.setUint8(pos + 3, block.data.length & 0xff);
    pos += 4;

    output.set(block.data, pos);
    pos += block.data.length;
  }

  // Audio frames
  output.set(audioData, pos);

  return output.buffer;
}

/**
 * Write a GROUPING Vorbis Comment tag to a FLAC file.
 *
 * If a VORBIS_COMMENT block already exists, it is updated in place.
 * If none exists, a new one is inserted after STREAMINFO.
 * All other metadata blocks and audio frames are preserved unchanged.
 *
 * @param buffer - ArrayBuffer of the original FLAC file
 * @param superGenre - The SuperGenre value to write to GROUPING
 * @returns A new Blob containing the updated FLAC data
 */
export function writeFlacGroupingTag(buffer: ArrayBuffer, superGenre: string): Blob {
  const { blocks, audioDataOffset } = parseFlacBlocks(buffer);
  const audioData = new Uint8Array(buffer, audioDataOffset);

  const vcIndex = blocks.findIndex((b) => b.type === BLOCK_TYPE_VORBIS_COMMENT);

  if (vcIndex !== -1) {
    // Update existing VORBIS_COMMENT block
    blocks[vcIndex] = {
      type: BLOCK_TYPE_VORBIS_COMMENT,
      data: buildVorbisCommentBlock(blocks[vcIndex].data, superGenre),
    };
  } else {
    // Insert new VORBIS_COMMENT block after STREAMINFO
    const newBlock: FlacMetadataBlock = {
      type: BLOCK_TYPE_VORBIS_COMMENT,
      data: buildVorbisCommentBlock(null, superGenre),
    };
    const siIndex = blocks.findIndex((b) => b.type === BLOCK_TYPE_STREAMINFO);
    blocks.splice(siIndex !== -1 ? siIndex + 1 : 0, 0, newBlock);
  }

  return new Blob([reassembleFlac(blocks, audioData)], { type: 'audio/flac' });
}

// Export internals for testing
export const _testExports = {
  parseFlacBlocks,
  buildVorbisCommentBlock,
  reassembleFlac,
};
