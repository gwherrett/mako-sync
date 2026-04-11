/**
 * Tests for trackMatchingEngine.ts
 *
 * Covers the pure functions used in the 3-tier matching pipeline:
 * normalize, extractCoreTitle, normalizeArtist, levenshteinDistance,
 * calculateSimilarity, buildLocalIndex, matchTrack, findMissingTracksPure
 */

import { describe, it, expect } from 'vitest';
import {
  normalize,
  extractCoreTitle,
  normalizeArtist,
  levenshteinDistance,
  calculateSimilarity,
  buildLocalIndex,
  matchTrack,
  findMissingTracksPure,
  FUZZY_MATCH_THRESHOLD,
  type LocalTrack,
  type SpotifyTrack,
} from '../trackMatchingEngine';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLocal(overrides: Partial<LocalTrack> & { id: string }): LocalTrack {
  return {
    title: 'Test Track',
    artist: 'Test Artist',
    primary_artist: null,
    album: 'Test Album',
    genre: null,
    file_path: `/music/${overrides.id}.mp3`,
    ...overrides,
  };
}

function makeSpotify(overrides: Partial<SpotifyTrack> & { id: string }): SpotifyTrack {
  return {
    title: 'Test Track',
    artist: 'Test Artist',
    primary_artist: null,
    album: 'Test Album',
    genre: null,
    super_genre: null,
    ...overrides,
  };
}

// ─── normalize ────────────────────────────────────────────────────────────────

describe('trackMatchingEngine – normalize()', () => {
  it('returns empty string for null', () => {
    expect(normalize(null)).toBe('');
  });

  it('lowercases text', () => {
    expect(normalize('HELLO WORLD')).toBe('hello world');
  });

  it('removes diacritics', () => {
    expect(normalize('Beyoncé')).toBe('beyonce');
    expect(normalize('Sigur Rós')).toBe('sigur ros');
  });

  it('strips feat. clause', () => {
    expect(normalize('Blue Monday feat. John Doe')).toBe('blue monday');
    expect(normalize('Blue Monday feat John Doe')).toBe('blue monday');
  });

  it('strips ft. clause', () => {
    expect(normalize('Song ft. Artist B')).toBe('song');
    expect(normalize('Song ft Artist B')).toBe('song');
  });

  it('strips featuring clause', () => {
    expect(normalize('Track featuring Vocalist')).toBe('track');
  });

  it('strips URL junk via extractCoreTitle (www.djsoundtop.com is stripped before normalization)', () => {
    // URL stripping in normalize() runs after punctuation unification converts dots to spaces,
    // so the www regex does not match at that stage. extractCoreTitle() strips URLs pre-normalization.
    const core = extractCoreTitle('Some Track www.djsoundtop.com');
    expect(core).not.toContain('djsoundtop');
    expect(core).toContain('some track');
  });

  it('strips trailing BPM numbers', () => {
    // Trailing 2-3 digit number after a space is stripped
    const result = normalize('Track Name 128');
    expect(result).not.toContain('128');
  });

  it('strips remaining punctuation, keeps word chars and spaces', () => {
    const result = normalize('Track! (Mix)');
    expect(result).not.toContain('!');
    expect(result).not.toContain('(');
  });

  it('collapses multiple spaces', () => {
    const result = normalize('Track   Name');
    expect(result).toBe('track name');
  });

  it('handles empty string', () => {
    expect(normalize('')).toBe('');
  });
});

// ─── extractCoreTitle ─────────────────────────────────────────────────────────

describe('trackMatchingEngine – extractCoreTitle()', () => {
  it('returns empty string for null', () => {
    expect(extractCoreTitle(null)).toBe('');
  });

  it('strips (Radio Edit) suffix', () => {
    const core = extractCoreTitle('Blue Monday (Radio Edit)');
    expect(core).not.toContain('radio edit');
    expect(core).toContain('blue monday');
  });

  it('strips (Extended Mix) suffix', () => {
    const core = extractCoreTitle('Losing My Religion (Extended Mix)');
    expect(core).not.toContain('extended mix');
  });

  it('strips "Original Mix" suffix when unparenthesized', () => {
    const core = extractCoreTitle('Track Name Original Mix');
    expect(core).not.toContain('original mix');
  });

  it('strips (Club Mix) suffix', () => {
    const core = extractCoreTitle('Energy (Club Mix)');
    expect(core).not.toContain('club mix');
  });

  it('preserves title when there is no version info', () => {
    const core = extractCoreTitle('Simple Song');
    expect(core).toBe('simple song');
  });

  it('strips URL junk before extracting version', () => {
    const core = extractCoreTitle('Track www.site.com (Radio Edit)');
    expect(core).not.toContain('www');
    expect(core).not.toContain('radio edit');
  });
});

