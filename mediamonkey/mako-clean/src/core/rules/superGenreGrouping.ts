import { mapToSuperGenre } from '@/utils/superGenreMapping';
import type { Rule } from '../types';

/**
 * Split MediaMonkey's Genre field into separate genres. MediaMonkey keeps several
 * genres in one string joined by its multi-value separator ("; " by default) and
 * writes them to the file as separate values (docs/reference/mediamonkey-5.md, check 2).
 */
export function splitGenres(genre: string, separator: string): string[] {
  const sep = separator.trim() || ';';
  return genre
    .split(sep)
    .map((g) => g.trim())
    .filter(Boolean);
}

/**
 * Set Grouping to the SuperGenre, with the same result Mako's Step 5 gives:
 * the same mapToSuperGenre, the same map order, and no change when Grouping
 * already equals the SuperGenre (Step 5 compares the same way).
 */
export const superGenreGrouping: Rule = {
  id: 'superGenreGrouping',
  run(fields, ctx) {
    const genres = splitGenres(fields.genre, ctx.genreSeparator);
    if (genres.length === 0) {
      return { skipReason: 'No genre, so no SuperGenre' };
    }

    const superGenre = mapToSuperGenre(genres, ctx.genreMap);
    if (superGenre === null) {
      return { skipReason: `No SuperGenre for genres: ${genres.join('; ')}` };
    }

    if (fields.grouping === superGenre) return {};

    return {
      changes: [{
        field: 'grouping',
        value: superGenre,
        overwrite: fields.grouping.trim() !== '',
      }],
    };
  },
};
