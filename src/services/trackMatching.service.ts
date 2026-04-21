import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/utils/promiseUtils';
import {
  normalize,
  normalizeArtist,
  extractCoreTitle,
  calculateSimilarity,
  buildLocalIndex,
  FUZZY_MATCH_THRESHOLD,
  type LocalTrack,
  type SpotifyTrack,
} from './trackMatchingEngine';

interface MissingTrack {
  spotifyTrack: SpotifyTrack;
  reason: string;
}

// Debug mode - set to true to log detailed matching info for specific tracks
const DEBUG_MATCHING = true;
// Add artist/title substrings to debug specific tracks (case-insensitive)
const DEBUG_TRACKS: string[] = ['armando', 'disin'];

function shouldDebug(title: string, artist: string): boolean {
  if (!DEBUG_MATCHING || DEBUG_TRACKS.length === 0) return false;
  const combined = `${title} ${artist}`.toLowerCase();
  return DEBUG_TRACKS.some(term => combined.includes(term.toLowerCase()));
}

export class TrackMatchingService {

  // Fetch local tracks for user with pagination to handle large collections
  static async fetchLocalTracks(userId: string): Promise<LocalTrack[]> {
    const PAGE_SIZE = 1000;
    const allTracks: LocalTrack[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await withTimeout(
        supabase
          .from('local_mp3s')
          .select('id, title, artist, primary_artist, album, genre, file_path')
          .eq('user_id', userId)
          .range(offset, offset + PAGE_SIZE - 1)
          .then(r => r),
        30000,
        'fetchLocalTracks page timed out'
      );

      if (error) {
        throw new Error(`Failed to fetch local tracks: ${error.message}`);
      }

      if (data && data.length > 0) {
        allTracks.push(...data);
        offset += data.length;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    console.log(`📀 Fetched ${allTracks.length} local tracks for matching`);
    return allTracks;
  }

  // Fetch Spotify tracks for user with optional cascading filters
  static async fetchSpotifyTracks(
    userId: string,
    superGenreFilter?: string,
    genreFilter?: string,
    artistFilter?: string
  ): Promise<SpotifyTrack[]> {
    let query = supabase
      .from('spotify_liked')
      .select('id, title, artist, primary_artist, album, genre, super_genre, super_genre_manual_override')
      .eq('user_id', userId)
      .limit(50000); // Override default 1000 limit to handle large collections

    // Apply cascading filters
    if (superGenreFilter && superGenreFilter !== 'all') {
      query = query.eq('super_genre', superGenreFilter as any);
    }
    if (genreFilter && genreFilter !== 'all') {
      query = query.eq('genre', genreFilter as any);
    }
    if (artistFilter && artistFilter !== 'all') {
      query = query.eq('artist', artistFilter as any);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch Spotify tracks: ${error.message}`);
    }

    // Build filter description for logging
    const filterParts = [];
    if (superGenreFilter && superGenreFilter !== 'all') filterParts.push(`supergenre: ${superGenreFilter}`);
    if (genreFilter && genreFilter !== 'all') filterParts.push(`genre: ${genreFilter}`);
    if (artistFilter && artistFilter !== 'all') filterParts.push(`artist: ${artistFilter}`);
    const filterText = filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';
    console.log(`🎵 Fetched ${data?.length || 0} Spotify tracks for matching${filterText}`);
    return data || [];
  }

  // Find missing tracks (Spotify tracks not in local collection)
  // Uses three-tier matching: exact → core title → fuzzy
  static async findMissingTracks(
    userId: string,
    superGenreFilter?: string,
    genreFilter?: string,
    artistFilter?: string
  ): Promise<MissingTrack[]> {
    const [localTracks, spotifyTracks] = await Promise.all([
      this.fetchLocalTracks(userId),
      this.fetchSpotifyTracks(userId, superGenreFilter, genreFilter, artistFilter)
    ]);

    const missingTracks: MissingTrack[] = [];

    // Build lookup structures using the engine
    const localIndex = buildLocalIndex(localTracks);

    // Debug: Log local tracks matching debug criteria
    if (DEBUG_MATCHING) {
      const debugRawLocalTracks = localTracks.filter(t => {
        const combined = `${t.title || ''} ${t.artist || ''} ${t.primary_artist || ''}`.toLowerCase();
        return DEBUG_TRACKS.some(term => combined.includes(term.toLowerCase()));
      });
      if (debugRawLocalTracks.length > 0) {
        console.log('🔍 DEBUG: Raw local tracks from DB matching debug criteria:');
        debugRawLocalTracks.forEach(t => {
          console.log(`  📀 Title: "${t.title}"`);
          console.log(`     Artist field: "${t.artist}"`);
          console.log(`     Primary_artist field: "${t.primary_artist}"`);
          console.log(`     File: "${t.file_path}"`);
        });
      } else {
        console.log('🔍 DEBUG: No local tracks found in DB matching debug criteria');
        console.log(`   Searched for: ${DEBUG_TRACKS.join(', ')}`);
        console.log(`   Total local tracks in DB: ${localTracks.length}`);
      }

      const debugLocalTracks = localIndex.normalized.filter(t =>
        shouldDebug(t.track.title || '', (t.track.primary_artist || t.track.artist) || '')
      );
      if (debugLocalTracks.length > 0) {
        console.log('🔍 DEBUG: Normalized local tracks matching debug criteria:');
        debugLocalTracks.forEach(t => {
          console.log(`  📀 Original: "${t.track.title}" by "${t.track.primary_artist || t.track.artist}"`);
          console.log(`     Normalized title: "${t.title}"`);
          console.log(`     Core title: "${t.coreTitle}"`);
          console.log(`     Normalized artist: "${t.artist}"`);
        });
      }
    }

    for (const spotifyTrack of spotifyTracks) {
      const spotifyTitle = normalize(spotifyTrack.title);
      const spotifyCoreTitle = extractCoreTitle(spotifyTrack.title);
      const spotifyArtist = normalizeArtist(spotifyTrack.primary_artist || spotifyTrack.artist);

      const debug = shouldDebug(spotifyTrack.title, spotifyTrack.primary_artist || spotifyTrack.artist);

      if (debug) {
        console.log('🔍 DEBUG: Processing Spotify track:');
        console.log(`  🎵 Original: "${spotifyTrack.title}" by "${spotifyTrack.artist}"`);
        console.log(`     Primary artist: "${spotifyTrack.primary_artist}"`);
        console.log(`     Normalized title: "${spotifyTitle}"`);
        console.log(`     Core title: "${spotifyCoreTitle}"`);
        console.log(`     Normalized artist: "${spotifyArtist}"`);
      }

      // Tier 1: Exact match on full title + artist
      const exactKey = `${spotifyTitle}_${spotifyArtist}`;
      if (localIndex.exactSet.has(exactKey)) {
        if (debug) console.log(`  ✅ Tier 1 MATCH (exact): key="${exactKey}"`);
        continue;
      }
      if (debug) console.log(`  ❌ Tier 1 no match: key="${exactKey}"`);

      // Tier 2: Match on core title (without mix/version) + artist
      const coreKey = `${spotifyCoreTitle}_${spotifyArtist}`;
      if (localIndex.coreSet.has(coreKey)) {
        if (debug) console.log(`  ✅ Tier 2 MATCH (core): key="${coreKey}"`);
        continue;
      }
      if (debug) console.log(`  ❌ Tier 2 no match: key="${coreKey}"`);

      // Tier 3: Fuzzy matching
      let fuzzyMatch = false;
      let bestFuzzyMatch: { local: typeof localIndex.normalized[0]; titleSim: number; coreSim: number } | null = null;

      for (const local of localIndex.normalized) {
        if (local.artist !== spotifyArtist) continue;

        const titleSimilarity = calculateSimilarity(local.title, spotifyTitle);
        const coreSimilarity = calculateSimilarity(local.coreTitle, spotifyCoreTitle);

        if (debug && (titleSimilarity > 50 || coreSimilarity > 50)) {
          console.log(`  🔎 Fuzzy candidate: "${local.track.title}"`);
          console.log(`     Title similarity: ${titleSimilarity.toFixed(1)}%, Core similarity: ${coreSimilarity.toFixed(1)}%`);
        }

        if (titleSimilarity >= FUZZY_MATCH_THRESHOLD || coreSimilarity >= FUZZY_MATCH_THRESHOLD) {
          fuzzyMatch = true;
          bestFuzzyMatch = { local, titleSim: titleSimilarity, coreSim: coreSimilarity };
          break;
        }
      }

      if (fuzzyMatch && bestFuzzyMatch) {
        if (debug) {
          console.log(`  ✅ Tier 3 MATCH (fuzzy): "${bestFuzzyMatch.local.track.title}"`);
          console.log(`     Similarity: title=${bestFuzzyMatch.titleSim.toFixed(1)}%, core=${bestFuzzyMatch.coreSim.toFixed(1)}%`);
        }
        continue;
      }

      if (debug) {
        console.log(`  ❌ Tier 3 no fuzzy match found`);
        const artistMatches = localIndex.normalized.filter(l => l.artist === spotifyArtist);
        if (artistMatches.length === 0) {
          console.log(`  ⚠️  No local tracks found for artist "${spotifyArtist}"`);
        } else {
          console.log(`  📋 Local tracks by this artist (${artistMatches.length}):`);
          artistMatches.slice(0, 5).forEach(l => {
            console.log(`     - "${l.track.title}" (normalized: "${l.title}")`);
          });
          if (artistMatches.length > 5) {
            console.log(`     ... and ${artistMatches.length - 5} more`);
          }
        }
        console.log(`  🚫 MISSING: Track will be added to missing list`);
      }

      // No match found at any tier
      missingTracks.push({
        spotifyTrack,
        reason: 'No matching local track found'
      });
    }

    return missingTracks;
  }

  // Cross-reference a vinyl record's Discogs tracklist against the user's local files.
  // Returns matched local tracks and missing Discogs tracks (by position + title).
  static async matchTracklistAgainstLocal(
    userId: string,
    tracklist: { position: string; title: string }[],
    artist: string
  ): Promise<{
    matched: LocalTrack[];
    missing: { position: string; title: string }[];
  }> {
    const localTracks = await this.fetchLocalTracks(userId);
    const localIndex = buildLocalIndex(localTracks);
    const normalizedArtist = normalizeArtist(artist);

    const matched: LocalTrack[] = [];
    const missing: { position: string; title: string }[] = [];

    for (const discogsTrack of tracklist) {
      // Skip side headings (type_ === 'heading') — they have no audio
      if (!discogsTrack.title) continue;

      const normTitle = normalize(discogsTrack.title);
      const coreTitle = extractCoreTitle(discogsTrack.title);

      // Tier 1: exact
      const exactKey = `${normTitle}_${normalizedArtist}`;
      if (localIndex.exactSet.has(exactKey)) {
        const found = localIndex.normalized.find(l => `${l.title}_${l.artist}` === exactKey);
        if (found) matched.push(found.track);
        continue;
      }

      // Tier 2: core title
      const coreKey = `${coreTitle}_${normalizedArtist}`;
      if (localIndex.coreSet.has(coreKey)) {
        const found = localIndex.normalized.find(l => `${l.coreTitle}_${l.artist}` === coreKey);
        if (found) matched.push(found.track);
        continue;
      }

      // Tier 3: fuzzy
      let fuzzyFound: LocalTrack | null = null;
      for (const local of localIndex.normalized) {
        if (local.artist !== normalizedArtist) continue;
        const titleSim = calculateSimilarity(local.title, normTitle);
        const coreSim = calculateSimilarity(local.coreTitle, coreTitle);
        if (titleSim >= FUZZY_MATCH_THRESHOLD || coreSim >= FUZZY_MATCH_THRESHOLD) {
          fuzzyFound = local.track;
          break;
        }
      }

      if (fuzzyFound) {
        matched.push(fuzzyFound);
      } else {
        missing.push({ position: discogsTrack.position, title: discogsTrack.title });
      }
    }

    return { matched, missing };
  }

  // Fetch available super genres for filtering
  static async fetchSuperGenres(userId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('spotify_liked')
      .select('super_genre')
      .eq('user_id', userId)
      .not('super_genre', 'is', null)
      .limit(50000);

    if (error) {
      throw new Error(`Failed to fetch super genres: ${error.message}`);
    }

    const uniqueGenres = [...new Set(data?.map(item => item.super_genre).filter(Boolean) || [])];
    return uniqueGenres.sort();
  }
}