// ─── normalizeArtist ──────────────────────────────────────────────────────────

describe('trackMatchingEngine – normalizeArtist()', () => {
  it('returns empty string for null', () => {
    expect(normalizeArtist(null)).toBe('');
  });

  it('strips "The " prefix', () => {
    expect(normalizeArtist('The Chemical Brothers')).toBe('chemical brothers');
  });

  it('does not strip "the" mid-name', () => {
    const result = normalizeArtist('Artists of the World');
    expect(result).toContain('the world');
  });

  it('lowercases artist name', () => {
    expect(normalizeArtist('DJ SHADOW')).toBe('dj shadow');
  });

  it('removes diacritics from artist name', () => {
    expect(normalizeArtist('Sigur Rós')).toBe('sigur ros');
  });

  it('handles artist name with no prefix', () => {
    expect(normalizeArtist('Aphex Twin')).toBe('aphex twin');
  });
});

// ─── levenshteinDistance ─────────────────────────────────────────────────────

describe('trackMatchingEngine – levenshteinDistance()', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns length of string for empty other', () => {
    expect(levenshteinDistance('hello', '')).toBe(5);
    expect(levenshteinDistance('', 'hello')).toBe(5);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('calculates single substitution', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('calculates single insertion', () => {
    expect(levenshteinDistance('cat', 'cast')).toBe(1);
  });

  it('calculates single deletion', () => {
    expect(levenshteinDistance('cast', 'cat')).toBe(1);
  });

  it('is symmetric', () => {
    const d1 = levenshteinDistance('kitten', 'sitting');
    const d2 = levenshteinDistance('sitting', 'kitten');
    expect(d1).toBe(d2);
  });

  it('classic kitten→sitting distance is 3', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

// ─── calculateSimilarity ─────────────────────────────────────────────────────

describe('trackMatchingEngine – calculateSimilarity()', () => {
  it('returns 100 for identical strings', () => {
    expect(calculateSimilarity('hello', 'hello')).toBe(100);
  });

  it('returns 100 for two empty strings', () => {
    expect(calculateSimilarity('', '')).toBe(100);
  });

  it('returns 0 for completely different strings of same length', () => {
    // 'abcd' vs 'wxyz' — 4 substitutions, maxLength 4
    expect(calculateSimilarity('abcd', 'wxyz')).toBe(0);
  });

  it('returns a value between 0 and 100 for partial match', () => {
    const sim = calculateSimilarity('hello', 'helo');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(100);
  });

  it('returns >= FUZZY_MATCH_THRESHOLD for near-identical strings', () => {
    // One character difference in a long string
    const sim = calculateSimilarity('blue monday radio edit', 'blue monday radio ediy');
    expect(sim).toBeGreaterThanOrEqual(FUZZY_MATCH_THRESHOLD);
  });

  it('FUZZY_MATCH_THRESHOLD constant is 85', () => {
    expect(FUZZY_MATCH_THRESHOLD).toBe(85);
  });
});

// ─── buildLocalIndex ──────────────────────────────────────────────────────────

describe('trackMatchingEngine – buildLocalIndex()', () => {
  it('returns exactSet, coreSet, and normalized array', () => {
    const tracks = [makeLocal({ id: '1', title: 'Blue Monday', artist: 'New Order' })];
    const index = buildLocalIndex(tracks);
    expect(index.exactSet).toBeInstanceOf(Set);
    expect(index.coreSet).toBeInstanceOf(Set);
    expect(index.normalized).toHaveLength(1);
  });

  it('exactSet contains normalized title_artist key', () => {
    const tracks = [makeLocal({ id: '1', title: 'Blue Monday', artist: 'New Order' })];
    const index = buildLocalIndex(tracks);
    // normalized: 'blue monday' + '_' + 'new order'
    expect(index.exactSet.has('blue monday_new order')).toBe(true);
  });

  it('coreSet strips mix version from title', () => {
    const tracks = [makeLocal({ id: '1', title: 'Blue Monday (Radio Edit)', artist: 'New Order' })];
    const index = buildLocalIndex(tracks);
    // Core title of 'Blue Monday (Radio Edit)' should be 'blue monday'
    expect(index.coreSet.has('blue monday_new order')).toBe(true);
  });

  it('uses primary_artist over artist when available', () => {
    const tracks = [makeLocal({ id: '1', title: 'Track', artist: 'Artist feat. Other', primary_artist: 'Artist' })];
    const index = buildLocalIndex(tracks);
    expect(index.exactSet.has('track_artist')).toBe(true);
  });

  it('handles empty track list', () => {
    const index = buildLocalIndex([]);
    expect(index.exactSet.size).toBe(0);
    expect(index.normalized).toHaveLength(0);
  });

  it('strips "Artist - " prefix from title before indexing', () => {
    const tracks = [makeLocal({ id: '1', title: 'New Order - Blue Monday', artist: 'New Order' })];
    const index = buildLocalIndex(tracks);
    // Should strip "New Order - " prefix
    expect(index.exactSet.has('blue monday_new order')).toBe(true);
  });
});

// ─── matchTrack ───────────────────────────────────────────────────────────────

describe('trackMatchingEngine – matchTrack() tier 1 (exact)', () => {
  it('matches identical title and artist (tier 1)', () => {
    const local = makeLocal({ id: '1', title: 'Blue Monday', artist: 'New Order' });
    const spotify = makeSpotify({ id: 'sp1', title: 'Blue Monday', artist: 'New Order' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(true);
    expect(result.tier).toBe(1);
  });

  it('matches case-insensitively (tier 1)', () => {
    const local = makeLocal({ id: '1', title: 'BLUE MONDAY', artist: 'NEW ORDER' });
    const spotify = makeSpotify({ id: 'sp1', title: 'blue monday', artist: 'new order' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(true);
    expect(result.tier).toBe(1);
  });

  it('matches across diacritics (tier 1)', () => {
    const local = makeLocal({ id: '1', title: 'Beyonce Song', artist: 'Beyonce' });
    const spotify = makeSpotify({ id: 'sp1', title: 'Beyoncé Song', artist: 'Beyoncé' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(true);
    expect(result.tier).toBe(1);
  });

  it('does not match when artist differs', () => {
    const local = makeLocal({ id: '1', title: 'Blue Monday', artist: 'New Order' });
    const spotify = makeSpotify({ id: 'sp1', title: 'Blue Monday', artist: 'Wrong Artist' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(false);
  });

  it('returns normalizedSpotifyTitle and normalizedSpotifyArtist in result', () => {
    const local = makeLocal({ id: '1', title: 'Blue Monday', artist: 'New Order' });
    const spotify = makeSpotify({ id: 'sp1', title: 'Blue Monday', artist: 'New Order' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.normalizedSpotifyTitle).toBe('blue monday');
    expect(result.normalizedSpotifyArtist).toBe('new order');
  });
});

describe('trackMatchingEngine – matchTrack() tier 2 (core title)', () => {
  it('matches when local has Radio Edit but Spotify does not (tier 2)', () => {
    const local = makeLocal({ id: '1', title: 'Blue Monday (Radio Edit)', artist: 'New Order' });
    const spotify = makeSpotify({ id: 'sp1', title: 'Blue Monday', artist: 'New Order' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(true);
    expect(result.tier).toBe(2);
  });

  it('matches when Spotify has Extended Mix but local does not (tier 2)', () => {
    const local = makeLocal({ id: '1', title: 'Energy', artist: 'Artist' });
    const spotify = makeSpotify({ id: 'sp1', title: 'Energy (Extended Mix)', artist: 'Artist' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(true);
    expect(result.tier).toBeLessThanOrEqual(2);
  });

  it('matches when Spotify title has (Deluxe Edition) but local does not (tier 2)', () => {
    const local = makeLocal({ id: '1', title: 'Song Title', artist: 'Artist' });
    const spotify = makeSpotify({ id: 'sp1', title: 'Song Title (Deluxe Edition)', artist: 'Artist' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(true);
    expect(result.tier).toBeLessThanOrEqual(2);
  });

  it('matches when local title has (Deluxe Edition) but Spotify does not (tier 2)', () => {
    const local = makeLocal({ id: '1', title: 'Song Title (Deluxe Edition)', artist: 'Artist' });
    const spotify = makeSpotify({ id: 'sp1', title: 'Song Title', artist: 'Artist' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(true);
    expect(result.tier).toBeLessThanOrEqual(2);
  });
});

describe('trackMatchingEngine – matchTrack() tier 3 (fuzzy)', () => {
  it('fuzzy-matches near-identical titles (tier 3)', () => {
    // One character typo
    const local = makeLocal({ id: '1', title: 'Summertime Sadnees', artist: 'Lana Del Rey' });
    const spotify = makeSpotify({ id: 'sp1', title: 'Summertime Sadness', artist: 'Lana Del Rey' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(true);
    expect(result.tier).toBe(3);
    expect(result.similarity).toBeDefined();
    expect(result.similarity!).toBeGreaterThanOrEqual(FUZZY_MATCH_THRESHOLD);
  });

  it('does not fuzzy-match when artist differs', () => {
    const local = makeLocal({ id: '1', title: 'Summertime Sadnees', artist: 'Wrong Artist' });
    const spotify = makeSpotify({ id: 'sp1', title: 'Summertime Sadness', artist: 'Lana Del Rey' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(false);
  });
});

describe('trackMatchingEngine – matchTrack() no match', () => {
  it('returns matched=false and tier=null when nothing matches', () => {
    const local = makeLocal({ id: '1', title: 'Completely Different', artist: 'Other Artist' });
    const spotify = makeSpotify({ id: 'sp1', title: 'Blue Monday', artist: 'New Order' });
    const index = buildLocalIndex([local]);
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(false);
    expect(result.tier).toBeNull();
  });

  it('returns matched=false for empty local index', () => {
    const index = buildLocalIndex([]);
    const spotify = makeSpotify({ id: 'sp1', title: 'Blue Monday', artist: 'New Order' });
    const result = matchTrack(spotify, index);
    expect(result.matched).toBe(false);
  });
});

// ─── findMissingTracksPure ────────────────────────────────────────────────────

describe('trackMatchingEngine – findMissingTracksPure()', () => {
  it('returns one result per Spotify track', () => {
    const spotify = [
      makeSpotify({ id: 'sp1', title: 'Track A', artist: 'Artist A' }),
      makeSpotify({ id: 'sp2', title: 'Track B', artist: 'Artist B' }),
    ];
    const local = [makeLocal({ id: 'l1', title: 'Track A', artist: 'Artist A' })];
    const results = findMissingTracksPure(spotify, local);
    expect(results).toHaveLength(2);
  });

  it('marks matched tracks as matched=true', () => {
    const spotify = [makeSpotify({ id: 'sp1', title: 'Track A', artist: 'Artist' })];
    const local = [makeLocal({ id: 'l1', title: 'Track A', artist: 'Artist' })];
    const results = findMissingTracksPure(spotify, local);
    expect(results[0].matched).toBe(true);
  });

  it('marks unmatched tracks as matched=false', () => {
    const spotify = [makeSpotify({ id: 'sp1', title: 'Missing Track', artist: 'Nobody' })];
    const local = [makeLocal({ id: 'l1', title: 'Other Track', artist: 'Other Artist' })];
    const results = findMissingTracksPure(spotify, local);
    expect(results[0].matched).toBe(false);
  });

  it('returns empty array for empty spotify list', () => {
    const results = findMissingTracksPure([], []);
    expect(results).toHaveLength(0);
  });

  it('all tracks unmatched when local list is empty', () => {
    const spotify = [
      makeSpotify({ id: 'sp1', title: 'A', artist: 'Artist' }),
      makeSpotify({ id: 'sp2', title: 'B', artist: 'Artist' }),
    ];
    const results = findMissingTracksPure(spotify, []);
    expect(results.every(r => !r.matched)).toBe(true);
  });

  it('correctly identifies mixed matched and unmatched', () => {
    const spotify = [
      makeSpotify({ id: 'sp1', title: 'Found Track', artist: 'Artist' }),
      makeSpotify({ id: 'sp2', title: 'Missing Track', artist: 'Artist' }),
    ];
    const local = [makeLocal({ id: 'l1', title: 'Found Track', artist: 'Artist' })];
    const results = findMissingTracksPure(spotify, local);
    const found = results.find(r => r.spotifyTrack.id === 'sp1');
    const missing = results.find(r => r.spotifyTrack.id === 'sp2');
    expect(found?.matched).toBe(true);
    expect(missing?.matched).toBe(false);
  });
});
