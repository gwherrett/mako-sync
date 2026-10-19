/**
 * Helpers that keep music-metadata 12 results behaving the way this app was built around
 * (music-metadata 7, via music-metadata-browser). Each one names the difference it covers.
 */
import type { ICommonTagsResult } from 'music-metadata';

/** A single comment as reported by music-metadata (`IComment` is not exported from the package). */
export type AudioComment = NonNullable<ICommonTagsResult['comment']>[number];

/**
 * ID3v2.2 and ID3v2.3 cannot hold several genres in one frame, so taggers write them as
 * "Hip Hop/Rap". music-metadata 7 split those values on "/"; 12 keeps the string intact
 * (so a single genre like "Duo Cello/Piano" survives). Genre mapping and the scanner were
 * built around the split values, so split them here.
 *
 * Only ID3v2.2/2.3 values are split. ID3v2.4, Vorbis and MP4 genres are returned as-is,
 * which is what both versions did. Empty values are dropped either way.
 *
 * @param genres - genre values as reported by music-metadata
 * @param tagTypes - `metadata.format.tagTypes` (or the native tag type the values came from)
 */
export function splitLegacyId3Genres(
  genres: readonly string[] | undefined,
  tagTypes: readonly string[] | undefined
): string[] {
  if (!genres || genres.length === 0) return [];

  const isLegacyId3 = tagTypes?.some((type) => type === 'ID3v2.2' || type === 'ID3v2.3') ?? false;
  if (!isLegacyId3) return genres.filter(Boolean);

  return genres
    .flatMap((genre) => genre.split('/'))
    .map((genre) => genre.trim())
    .filter(Boolean);
}
