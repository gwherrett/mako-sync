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
  id: string;
  title: string;
  artist: string;
  primary_artist: string | null;
  album: string | null;
  genre: string | null;
  super_genre: string | null;
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

/** Normalize a string for comparison: lowercase, strip special chars, collapse whitespace */
export function normalize(str: string | null): string {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract core title without mix/version info */
export function extractCoreTitle(title: string | null): string {
  if (!title) return '';
  const { core } = normalizationService.extractVersionInfo(title);
  return normalize(core);
}

/** Normalize an artist name: lowercase, strip special chars, remove "The " prefix */
export function normalizeArtist(artist: string | null): string {
  if (!artist) return '';

  let normalized = artist.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

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
 * Build lookup structures from local tracks for efficient matching.
 */
export function buildLocalIndex(localTracks: LocalTrack[]): LocalIndex {
  const exactSet = new Set(
    localTracks.map(track =>
      `${normalize(track.title)}_${normalizeArtist(track.primary_artist || track.artist)}`
    )
  );

  const coreSet = new Set(
    localTracks.map(track =>
      `${extractCoreTitle(track.title)}_${normalizeArtist(track.primary_artist || track.artist)}`
    )
  );

  const normalized = localTracks.map(track => ({
    track,
    title: normalize(track.title),
    coreTitle: extractCoreTitle(track.title),
    artist: normalizeArtist(track.primary_artist || track.artist),
  }));

  return { exactSet, coreSet, normalized };
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
  if (localIndex.exactSet.has(exactKey)) {
    return { ...baseResult, matched: true, tier: 1 };
  }

  // Tier 2: Core title match (without mix/version) + artist
  const coreKey = `${spotifyCoreTitle}_${spotifyArtist}`;
  if (localIndex.coreSet.has(coreKey)) {
    return { ...baseResult, matched: true, tier: 2 };
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
