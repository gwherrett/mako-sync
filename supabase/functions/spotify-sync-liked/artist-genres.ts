import { fetchWithTokenRetry } from './spotify-auth.ts'

const CONCURRENCY_CAP = 5
// Pause between concurrency windows to stay under Spotify's per-app rate limit —
// individual artist lookups (one API call each, since the batch endpoint was removed)
// were bursting fast enough to exhaust the rate limit budget and 429 the *next*
// unrelated request (e.g. the /v1/me/tracks pagination call).
const WINDOW_DELAY_MS = 250
const MAX_429_RETRIES = 3
const DEFAULT_RETRY_AFTER_S = 2

// Cache TTL: re-fetch artist genres after this many days.
// Ensures stale genre data (e.g. after Spotify updates an artist's tags, or after
// new genre map entries are added) is eventually refreshed from the API.
const CACHE_TTL_DAYS = 30

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export interface FetchArtistGenresOptions {
  // Epoch ms. No new window or 429 wait starts that would run past it; the lookup stops incomplete instead.
  deadlineAt?: number
  // Called with each window's results as soon as it finishes, so an interrupted run keeps what it fetched.
  onWindow?: (windowGenres: Map<string, string[]>) => Promise<void>
}

export interface FetchArtistGenresResult {
  genreMap: Map<string, string[]>
  // False when the deadline stopped the lookup before every artist was tried
  complete: boolean
}

// NOTE: The `genres` field on the single-artist endpoint (GET /v1/artists/{id}) is
// now deprecated by Spotify — monitor for removal in future API changes.
export async function fetchArtistGenres(accessToken: string, artistIds: string[], tokenRefresher?: () => Promise<string>, options: FetchArtistGenresOptions = {}): Promise<FetchArtistGenresResult> {
  const { deadlineAt, onWindow } = options
  const genreMap = new Map<string, string[]>()
  let stoppedByDeadline = false

  console.log(`Fetching genres for ${artistIds.length} artists individually (concurrency: ${CONCURRENCY_CAP})`)

  async function fetchOne(artistId: string, windowGenres: Map<string, string[]>): Promise<void> {
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      const response = tokenRefresher
        ? await fetchWithTokenRetry(`https://api.spotify.com/v1/artists/${artistId}`, accessToken, tokenRefresher)
        : await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          })

      if (response.ok) {
        const artist = await response.json()
        if (artist && artist.id) {
          windowGenres.set(artist.id, artist.genres || [])
        }
        return
      }

      if (response.status === 429) {
        const retryAfterS = parseInt(response.headers.get('Retry-After') ?? '', 10) || DEFAULT_RETRY_AFTER_S
        if (attempt < MAX_429_RETRIES) {
          if (deadlineAt !== undefined && Date.now() + retryAfterS * 1000 >= deadlineAt) {
            console.warn(`Rate limited fetching artist ${artistId} — waiting ${retryAfterS}s would pass the deadline, stopping lookup`)
            stoppedByDeadline = true
            return
          }
          console.warn(`Rate limited fetching artist ${artistId}, retrying in ${retryAfterS}s (attempt ${attempt + 1}/${MAX_429_RETRIES})`)
          await sleep(retryAfterS * 1000)
          continue
        }
        console.warn(`Skipping artist ${artistId} — exhausted 429 retries`)
        return
      }

      const errorText = await response.text()
      console.error(`Failed to fetch artist ${artistId}: ${response.status} ${response.statusText} - ${errorText}`)

      if (response.status === 401) {
        throw new Error('Spotify token invalid')
      }

      // Skip this artist on non-auth, non-rate-limit errors
      console.warn(`Skipping artist ${artistId} due to error: ${errorText}`)
      return
    }
  }

  // Process in windows of CONCURRENCY_CAP using Promise.allSettled, with a pacing
  // delay between windows so we don't burst past Spotify's rate limit.
  for (let i = 0; i < artistIds.length; i += CONCURRENCY_CAP) {
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      stoppedByDeadline = true
    }
    if (stoppedByDeadline) break

    const window = artistIds.slice(i, i + CONCURRENCY_CAP)
    const windowGenres = new Map<string, string[]>()
    const results = await Promise.allSettled(window.map(id => fetchOne(id, windowGenres)))

    for (const result of results) {
      if (result.status === 'rejected') {
        // Re-throw auth errors so the caller can handle them
        if (result.reason?.message === 'Spotify token invalid') {
          throw result.reason
        }
        console.warn('Artist fetch rejected:', result.reason)
      }
    }

    for (const [artistId, genres] of windowGenres) {
      genreMap.set(artistId, genres)
    }

    // Hand off this window's results during the pacing delay, so the write adds no time
    const isLastWindow = i + CONCURRENCY_CAP >= artistIds.length
    await Promise.all([
      onWindow && windowGenres.size > 0 ? onWindow(windowGenres) : undefined,
      isLastWindow || stoppedByDeadline ? undefined : sleep(WINDOW_DELAY_MS),
    ])
  }

  if (stoppedByDeadline) {
    console.warn(`⏱️ Deadline reached — stopped artist lookup with ${genreMap.size}/${artistIds.length} artists fetched`)
  } else {
    console.log(`Fetched genres for ${genreMap.size} artists`)
  }
  return { genreMap, complete: !stoppedByDeadline }
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
  
  // No success log: this runs once per lookup window, and the lookup logs a summary
  if (error) {
    console.error('Error caching artist genres:', error)
  }
}

export interface ArtistGenreResult {
  genreMap: Map<string, string[]>
  cacheHits: number
  apiFetches: number
  // False when deadlineAt stopped the Spotify lookup early; genreMap is then missing artists
  complete: boolean
}

export async function getArtistGenresWithCache(accessToken: string, artistIds: string[], supabaseClient: any, tokenRefresher?: () => Promise<string>, deadlineAt?: number): Promise<ArtistGenreResult> {
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
    return { genreMap: cachedGenres, cacheHits, apiFetches: 0, complete: true }
  }

  console.log(`Cache: ${cacheHits} hits, ${uncachedArtistIds.length} misses — fetching ${uncachedArtistIds.length} from Spotify API`)

  // Fetch missing artist data from Spotify, caching each window as it returns so an
  // interrupted or deadline-stopped run still makes progress
  const { genreMap: freshGenres, complete } = await fetchArtistGenres(accessToken, uncachedArtistIds, tokenRefresher, {
    deadlineAt,
    onWindow: windowGenres => cacheArtistGenres(windowGenres, supabaseClient),
  })

  // Combine cached and fresh data
  const allGenres = new Map([...cachedGenres, ...freshGenres])

  console.log(`Total genres available: ${allGenres.size}/${uniqueArtistIds.length} (${cacheHits} cached, ${freshGenres.size} fetched)`)
  return { genreMap: allGenres, cacheHits, apiFetches: uncachedArtistIds.length, complete }
}