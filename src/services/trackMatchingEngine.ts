/**
 * Pure Track Matching Engine
 *
 * Stateless, IO-free matching logic extracted from TrackMatchingService.
 * Used by both the live matching service and the eval test suite.
 */

import { NormalizationService } from './normalization.service';

// ---- Types ----

export interface LocalTrack {
  id: string;
  title: string | null;
  artist: string | null;
  primary_artist: string | null;
  album: string | null;
  genre: string | null;
  file_path: string;
}

export interface SpotifyTrack {
  /** `spotify_liked.id`, the row's uuid. */
  id: string;
  /** Spotify's own track id, which the Spotify Web API takes. */
  spotify_id: string;
  title: string;
  artist: string;
  primary_artist: string | null;
  album: string | null;
  genre: string | null;
  super_genre: string | null;
  super_genre_manual_override: boolean;
}

export interface MatchResult {
  matched: boolean;
  /** Which tier matched (1=exact, 2=core title, 3=fuzzy), null if no match */
  tier: 1 | 2 | 3 | null;
  spotifyTrack: SpotifyTrack;
  matchedLocalTrack?: LocalTrack;
  /** Similarity percentage for tier 3 matches */
  similarity?: number;
  normalizedSpotifyTitle: string;
  normalizedSpotifyArtist: string;
  normalizedLocalTitle?: string;
  normalizedLocalArtist?: string;
}

export interface LocalIndex {
  exactSet: Set<string>;
  coreSet: Set<string>;
  /** Same keys as exactSet, mapped to the local track that produced the key. */
  exactMap: Map<string, LocalTrack>;
  /** Same keys as coreSet, mapped to the local track that produced the key. */
  coreMap: Map<string, LocalTrack>;
  normalized: Array<{
    track: LocalTrack;
    title: string;
    coreTitle: string;
    artist: string;
  }>;
}

// ---- Constants ----

export const FUZZY_MATCH_THRESHOLD = 85;

// ---- Singleton normalization service ----

const normalizationService = new NormalizationService();

// ---- Pure functions ----

/**
 * Normalize a string for comparison using the full NormalizationService pipeline:
 * NFKC unicode normalization, diacritics removal, then strip remaining punctuation.
 */
export function normalize(str: string | null): string {
  if (!str) return '';
  // Use NormalizationService for NFKC + diacritics + punctuation unification
  let normalized = normalizationService.normalize(str);
  // Strip URL-like junk (e.g., "www.djsoundtop.com")
  normalized = normalized.replace(/\bwww\.\S+/gi, '');
  // Strip feat/ft/featuring clauses (e.g., "feat Palmer Brown", "feat. Ras Stimulant")
  normalized = normalized.replace(/\s+feat\.?\s+.*$/i, '');
  normalized = normalized.replace(/\s+ft\.?\s+.*$/i, '');
  normalized = normalized.replace(/\s+featuring\s+.*$/i, '');
  // Strip trailing standalone BPM numbers (e.g., " 131" at end after mix info)
  normalized = normalized.replace(/\s+\d{2,3}\s*$/, '');
  // Strip remaining punctuation for comparison keys (keep only word chars + spaces)
  normalized = normalized.replace(/[^\w\s]/g, '');
  return normalized.replace(/\s+/g, ' ').trim();
}

/** Extract core title without mix/version info */
export function extractCoreTitle(title: string | null): string {
  if (!title) return '';
  // Strip URL junk before version extraction so it doesn't pollute the core
  const cleaned = title.replace(/\bwww\.\S+/gi, '').trim();
  const { core } = normalizationService.extractVersionInfo(cleaned);
  // Also strip trailing "Original Mix" / "Extended Mix" that may remain unparenthesized
  const coreClean = core.replace(/\s+original\s+mix\s*$/i, '').replace(/\s+extended\s+mix\s*$/i, '').trim();
  let coreNormalized = normalize(coreClean);
  // Strip "radio edit" and remaster variants that appear without delimiters.
  // Delimited forms (parentheses/brackets/hyphen) are already handled by extractVersionInfo.
  coreNormalized = coreNormalized.replace(/\s+radio\s+edit$/, '').trim();
  coreNormalized = coreNormalized.replace(/\s+\d{4}\s+remaster(?:ed)?$/, '').trim();
  coreNormalized = coreNormalized.replace(/\s+remaster(?:ed)?(?:\s+\d{4})?$/, '').trim();
  return coreNormalized;
}

/**
 * Normalize an artist name: full normalization pipeline + strip "The " prefix.
 */
export function normalizeArtist(artist: string | null): string {
  if (!artist) return '';

  let normalized = normalize(artist);

  if (normalized.startsWith('the ')) {
    normalized = normalized.slice(4);
  }

  return normalized;
}

