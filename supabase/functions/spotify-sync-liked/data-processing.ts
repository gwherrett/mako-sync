import type { SpotifyTrack } from './types.ts'
import { processMetadata } from './normalization.ts'

export function extractUniqueArtistIds(allTracks: SpotifyTrack[]): string[] {
  const artistIds = new Set<string>()
  
  allTracks.forEach(item => {
    if (item.track?.artists) {
      item.track.artists.forEach((artist: any) => {
        if (artist?.id) {
          artistIds.add(artist.id)
        }
      })
    }
  })
  
  return Array.from(artistIds)
}

export function processSongsData(allTracks: SpotifyTrack[], userId: string, artistGenreMap: Map<string, string[]>, albumGenreMap: Map<string, string[]>, genreMapping: Map<string, string>) {
  return allTracks.map(item => {
    // Get genre from artists only
    let primaryGenre: string | null = null
    let superGenre: string | null = null
    
    // Try to get genre from artists
    if (item.track?.artists && item.track.artists.length > 0) {
      // Loop through all artists until we find one with genres
      for (let i = 0; i < item.track.artists.length; i++) {
        const artistId = item.track.artists[i]?.id
        if (artistId && artistGenreMap.has(artistId)) {
          const genres = artistGenreMap.get(artistId) || []
          if (genres.length > 0) {
            primaryGenre = genres[0]
            
            // Get super genre from mapping if primary genre exists
            if (primaryGenre && genreMapping.has(primaryGenre)) {
              superGenre = genreMapping.get(primaryGenre) || null
            }
            
            break // Found genres, stop looking
          }
        }
      }
    }
    
    const title = item.track.name;
    const artist = item.track.artists.map((artist: any) => artist.name).join(', ');
    const { normalized_title, normalized_artist, core_title, primary_artist, featured_artists, mix } = processMetadata(title, artist);

    return {
      user_id: userId,
      spotify_id: item.track.id,
      title,
      artist,
      primary_artist,
      featured_artists,
      normalized_title,
      normalized_artist,
      core_title,
      mix,
      album: item.track.album.name,
      year: item.track.album.release_date ? new Date(item.track.album.release_date).getFullYear() : null,
      added_at: item.added_at,
      genre: primaryGenre,
      super_genre: superGenre,
      danceability: null,
      bpm: null,
      key: null,
    }
  })
}