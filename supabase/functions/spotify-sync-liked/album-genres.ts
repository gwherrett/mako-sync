const CONCURRENCY_CAP = 5

// NOTE: album.genres is historically empty for most Spotify albums.
// If all fetched albums return empty genre arrays, we log a warning and skip caching
// rather than polluting the cache with empty data.
export async function fetchAlbumGenres(accessToken: string, albumIds: string[]): Promise<Map<string, string[]>> {
  const genreMap = new Map<string, string[]>()

  console.log(`Fetching genres for ${albumIds.length} albums individually (concurrency: ${CONCURRENCY_CAP})`)

  async function fetchOne(albumId: string): Promise<void> {
    const response = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Failed to fetch album ${albumId}: ${response.status} ${response.statusText} - ${errorText}`)

      if (response.status === 401) {
        throw new Error('Spotify token invalid')
      }

      // Skip this album on non-auth errors
      console.warn(`Skipping album ${albumId} due to error: ${errorText}`)
      return
    }

    const album = await response.json()
    if (album && album.id) {
      genreMap.set(album.id, album.genres || [])
    }
  }

  // Process in windows of CONCURRENCY_CAP using Promise.allSettled
  for (let i = 0; i < albumIds.length; i += CONCURRENCY_CAP) {
    const window = albumIds.slice(i, i + CONCURRENCY_CAP)
    const results = await Promise.allSettled(window.map(fetchOne))

    for (const result of results) {
      if (result.status === 'rejected') {
        // Re-throw auth errors so the caller can handle them
        if (result.reason?.message === 'Spotify token invalid') {
          throw result.reason
        }
        console.warn('Album fetch rejected:', result.reason)
      }
    }
  }

  // Warn if Spotify returned no genres for any album (common for most albums)
  const nonEmptyCount = Array.from(genreMap.values()).filter(g => g.length > 0).length
  if (genreMap.size > 0 && nonEmptyCount === 0) {
    console.warn(`Album genre enrichment: all ${genreMap.size} albums returned empty genre arrays. Spotify rarely populates album.genres — skipping cache write is recommended.`)
  }

  console.log(`Fetched genres for ${genreMap.size} albums (${nonEmptyCount} with non-empty genres)`)
  return genreMap
}

export async function getCachedAlbumGenres(albumIds: string[], supabaseClient: any): Promise<Map<string, string[]>> {
  const { data, error } = await supabaseClient
    .from('album_genres')
    .select('spotify_album_id, genres')
    .in('spotify_album_id', albumIds)

  if (error) {
    console.error('Error fetching cached album genres:', error)
    return new Map()
  }

  const genreMap = new Map<string, string[]>()
  data?.forEach((row: any) => {
    genreMap.set(row.spotify_album_id, row.genres || [])
  })

  console.log(`Found ${genreMap.size} cached album genres out of ${albumIds.length} requested`)
  return genreMap
}

export async function cacheAlbumGenres(genreMap: Map<string, string[]>, supabaseClient: any): Promise<void> {
  if (genreMap.size === 0) return

  // Don't cache if all entries are empty — Spotify album.genres is almost always empty
  const nonEmptyCount = Array.from(genreMap.values()).filter(g => g.length > 0).length
  if (nonEmptyCount === 0) {
    console.warn('Skipping album genre cache write: all genres are empty arrays')
    return
  }

  const cacheEntries = Array.from(genreMap.entries()).map(([albumId, genres]) => ({
    spotify_album_id: albumId,
    genres: genres,
    cached_at: new Date().toISOString()
  }))

  // Insert or update cache entries
  const { error } = await supabaseClient
    .from('album_genres')
    .upsert(cacheEntries, {
      onConflict: 'spotify_album_id',
      ignoreDuplicates: false
    })

  if (error) {
    console.error('Error caching album genres:', error)
  } else {
    console.log(`Cached genres for ${cacheEntries.length} albums`)
  }
}

export async function getAlbumGenresWithCache(accessToken: string, albumIds: string[], supabaseClient: any): Promise<Map<string, string[]>> {
  // Remove duplicates
  const uniqueAlbumIds = [...new Set(albumIds)]

  console.log(`Getting genres for ${uniqueAlbumIds.length} unique albums`)

  // Get cached genres first
  const cachedGenres = await getCachedAlbumGenres(uniqueAlbumIds, supabaseClient)

  // Find albums that need fresh data
  const uncachedAlbumIds = uniqueAlbumIds.filter(id => !cachedGenres.has(id))

  if (uncachedAlbumIds.length === 0) {
    console.log('All album genres found in cache')
    return cachedGenres
  }

  console.log(`Fetching fresh data for ${uncachedAlbumIds.length} uncached albums`)

  // Fetch missing album data from Spotify
  const freshGenres = await fetchAlbumGenres(accessToken, uncachedAlbumIds)

  // Cache the fresh data (skipped automatically if all genres are empty)
  await cacheAlbumGenres(freshGenres, supabaseClient)

  // Combine cached and fresh data
  const allGenres = new Map([...cachedGenres, ...freshGenres])

  console.log(`Total album genres available: ${allGenres.size} out of ${uniqueAlbumIds.length} requested`)
  return allGenres
}

export function extractUniqueAlbumIds(allTracks: any[]): string[] {
  const albumIds = new Set<string>()

  allTracks.forEach(item => {
    if (item.track?.album?.id) {
      albumIds.add(item.track.album.id)
    }
  })

  return Array.from(albumIds)
}
