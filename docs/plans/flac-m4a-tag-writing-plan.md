# FLAC & M4A Tag Writing Implementation Plan

## Status

**Read/scan support:** Implemented (MP3, FLAC, M4A files are now scanned, metadata extracted, and genre-mapped).

**Tag writing support:** MP3 only. FLAC and M4A tag writing is not yet implemented.

## Current State

The download processor writes the SuperGenre value to the **Grouping (TIT1)** ID3 tag on MP3 files using `browser-id3-writer`. This library only supports ID3 tags (MP3 format). FLAC and M4A use different tag systems:

| Format | Tag System | Grouping Equivalent |
|--------|-----------|-------------------|
| MP3 | ID3v2 (TIT1 frame) | `TIT1` - Grouping |
| FLAC | Vorbis Comments | `GROUPING` field |
| M4A | iTunes/MP4 atoms | `\u00A9grp` atom (Grouping) |

## Implementation Plan

### 1. Detect file format before writing

In `writeTagsInPlace()` ([downloadProcessor.service.ts:594](../../src/services/downloadProcessor.service.ts#L594)), detect the file extension to route to the correct tag writer:

```typescript
function getFileFormat(filename: string): 'mp3' | 'flac' | 'm4a' | 'unknown' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.mp3')) return 'mp3';
  if (lower.endsWith('.flac')) return 'flac';
  if (lower.endsWith('.m4a')) return 'm4a';
  return 'unknown';
}
```

### 2. FLAC tag writing

**Library option: `flac-metadata` or raw Vorbis Comment manipulation**

FLAC files store metadata in Vorbis Comment blocks. The approach:

1. Read the FLAC file as an ArrayBuffer
2. Parse the FLAC metadata blocks (STREAMINFO, VORBIS_COMMENT, etc.)
3. Find or create the VORBIS_COMMENT block
4. Add/update the `GROUPING=<SuperGenre>` field
5. Rebuild the file with updated metadata blocks
6. Write back via File System Access API

**Key considerations:**
- FLAC metadata blocks are at the start of the file, so rewriting doesn't require re-encoding audio
- Vorbis Comments are UTF-8 key=value pairs, simpler than ID3
- The `GROUPING` field is recognized by Serato, Rekordbox, Traktor, and MediaMonkey
- No well-maintained browser-compatible FLAC tag writer exists as an npm package; may need a lightweight custom implementation or a WASM-compiled solution

**Potential libraries:**
- `flac-metadata` (Node.js, would need browser adaptation)
- Custom minimal Vorbis Comment writer (FLAC spec is straightforward for metadata-only edits)
- `music-metadata-browser` can read but not write

### 3. M4A tag writing

**Library option: `mp4box.js` or custom MP4 atom manipulation**

M4A files use the MP4 container format with iTunes-style metadata atoms. The approach:

1. Read the M4A file as an ArrayBuffer
2. Parse the MP4 box/atom structure to find the `moov > udta > meta > ilst` path
3. Find or create the `\u00A9grp` (Grouping) atom
4. Write the SuperGenre value as a UTF-8 data atom
5. Rebuild affected boxes (updating sizes up the chain)
6. Write back via File System Access API

**Key considerations:**
- MP4 atom structure requires careful size recalculation when modifying
- The `\u00A9grp` atom is the standard iTunes Grouping field
- Recognized by iTunes, Serato, Rekordbox, Traktor, and MediaMonkey
- `mp4box.js` focuses on streaming/segmenting, not metadata editing

**Potential libraries:**
- Custom minimal MP4 metadata writer
- Adapt Node.js libraries like `mp4-metadata` for browser use
- Consider a WASM-compiled solution (e.g., FFmpeg compiled to WASM, though heavy)

### 4. Unified write interface

Refactor `writeSuperGenreTag()` to dispatch based on format:

```typescript
async function writeSuperGenreTag(file: File, superGenre: string): Promise<Blob> {
  const format = getFileFormat(file.name);

  switch (format) {
    case 'mp3':
      return writeMp3SuperGenreTag(file, superGenre);  // existing ID3 logic
    case 'flac':
      return writeFlacSuperGenreTag(file, superGenre); // new
    case 'm4a':
      return writeM4aSuperGenreTag(file, superGenre);  // new
    default:
      throw new Error(`Tag writing not supported for format: ${format}`);
  }
}
```

### 5. Existing grouping tag check

Update `getExistingGroupingTag()` similarly:

- **FLAC:** Read the `GROUPING` field from Vorbis Comments (already handled by `music-metadata-browser` via `metadata.common.grouping` or native Vorbis tags)
- **M4A:** Read the `\u00A9grp` atom (already handled by `music-metadata-browser`)

The existing `parseBlob()` call can already read grouping from all formats. Just check `metadata.common.grouping` as an alternative to the ID3-specific TIT1 check.

### 6. Skip-if-unchanged logic

The current skip logic in `writeTagsInPlace()` checks ID3v2 TIT1 frames directly. Update to use `metadata.common` which works across formats:

```typescript
// Format-agnostic grouping check
const metadata = await parseBlob(file, { skipCovers: true });
const existingGrouping = metadata.common.grouping;
if (existingGrouping === targetSuperGenre) {
  // Skip - already correct
}
```

### 7. Testing strategy

- Unit tests for each format's tag writer with minimal valid file buffers
- Integration test confirming round-trip: write tag, re-read with `parseBlob()`, verify grouping value
- Test that non-grouping metadata is preserved after writing (artist, title, album, genre, cover art)

## Recommended Implementation Order

1. **Refactor existing code:** Extract MP3-specific write into `writeMp3SuperGenreTag()`, update grouping check to use `metadata.common.grouping`
2. **FLAC writing:** Implement Vorbis Comment writer (simpler format, well-documented spec)
3. **M4A writing:** Implement MP4 atom writer (more complex due to box size recalculation)
4. **Graceful fallback:** For unsupported formats, log a warning and skip tag writing (scanning/genre mapping still works)

## Risk Assessment

- **FLAC:** Low risk. Vorbis Comments are simple key-value pairs prepended to the audio data. Well-documented spec.
- **M4A:** Medium risk. MP4 container editing requires careful box/atom size management. Incorrect sizes corrupt the file.
- **Mitigation:** Always write to a new Blob first (current pattern), only write back to disk via File System Access API after verification. The original file is only overwritten at the final `writable.write()` step.
