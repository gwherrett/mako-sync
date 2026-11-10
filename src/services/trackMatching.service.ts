import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/utils/promiseUtils';
import {
  normalize,
  normalizeArtist,
  extractCoreTitle,
  calculateSimilarity,
  buildLocalIndex,
  findMissingTracksPure,
  FUZZY_MATCH_THRESHOLD,
  type LocalTrack,
  type MatchResult,
  type SpotifyTrack,
} from './trackMatchingEngine';
import type { PhysicalMediaRecord } from '@/types/discogs';
import { applySuperGenreFilter } from '@/types/genreMapping';

// Supabase caps every response at 1000 rows, whatever .limit() asks for.
const PAGE_SIZE = 1000;
const PAGE_TIMEOUT_MS = 30000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Fetch every row of a query, one PAGE_SIZE page at a time. `fetchPage` builds a fresh,
 * ordered query for each range, so pages don't overlap or skip rows.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  label: string
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await withTimeout(
      Promise.resolve(fetchPage(offset, offset + PAGE_SIZE - 1)),
      PAGE_TIMEOUT_MS,
      `${label} page timed out`
    );

    if (error) {
      throw new Error(`Failed to ${label}: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    rows.push(...data);
    offset += data.length;
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}

/** The artist key the engine matches on, at every tier. */
function artistKey(track: { primary_artist: string | null; artist: string | null }): string {
  return normalizeArtist(track.primary_artist || track.artist);
}

export interface MatchCandidateFilters {
  superGenre?: string;
  genre?: string;
  artist?: string;
}

export interface MatchCandidates {
  /** One result per Spotify track in the filtered subset, matched and unmatched. */
  results: MatchResult[];
  /** Local tracks whose artist appears in the filtered Spotify subset. */
  localTracks: LocalTrack[];
}

export interface VinylFlatTrack {
  recordId: string;
  recordTitle: string;
  recordArtist: string;
  super_genre: string | null;
  position: string;
  title: string;
}

export interface VinylGapRecord {
  record: PhysicalMediaRecord;
  missing: { position: string; title: string }[];
  matched: LocalTrack[];
}

interface MissingTrack {
  spotifyTrack: SpotifyTrack;
  reason: string;
}

// Debug mode - set to true to log detailed matching info for specific tracks
const DEBUG_MATCHING = true;
// Add artist/title substrings to debug specific tracks (case-insensitive)
const DEBUG_TRACKS: string[] = ['armando', 'disin'];

function shouldDebug(title: string | null, artist: string | null): boolean {
  if (!DEBUG_MATCHING || DEBUG_TRACKS.length === 0) return false;
  const combined = `${title || ''} ${artist || ''}`.toLowerCase();
  return DEBUG_TRACKS.some(term => combined.includes(term.toLowerCase()));
}

// Log the engine's verdict for the Spotify tracks named in DEBUG_TRACKS.
function logDebugResults(results: MatchResult[], localTracks: LocalTrack[]): void {
  for (const result of results) {
    const { spotifyTrack } = result;
    if (!shouldDebug(spotifyTrack.title, spotifyTrack.primary_artist || spotifyTrack.artist)) continue;

    console.log(`🔍 DEBUG: "${spotifyTrack.title}" by "${spotifyTrack.artist}"`);
    console.log(`     Normalized: "${result.normalizedSpotifyTitle}" / "${result.normalizedSpotifyArtist}"`);
    if (result.matched) {
      const similarity = result.similarity !== undefined ? ` (${result.similarity.toFixed(1)}%)` : '';
      console.log(`  ✅ Tier ${result.tier} match${similarity}: "${result.matchedLocalTrack?.title}" (${result.matchedLocalTrack?.file_path})`);
      continue;
    }

    const sameArtist = localTracks.filter(t => artistKey(t) === result.normalizedSpotifyArtist);
    console.log(`  🚫 MISSING. Local tracks by this artist: ${sameArtist.length}`);
    sameArtist.slice(0, 5).forEach(t => console.log(`     - "${t.title}"`));
  }
}

export class TrackMatchingService {

  // Fetch local tracks for user with pagination to handle large collections
  static async fetchLocalTracks(userId: string): Promise<LocalTrack[]> {
    const tracks = await fetchAllPages<LocalTrack>(
      (from, to) =>
        supabase
          .from('local_mp3s')
          .select('id, title, artist, primary_artist, album, genre, file_path')
          .eq('user_id', userId)
          .order('id')
          .range(from, to)
          .then(r => r),
      'fetch local tracks'
    );

    console.log(`📀 Fetched ${tracks.length} local tracks for matching`);
    return tracks;
  }

  // Fetch Spotify tracks for user with optional cascading filters, with pagination
  static async fetchSpotifyTracks(
    userId: string,
    superGenreFilter?: string,
    genreFilter?: string,
    artistFilter?: string
  ): Promise<SpotifyTrack[]> {
    const buildQuery = () => {
      let query = supabase
        .from('spotify_liked')
        .select('id, title, artist, primary_artist, album, genre, super_genre, super_genre_manual_override')
        .eq('user_id', userId);

      // Apply cascading filters
      query = applySuperGenreFilter(query, superGenreFilter);
      if (genreFilter && genreFilter !== 'all') {
        query = query.eq('genre', genreFilter);
      }
      if (artistFilter && artistFilter !== 'all') {
        query = query.eq('artist', artistFilter);
      }
      return query;
    };

    const tracks = await fetchAllPages<SpotifyTrack>(
      (from, to) => buildQuery().order('id').range(from, to).then(r => r),
      'fetch Spotify tracks'
    );

    // Build filter description for logging
    const filterParts = [];
    if (superGenreFilter && superGenreFilter !== 'all') filterParts.push(`supergenre: ${superGenreFilter}`);
    if (genreFilter && genreFilter !== 'all') filterParts.push(`genre: ${genreFilter}`);
    if (artistFilter && artistFilter !== 'all') filterParts.push(`artist: ${artistFilter}`);
    const filterText = filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';
    console.log(`🎵 Fetched ${tracks.length} Spotify tracks for matching${filterText}`);
    return tracks;
  }

  /**
   * Match a filtered subset of Spotify tracks against the user's local files with the
   * shared engine. Returns every result, matched and unmatched.
   *
   * Local tracks are scoped by artist overlap with the Spotify subset (Decision 2 in
   * docs/plans/manual-match-review.md). The engine only matches same-artist pairs at every
   * tier, so the scoping drops no match.
   */
  static async getMatchCandidates(
    userId: string,
    filters: MatchCandidateFilters = {}
  ): Promise<MatchCandidates> {
    const [allLocalTracks, spotifyTracks] = await Promise.all([
      this.fetchLocalTracks(userId),
      this.fetchSpotifyTracks(userId, filters.superGenre, filters.genre, filters.artist),
    ]);

    const spotifyArtists = new Set(spotifyTracks.map(artistKey));
    const localTracks = allLocalTracks.filter(track => spotifyArtists.has(artistKey(track)));

    const results = findMissingTracksPure(spotifyTracks, localTracks);

    const tierCounts = { 1: 0, 2: 0, 3: 0 };
    let missing = 0;
    for (const result of results) {
      if (result.tier) tierCounts[result.tier]++;
      else missing++;
    }
    console.log(
      `🎯 Matched ${results.length} Spotify tracks against ${localTracks.length} of ${allLocalTracks.length} local tracks: ` +
      `tier 1: ${tierCounts[1]}, tier 2: ${tierCounts[2]}, tier 3: ${tierCounts[3]}, missing: ${missing}`
    );
    if (DEBUG_MATCHING) logDebugResults(results, localTracks);

    return { results, localTracks };
  }

  // Find missing tracks (Spotify tracks not in local collection)
  static async findMissingTracks(
    userId: string,
    superGenreFilter?: string,
    genreFilter?: string,
    artistFilter?: string
  ): Promise<MissingTrack[]> {
    const { results } = await this.getMatchCandidates(userId, {
      superGenre: superGenreFilter,
      genre: genreFilter,
      artist: artistFilter,
    });

    return results
      .filter(result => !result.matched)
      .map(result => ({
        spotifyTrack: result.spotifyTrack,
        reason: 'No matching local track found',
      }));
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

  // Fetch all vinyl records with tracklists, flattened to one row per track.
  // Optionally filters by physical_media.super_genre (populated by MAK-134 migration).
  static async fetchVinylTracks(userId: string, superGenreFilter?: string): Promise<{ records: PhysicalMediaRecord[]; flat: VinylFlatTrack[] }> {
    let query = supabase
      .from('physical_media')
      .select('*')
      .eq('user_id', userId)
      .not('tracklist', 'is', null);

    if (superGenreFilter && superGenreFilter !== 'all') {
      query = query.eq('super_genre', superGenreFilter);
    }

    const { data, error } = await withTimeout(
      query.then(r => r),
      30000,
      'fetchVinylTracks timed out'
    );

    if (error) throw new Error(`Failed to fetch vinyl tracks: ${error.message}`);

    const records = (data || []) as PhysicalMediaRecord[];
    const flat: VinylFlatTrack[] = [];

    for (const record of records) {
      for (const track of record.tracklist ?? []) {
        if (!track.title) continue;
        flat.push({
          recordId: record.id,
          recordTitle: record.title,
          recordArtist: record.artist,
          super_genre: record.super_genre ?? null,
          position: track.position,
          title: track.title,
        });
      }
    }

    console.log(`🎵 Fetched ${records.length} vinyl records → ${flat.length} flat tracks`);
    return { records, flat };
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