/** Calculate Levenshtein distance between two strings */
export function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];
  const len1 = str1.length;
  const len2 = str2.length;

  for (let i = 0; i <= len2; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len1; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len2; i++) {
    for (let j = 1; j <= len1; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[len2][len1];
}

/** Calculate similarity percentage between two strings */
export function calculateSimilarity(str1: string, str2: string): number {
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  return maxLength === 0 ? 100 : ((maxLength - distance) / maxLength) * 100;
}

/**
 * Strip artist-name prefix from a title if present.
 * Handles "Artist - Title" pattern where artist is embedded in the title field.
 */
function stripArtistPrefix(title: string | null, artist: string | null, rawArtist?: string | null): string {
  if (!title || !artist) return title || '';
  const titleLower = title.toLowerCase();
  // Try with the provided artist (may be primary_artist, already normalized)
  for (const a of [artist, rawArtist].filter(Boolean)) {
    const prefixPattern = a!.toLowerCase().trim() + ' - ';
    if (titleLower.startsWith(prefixPattern)) {
      return title.slice(prefixPattern.length).trim();
    }
  }
  return title;
}

/**
 * Build lookup structures from local tracks for efficient matching.
 */
export function buildLocalIndex(localTracks: LocalTrack[]): LocalIndex {
  const exactSet = new Set(
    localTracks.map(track => {
      const artist = track.primary_artist || track.artist;
      const title = stripArtistPrefix(track.title, artist, track.artist);
      return `${normalize(title)}_${normalizeArtist(artist)}`;
    })
  );

  const coreSet = new Set(
    localTracks.map(track => {
      const artist = track.primary_artist || track.artist;
      const title = stripArtistPrefix(track.title, artist, track.artist);
      return `${extractCoreTitle(title)}_${normalizeArtist(artist)}`;
    })
  );

  const normalized = localTracks.map(track => {
    const artist = track.primary_artist || track.artist;
    const title = stripArtistPrefix(track.title, artist, track.artist);
    return {
      track,
      title: normalize(title),
      coreTitle: extractCoreTitle(title),
      artist: normalizeArtist(artist),
    };
  });

  // The normalized fields build the same keys as exactSet and coreSet. When two local files
  // share a key, the first one in input order wins, so the same input always yields the same
  // matchedLocalTrack.
  const exactMap = new Map<string, LocalTrack>();
  const coreMap = new Map<string, LocalTrack>();
  for (const local of normalized) {
    const exactKey = `${local.title}_${local.artist}`;
    const coreKey = `${local.coreTitle}_${local.artist}`;
    if (!exactMap.has(exactKey)) exactMap.set(exactKey, local.track);
    if (!coreMap.has(coreKey)) coreMap.set(coreKey, local.track);
  }

  return { exactSet, coreSet, exactMap, coreMap, normalized };
}

/**
 * Match a single Spotify track against a local index.
 * Returns detailed result about which tier matched and why.
 */
export function matchTrack(
  spotifyTrack: SpotifyTrack,
  localIndex: LocalIndex
): MatchResult {
  const spotifyTitle = normalize(spotifyTrack.title);
  const spotifyCoreTitle = extractCoreTitle(spotifyTrack.title);
  const spotifyArtist = normalizeArtist(spotifyTrack.primary_artist || spotifyTrack.artist);

  const baseResult = {
    spotifyTrack,
    normalizedSpotifyTitle: spotifyTitle,
    normalizedSpotifyArtist: spotifyArtist,
  };

  // Tier 1: Exact match on full title + artist
  const exactKey = `${spotifyTitle}_${spotifyArtist}`;
  const exactMatch = localIndex.exactMap.get(exactKey);
  if (exactMatch) {
    return { ...baseResult, matched: true, tier: 1, matchedLocalTrack: exactMatch };
  }

  // Tier 2: Core title match (without mix/version) + artist
  const coreKey = `${spotifyCoreTitle}_${spotifyArtist}`;
  const coreMatch = localIndex.coreMap.get(coreKey);
  if (coreMatch) {
    return { ...baseResult, matched: true, tier: 2, matchedLocalTrack: coreMatch };
  }

  // Tier 2b: Cross-compare — Spotify full title vs local core title (or vice versa).
  // Handles cases where one side includes mix info that the other stripped.
  // E.g., Spotify "Zombie (THEMBA's Herd Mix)" vs local core "zombie thembas herd mix"
  for (const local of localIndex.normalized) {
    if (local.artist !== spotifyArtist) continue;
    if (spotifyTitle === local.coreTitle || spotifyCoreTitle === local.title) {
      return { ...baseResult, matched: true, tier: 2, matchedLocalTrack: local.track };
    }
  }

  // Tier 3: Fuzzy matching
  for (const local of localIndex.normalized) {
    if (local.artist !== spotifyArtist) continue;

    const titleSim = calculateSimilarity(local.title, spotifyTitle);
    const coreSim = calculateSimilarity(local.coreTitle, spotifyCoreTitle);

    if (titleSim >= FUZZY_MATCH_THRESHOLD || coreSim >= FUZZY_MATCH_THRESHOLD) {
      return {
        ...baseResult,
        matched: true,
        tier: 3,
        matchedLocalTrack: local.track,
        similarity: Math.max(titleSim, coreSim),
        normalizedLocalTitle: local.title,
        normalizedLocalArtist: local.artist,
      };
    }
  }

  // No match
  return { ...baseResult, matched: false, tier: null };
}

/**
 * Run matching for a batch of Spotify tracks against local tracks.
 * Pure function, no IO.
 */
export function findMissingTracksPure(
  spotifyTracks: SpotifyTrack[],
  localTracks: LocalTrack[]
): MatchResult[] {
  const localIndex = buildLocalIndex(localTracks);
  return spotifyTracks.map(st => matchTrack(st, localIndex));
}
