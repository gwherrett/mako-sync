/**
 * Genre -> SuperGenre mapping shared by Mako's Step 5 (Process Downloads) and the
 * Mako Clean MediaMonkey add-on (mediamonkey/mako-clean), which bundles this file.
 *
 * Keep it free of imports: the add-on build pulls it in as-is, outside the app.
 *
 * The partial match returns the first entry in map order, so both callers must
 * build the map in the same order: Mako loads it ordered by spotify_genre, and
 * the add-on reads the JSON export, which keeps that order.
 */

/** A genre key as the map stores it: lowercased and trimmed. */
export function normalizeGenreKey(genre: string): string {
  return genre.toLowerCase().trim();
}

/**
 * Map genre(s) to a SuperGenre.
 *
 * For each genre in order:
 * 1. Exact match (case-insensitive)
 * 2. Partial match - the genre contains a mapped key or vice versa
 *
 * Returns the first successful match, or null if no mapping found.
 */
export function mapToSuperGenre(
  genres: string[],
  genreMap: Map<string, string>
): string | null {
  for (const genre of genres) {
    const normalizedGenre = normalizeGenreKey(genre);
    if (!normalizedGenre) continue;

    // Try exact match first
    if (genreMap.has(normalizedGenre)) {
      return genreMap.get(normalizedGenre)!;
    }

    // Try partial matching - check if any mapped genre is contained in this genre
    for (const [mappedGenre, superGenre] of genreMap.entries()) {
      if (
        normalizedGenre.includes(mappedGenre) ||
        mappedGenre.includes(normalizedGenre)
      ) {
        return superGenre;
      }
    }
  }

  return null;
}
