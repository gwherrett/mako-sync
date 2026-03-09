const CONCURRENCY_CAP = 5

// Cache TTL: re-fetch artist genres after this many days.
// Ensures stale genre data (e.g. after Spotify updates an artist's tags, or after
// new genre map entries are added) is eventually refreshed from the API.
const CACHE_TTL_DAYS = 30

// NOTE: The `genres` field on the single-artist endpoint (GET /v1/artists/{id}) is
// now deprecated by Spotify — monitor for removal in future API changes.
export async function fetchArtistGenres(accessToken: string, artistIds: string[]): Promise<Map<string, string[]>> {
  const genreMap = new Map<string, string[]>()

  console.log(`Fetching genres for ${artistIds.length} artists individually (concurrency: ${CONCURRENCY_CAP})`)

  async function fetchOne(artistId: string): Promise<void> {
    const response = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Failed to fetch artist ${artistId}: ${response.status} ${response.statusText} - ${errorText}`)

      if (response.status === 401) {
        throw new Error('Spotify token invalid')
      }

      // Skip this artist on non-auth errors
      console.warn(`Skipping artist ${artistId} due to error: ${errorText}`)
      return
    }

    const artist = await response.json()
    if (artist && artist.id) {
      genreMap.set(artist.id, artist.genres || [])
    }
  }

  // Process in windows of CONCURRENCY_CAP using Promise.allSettled
  for (let i = 0; i < artistIds.length; i += CONCURRENCY_CAP) {
    const window = artistIds.slice(i, i + CONCURRENCY_CAP)
    const results = await Promise.allSettled(window.map(fetchOne))

    for (const result of results) {
      if (result.status === 'rejected') {
        // Re-throw auth errors so the caller can handle them
        if (result.reason?.message === 'Spotify token invalid') {
          throw result.reason
        }
        console.warn('Artist fetch rejected:', result.reason)
      }
    }
  }

  console.log(`Fetched genres for ${genreMap.size} artists`)
  return genreMap
}

export async function getCachedArtistGenres(artistIds: string[], supabaseClient: any): Promise<Map<string, string[]>> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - CACHE_TTL_DAYS)

  const { data, error } = await supabaseClient
    .from('artist_genres')
    .select('spotify_artist_id, genres')
    .in('spotify_artist_id', artistIds)
    .gte('cached_at', cutoff.toISOString())

  if (error) {
    console.error('Error fetching cached artist genres:', error)
    return new Map()
  }

  const genreMap = new Map<string, string[]>()
  data?.forEach((row: any) => {
    genreMap.set(row.spotify_artist_id, row.genres || [])
  })

  console.log(`Found ${genreMap.size} cached artist genres out of ${artistIds.length} requested (TTL: ${CACHE_TTL_DAYS}d)`)
  return genreMap
}

export async function cacheArtistGenres(genreMap: Map<string, string[]>, supabaseClient: any): Promise<void> {
  if (genreMap.size === 0) return
  
  const cacheEntries = Array.from(genreMap.entries()).map(([artistId, genres]) => ({
    spotify_artist_id: artistId,
    genres: genres,
    cached_at: new Date().toISOString()
  }))
  
  // Insert or update cache entries
  const { error } = await supabaseClient
    .from('artist_genres')
    .upsert(cacheEntries, { 
      onConflict: 'spotify_artist_id',
      ignoreDuplicates: false 
    })
  
  if (error) {
    console.error('Error caching artist genres:', error)
  } else {
    console.log(`Cached genres for ${cacheEntries.length} artists`)
  }
}

export interface ArtistGenreResult {
  genreMap: Map<string, string[]>
  cacheHits: number
  apiFetches: number
}

export async function getArtistGenresWithCache(accessToken: string, artistIds: string[], supabaseClient: any): Promise<ArtistGenreResult> {
  // Remove duplicates
  const uniqueArtistIds = [...new Set(artistIds)]

  console.log(`Getting genres for ${uniqueArtistIds.length} unique artists`)

  // Get cached genres first (TTL-filtered — stale entries count as misses)
  const cachedGenres = await getCachedArtistGenres(uniqueArtistIds, supabaseClient)
  const cacheHits = cachedGenres.size

  // Find artists that need fresh data (not in cache or cache expired)
  const uncachedArtistIds = uniqueArtistIds.filter(id => !cachedGenres.has(id))

  if (uncachedArtistIds.length === 0) {
    console.log(`All ${cacheHits} artist genres served from cache — 0 Spotify API calls needed`)
    return { genreMap: cachedGenres, cacheHits, apiFetches: 0 }
  }

  console.log(`Cache: ${cacheHits} hits, ${uncachedArtistIds.length} misses — fetching ${uncachedArtistIds.length} from Spotify API`)

  // Fetch missing artist data from Spotify
  const freshGenres = await fetchArtistGenres(accessToken, uncachedArtistIds)

  // Cache the fresh data
  await cacheArtistGenres(freshGenres, supabaseClient)

  // Combine cached and fresh data
  const allGenres = new Map([...cachedGenres, ...freshGenres])

  console.log(`Total genres available: ${allGenres.size}/${uniqueArtistIds.length} (${cacheHits} cached, ${uncachedArtistIds.length} fetched)`)
  return { genreMap: allGenres, cacheHits, apiFetches: uncachedArtistIds.length }
}