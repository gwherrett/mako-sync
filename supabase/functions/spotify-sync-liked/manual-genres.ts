// Keeps manual SuperGenre overrides through a sync (NFR-9).
// processSongsData sets the auto-mapped super_genre on every row, and the upsert on
// (user_id, spotify_id) would overwrite a manual override without this lookup.

// Keeps each .in() filter well under the PostgREST URL length limit (Spotify ids are 22 chars)
const LOOKUP_BATCH_SIZE = 100

type OverrideRow = { spotify_id: string; super_genre: string | null }
type QueryResult = { data: OverrideRow[] | null; error: { message: string } | null }

// The slice of the Supabase query builder this module uses, so it can be stubbed in tests
interface OverrideQuery extends PromiseLike<QueryResult> {
  eq(column: string, value: unknown): OverrideQuery
  in(column: string, values: string[]): OverrideQuery
}
interface SupabaseLike {
  from(table: 'spotify_liked'): { select(columns: string): OverrideQuery }
}

/**
 * Loads the current manual overrides for the given tracks: spotify_id -> super_genre.
 * Reads the live rows, so an edit made between a pause and a resume is kept.
 * Throws on a query error rather than risk overwriting overrides with auto-mapped genres.
 */
export async function loadManualGenreMap(
  client: SupabaseLike,
  userId: string,
  spotifyIds: string[],
): Promise<Map<string, string>> {
  const manualGenreMap = new Map<string, string>()

  for (let i = 0; i < spotifyIds.length; i += LOOKUP_BATCH_SIZE) {
    const batch = spotifyIds.slice(i, i + LOOKUP_BATCH_SIZE)
    const { data, error } = await client
      .from('spotify_liked')
      .select('spotify_id, super_genre')
      .eq('user_id', userId)
      .in('spotify_id', batch)
      .eq('super_genre_manual_override', true)

    if (error) {
      throw new Error(`Failed to load manual genre overrides: ${error.message}`)
    }

    for (const track of data ?? []) {
      if (track.super_genre) {
        manualGenreMap.set(track.spotify_id, track.super_genre)
      }
    }
  }

  return manualGenreMap
}

/** Replaces the auto-mapped super_genre with the manual one for every overridden track. */
export function applyManualGenres<T extends { spotify_id: string }>(
  songs: T[],
  manualGenreMap: Map<string, string>,
): T[] {
  return songs.map(song => {
    const manualGenre = manualGenreMap.get(song.spotify_id)
    if (manualGenre === undefined) return song
    return { ...song, super_genre: manualGenre, super_genre_manual_override: true }
  })
}
