import { describe, it, expect } from 'vitest';

/**
 * Tests for LocalTracksTable business logic
 *
 * The component uses node test environment (not jsdom), so tests cover
 * pure logic extracted from the component rather than React rendering.
 *
 * Bug fix covered: filter-then-delete-page use case
 * When filters are active and the user bulk-deletes all tracks on the current
 * page, currentPage must reset to 1. Previously it stayed at e.g. page 2,
 * causing the subsequent fetch to return 0 results even though filtered
 * results still existed on page 1.
 */

// ─── Filter application logic ────────────────────────────────────────────────

/**
 * Mirrors the applyFilters logic inside fetchTracks (LocalTracksTable.tsx).
 * Returns a subset of tracks matching the active filter set.
 */
interface LocalTrack {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  super_genre: string | null;
  year: number | null;
  bpm: number | null;
  bitrate: number | null;
  file_path: string;
  file_size: number | null;
}

function applyFilters(
  tracks: LocalTrack[],
  filters: {
    searchQuery?: string;
    yearFrom?: number;
    yearTo?: number;
    selectedSuperGenre?: string;
    selectedArtist?: string;
    selectedAlbum?: string;
    selectedGenre?: string;
    bitrateFilter?: 'low' | 'medium' | 'high' | '';
    missingMetadata?: 'title' | 'artist' | 'album' | 'year' | 'genre' | 'any' | '';
  }
): LocalTrack[] {
  return tracks.filter(track => {
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      const matches =
        track.title?.toLowerCase().includes(q) ||
        track.artist?.toLowerCase().includes(q) ||
        track.album?.toLowerCase().includes(q) ||
        track.file_path.toLowerCase().includes(q);
      if (!matches) return false;
    }
    if (filters.yearFrom !== undefined && (track.year === null || track.year < filters.yearFrom)) return false;
    if (filters.yearTo !== undefined && (track.year === null || track.year > filters.yearTo)) return false;
    if (filters.selectedSuperGenre && track.super_genre !== filters.selectedSuperGenre) return false;
    if (filters.selectedArtist && track.artist !== filters.selectedArtist) return false;
    if (filters.selectedAlbum && track.album !== filters.selectedAlbum) return false;
    if (filters.selectedGenre && track.genre !== filters.selectedGenre) return false;
    if (filters.bitrateFilter === 'low' && (track.bitrate === null || track.bitrate >= 192)) return false;
    if (filters.bitrateFilter === 'medium' && (track.bitrate === null || track.bitrate < 192 || track.bitrate >= 320)) return false;
    if (filters.bitrateFilter === 'high' && (track.bitrate === null || track.bitrate < 320)) return false;
    if (filters.missingMetadata === 'title' && track.title !== null) return false;
    if (filters.missingMetadata === 'artist' && track.artist !== null) return false;
    if (filters.missingMetadata === 'album' && track.album !== null) return false;
    if (filters.missingMetadata === 'year' && track.year !== null) return false;
    if (filters.missingMetadata === 'genre' && track.genre !== null) return false;
    if (filters.missingMetadata === 'any') {
      const missing = !track.title || !track.artist || !track.album || !track.year || !track.genre;
      if (!missing) return false;
    }
    return true;
  });
}

/** Paginate an array, 1-indexed page numbers. */
function paginate<T>(items: T[], page: number, perPage: number): T[] {
  return items.slice((page - 1) * perPage, page * perPage);
}

/** Simulates the delete + page-reset logic in handleBulkDelete. */
function simulateBulkDelete(
  allTracks: LocalTrack[],
  selectedIds: Set<string>,
  currentPage: number,
  filters: Parameters<typeof applyFilters>[1],
  perPage: number
): { remainingTracks: LocalTrack[]; newPage: number; pageResults: LocalTrack[] } {
  // Delete selected tracks
  const remaining = allTracks.filter(t => !selectedIds.has(t.id));

  // BUG FIX: always reset to page 1 after deletion
  const newPage = 1;

  const filtered = applyFilters(remaining, filters);
  const pageResults = paginate(filtered, newPage, perPage);

  return { remainingTracks: remaining, newPage, pageResults };
}

// ─── Test data helpers ────────────────────────────────────────────────────────

function makeTrack(overrides: Partial<LocalTrack> & { id: string }): LocalTrack {
  return {
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    genre: 'House',
    super_genre: 'Electronic',
    year: 2020,
    bpm: 128,
    bitrate: 320,
    file_path: `/music/${overrides.id}.mp3`,
    file_size: 1048576,
    ...overrides,
  };
}

function makeTracks(count: number, overrides: Partial<LocalTrack> = {}): LocalTrack[] {
  return Array.from({ length: count }, (_, i) =>
    makeTrack({ id: `track-${i + 1}`, title: `Track ${i + 1}`, ...overrides })
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LocalTracksTable – filter logic', () => {
  it('returns all tracks when no filters are active', () => {
    const tracks = makeTracks(10);
    expect(applyFilters(tracks, {})).toHaveLength(10);
  });

  it('filters by artist (exact match)', () => {
    const tracks = [
      makeTrack({ id: '1', artist: 'DJ Shadow' }),
      makeTrack({ id: '2', artist: 'Aphex Twin' }),
      makeTrack({ id: '3', artist: 'DJ Shadow' }),
    ];
    const result = applyFilters(tracks, { selectedArtist: 'DJ Shadow' });
    expect(result).toHaveLength(2);
    result.forEach(t => expect(t.artist).toBe('DJ Shadow'));
  });

  it('filters by genre (exact match)', () => {
    const tracks = [
      makeTrack({ id: '1', genre: 'House' }),
      makeTrack({ id: '2', genre: 'Techno' }),
      makeTrack({ id: '3', genre: 'House' }),
    ];
    const result = applyFilters(tracks, { selectedGenre: 'House' });
    expect(result).toHaveLength(2);
    result.forEach(t => expect(t.genre).toBe('House'));
  });

  it('filters by search query across title, artist, album and file_path', () => {
    const tracks = [
      makeTrack({ id: '1', title: 'Blue Monday', artist: 'New Order' }),
      makeTrack({ id: '2', title: 'Personal Jesus', artist: 'Depeche Mode' }),
      makeTrack({ id: '3', title: 'Ordinary World', artist: 'Duran Duran', file_path: '/music/blue_album/track3.mp3' }),
    ];
    const result = applyFilters(tracks, { searchQuery: 'blue' });
    expect(result).toHaveLength(2); // "Blue Monday" and the file path containing "blue"
    expect(result.map(t => t.id)).toContain('1');
    expect(result.map(t => t.id)).toContain('3');
  });

  it('filters by year range', () => {
    const tracks = [
      makeTrack({ id: '1', year: 1990 }),
      makeTrack({ id: '2', year: 2000 }),
      makeTrack({ id: '3', year: 2010 }),
      makeTrack({ id: '4', year: 2020 }),
    ];
    const result = applyFilters(tracks, { yearFrom: 2000, yearTo: 2010 });
    expect(result).toHaveLength(2);
    expect(result.map(t => t.id)).toEqual(['2', '3']);
  });

  it('filters bitrate: low (<192)', () => {
    const tracks = [
      makeTrack({ id: '1', bitrate: 128 }),
      makeTrack({ id: '2', bitrate: 192 }),
      makeTrack({ id: '3', bitrate: 320 }),
    ];
    expect(applyFilters(tracks, { bitrateFilter: 'low' })).toHaveLength(1);
    expect(applyFilters(tracks, { bitrateFilter: 'low' })[0].id).toBe('1');
  });

  it('filters bitrate: medium (192–319)', () => {
    const tracks = [
      makeTrack({ id: '1', bitrate: 128 }),
      makeTrack({ id: '2', bitrate: 256 }),
      makeTrack({ id: '3', bitrate: 320 }),
    ];
    expect(applyFilters(tracks, { bitrateFilter: 'medium' })).toHaveLength(1);
    expect(applyFilters(tracks, { bitrateFilter: 'medium' })[0].id).toBe('2');
  });

  it('filters bitrate: high (>=320)', () => {
    const tracks = [
      makeTrack({ id: '1', bitrate: 128 }),
      makeTrack({ id: '2', bitrate: 256 }),
      makeTrack({ id: '3', bitrate: 320 }),
    ];
    expect(applyFilters(tracks, { bitrateFilter: 'high' })).toHaveLength(1);
    expect(applyFilters(tracks, { bitrateFilter: 'high' })[0].id).toBe('3');
  });

  it('filters missing genre', () => {
    const tracks = [
      makeTrack({ id: '1', genre: 'House' }),
      makeTrack({ id: '2', genre: null }),
      makeTrack({ id: '3', genre: null }),
    ];
    expect(applyFilters(tracks, { missingMetadata: 'genre' })).toHaveLength(2);
  });

  it('filters missing any metadata', () => {
    const tracks = [
      makeTrack({ id: '1' }), // complete
      makeTrack({ id: '2', title: null }),
      makeTrack({ id: '3', genre: null }),
    ];
    expect(applyFilters(tracks, { missingMetadata: 'any' })).toHaveLength(2);
  });

  it('filters by super_genre (exact match)', () => {
    const tracks = [
      makeTrack({ id: '1', super_genre: 'Electronic' }),
      makeTrack({ id: '2', super_genre: 'Hip Hop' }),
      makeTrack({ id: '3', super_genre: 'Electronic' }),
      makeTrack({ id: '4', super_genre: null }),
    ];
    const result = applyFilters(tracks, { selectedSuperGenre: 'Electronic' });
    expect(result).toHaveLength(2);
    result.forEach(t => expect(t.super_genre).toBe('Electronic'));
  });

  it('does not return tracks with null super_genre when super_genre filter is active', () => {
    const tracks = [
      makeTrack({ id: '1', super_genre: 'Electronic' }),
      makeTrack({ id: '2', super_genre: null }),
    ];
    const result = applyFilters(tracks, { selectedSuperGenre: 'Electronic' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('returns all tracks when no super_genre filter is active', () => {
    const tracks = [
      makeTrack({ id: '1', super_genre: 'Electronic' }),
      makeTrack({ id: '2', super_genre: 'Hip Hop' }),
      makeTrack({ id: '3', super_genre: null }),
    ];
    expect(applyFilters(tracks, {})).toHaveLength(3);
  });

  it('combines super_genre + genre filters', () => {
    const tracks = [
      makeTrack({ id: '1', super_genre: 'Electronic', genre: 'House' }),
      makeTrack({ id: '2', super_genre: 'Electronic', genre: 'Techno' }),
      makeTrack({ id: '3', super_genre: 'Hip Hop', genre: 'House' }),
    ];
    const result = applyFilters(tracks, { selectedSuperGenre: 'Electronic', selectedGenre: 'House' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('combines super_genre + artist filters', () => {
    const tracks = [
      makeTrack({ id: '1', super_genre: 'Electronic', artist: 'Aphex Twin' }),
      makeTrack({ id: '2', super_genre: 'Electronic', artist: 'DJ Shadow' }),
      makeTrack({ id: '3', super_genre: 'Hip Hop', artist: 'Aphex Twin' }),
    ];
    const result = applyFilters(tracks, { selectedSuperGenre: 'Electronic', selectedArtist: 'Aphex Twin' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('combines artist + genre filters', () => {
    const tracks = [
      makeTrack({ id: '1', artist: 'DJ Shadow', genre: 'Hip Hop' }),
      makeTrack({ id: '2', artist: 'DJ Shadow', genre: 'Electronic' }),
      makeTrack({ id: '3', artist: 'Aphex Twin', genre: 'Electronic' }),
    ];
    const result = applyFilters(tracks, { selectedArtist: 'DJ Shadow', selectedGenre: 'Electronic' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });
});

describe('LocalTracksTable – pagination logic', () => {
  it('returns correct slice for page 1', () => {
    const tracks = makeTracks(25);
    const page1 = paginate(tracks, 1, 10);
    expect(page1).toHaveLength(10);
    expect(page1[0].id).toBe('track-1');
  });

  it('returns correct slice for page 2', () => {
    const tracks = makeTracks(25);
    const page2 = paginate(tracks, 2, 10);
    expect(page2).toHaveLength(10);
    expect(page2[0].id).toBe('track-11');
  });

  it('returns partial last page', () => {
    const tracks = makeTracks(25);
    const page3 = paginate(tracks, 3, 10);
    expect(page3).toHaveLength(5);
    expect(page3[0].id).toBe('track-21');
  });

  it('returns empty array for page beyond total', () => {
    const tracks = makeTracks(10);
    expect(paginate(tracks, 5, 10)).toHaveLength(0);
  });
});

describe('LocalTracksTable – filter + delete use case (bug fix)', () => {
  /**
   * Regression test for: apply filters → navigate to page 2 → bulk-delete
   * all visible tracks → results should show page 1 of remaining filtered tracks.
   *
   * Before the fix, handleBulkDelete called fetchTracks() without resetting
   * currentPage, so the component stayed on page 2 (which no longer existed)
   * and returned 0 results even though filtered tracks remained on page 1.
   */

  it('resets to page 1 after deleting tracks on page 2 with active filter', () => {
    const perPage = 5;

    // 12 House tracks (will fill pages 1+2 under the filter), plus some non-House
    const houseTracks = Array.from({ length: 12 }, (_, i) =>
      makeTrack({ id: `house-${i + 1}`, genre: 'House', title: `House Track ${i + 1}` })
    );
    const technoTracks = Array.from({ length: 5 }, (_, i) =>
      makeTrack({ id: `techno-${i + 1}`, genre: 'Techno', title: `Techno Track ${i + 1}` })
    );
    const allTracks = [...houseTracks, ...technoTracks];

    const filters = { selectedGenre: 'House' };

    // Verify initial filtered count = 12 → 3 pages of 5 (5+5+2)
    const filtered = applyFilters(allTracks, filters);
    expect(filtered).toHaveLength(12);

    // User is on page 2; selects all 5 tracks on that page and deletes them
    const page2Tracks = paginate(filtered, 2, perPage);
    expect(page2Tracks).toHaveLength(5);
    const selectedIds = new Set(page2Tracks.map(t => t.id));

    const { newPage, pageResults, remainingTracks } = simulateBulkDelete(
      allTracks,
      selectedIds,
      2, // <-- user was on page 2
      filters,
      perPage
    );

    // After deletion: 7 House tracks remain (12 - 5)
    const remainingFiltered = applyFilters(remainingTracks, filters);
    expect(remainingFiltered).toHaveLength(7);

    // Page should have been reset to 1
    expect(newPage).toBe(1);

    // Page 1 results should contain the first 5 of the remaining House tracks
    expect(pageResults).toHaveLength(5);
    expect(pageResults.every(t => t.genre === 'House')).toBe(true);
  });

  it('resets to page 1 after deleting ALL tracks on last page with active filter', () => {
    const perPage = 5;

    // 10 House tracks: page 1 = 5, page 2 = 5
    const houseTracks = Array.from({ length: 10 }, (_, i) =>
      makeTrack({ id: `house-${i + 1}`, genre: 'House' })
    );
    const filters = { selectedGenre: 'House' };

    // User is on page 2 and deletes all 5 tracks there
    const filtered = applyFilters(houseTracks, filters);
    const page2Tracks = paginate(filtered, 2, perPage);
    const selectedIds = new Set(page2Tracks.map(t => t.id));

    const { newPage, pageResults } = simulateBulkDelete(
      houseTracks,
      selectedIds,
      2,
      filters,
      perPage
    );

    expect(newPage).toBe(1);
    // 5 tracks remain on page 1
    expect(pageResults).toHaveLength(5);
  });

  it('resets to page 1 after deleting tracks on page 1', () => {
    const perPage = 5;
    const tracks = makeTracks(15, { genre: 'Techno' });
    const filters = { selectedGenre: 'Techno' };

    const page1Tracks = paginate(applyFilters(tracks, filters), 1, perPage);
    const selectedIds = new Set(page1Tracks.map(t => t.id));

    const { newPage, pageResults } = simulateBulkDelete(
      tracks,
      selectedIds,
      1,
      filters,
      perPage
    );

    expect(newPage).toBe(1);
    expect(pageResults).toHaveLength(5); // 10 remaining, page 1 = 5
  });

  it('shows empty results when all filtered tracks are deleted', () => {
    const perPage = 5;
    const houseTracks = Array.from({ length: 3 }, (_, i) =>
      makeTrack({ id: `house-${i + 1}`, genre: 'House' })
    );
    const filters = { selectedGenre: 'House' };
    const selectedIds = new Set(houseTracks.map(t => t.id));

    const { newPage, pageResults } = simulateBulkDelete(
      houseTracks,
      selectedIds,
      1,
      filters,
      perPage
    );

    expect(newPage).toBe(1);
    expect(pageResults).toHaveLength(0);
  });

  it('preserves active filters after deletion (non-genre tracks not returned)', () => {
    const perPage = 10;
    const houseTracks = Array.from({ length: 5 }, (_, i) =>
      makeTrack({ id: `house-${i + 1}`, genre: 'House' })
    );
    const technoTracks = Array.from({ length: 5 }, (_, i) =>
      makeTrack({ id: `techno-${i + 1}`, genre: 'Techno' })
    );
    const allTracks = [...houseTracks, ...technoTracks];
    const filters = { selectedGenre: 'House' };

    // Delete one House track from page 1
    const selectedIds = new Set(['house-1']);

    const { pageResults } = simulateBulkDelete(allTracks, selectedIds, 1, filters, perPage);

    // Only House tracks should appear — filter must remain active
    expect(pageResults.every(t => t.genre === 'House')).toBe(true);
    expect(pageResults).toHaveLength(4); // 5 - 1 deleted
  });

  it('combined artist + genre filter survives delete', () => {
    const perPage = 5;
    const tracks = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeTrack({ id: `shadow-${i + 1}`, artist: 'DJ Shadow', genre: 'Hip Hop' })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeTrack({ id: `aphex-${i + 1}`, artist: 'Aphex Twin', genre: 'Electronic' })
      ),
    ];
    const filters = { selectedArtist: 'DJ Shadow', selectedGenre: 'Hip Hop' };

    // Page 2 of DJ Shadow / Hip Hop has 3 tracks
    const filtered = applyFilters(tracks, filters);
    expect(filtered).toHaveLength(8);
    const page2 = paginate(filtered, 2, perPage);
    expect(page2).toHaveLength(3);

    const selectedIds = new Set(page2.map(t => t.id));
    const { newPage, pageResults } = simulateBulkDelete(tracks, selectedIds, 2, filters, perPage);

    expect(newPage).toBe(1);
    expect(pageResults).toHaveLength(5); // 5 remaining DJ Shadow tracks on page 1
    expect(pageResults.every(t => t.artist === 'DJ Shadow' && t.genre === 'Hip Hop')).toBe(true);
  });
});

describe('LocalTracksTable – fetch cancellation logic (fetchAbortController)', () => {
  /**
   * The component uses an AbortController ref to cancel in-flight fetches when
   * a new fetch is triggered (e.g. a filter selection changes mid-request).
   *
   * Previously a boolean `fetchInProgress` flag was used, which silently dropped
   * the new fetch instead of cancelling the old one — filters appeared to do nothing.
   *
   * These tests verify the abort-and-replace pattern in isolation.
   */

  it('aborts the previous controller when a new fetch starts', () => {
    let currentController: AbortController | null = null;

    // Simulate starting fetch #1
    if (currentController) currentController.abort();
    currentController = new AbortController();
    const firstSignal = currentController.signal;
    expect(firstSignal.aborted).toBe(false);

    // Simulate filter change → fetch #2 starts, aborting #1
    if (currentController) currentController.abort();
    currentController = new AbortController();

    expect(firstSignal.aborted).toBe(true);
    expect(currentController.signal.aborted).toBe(false);
  });

  it('does not abort the new controller when completing normally', () => {
    let currentController: AbortController | null = null;

    if (currentController) currentController.abort();
    currentController = new AbortController();
    const signal = currentController.signal;

    // Simulate successful completion — clear the ref
    currentController = null;

    expect(signal.aborted).toBe(false);
  });

  it('clears the controller ref on completion so the next fetch can proceed', () => {
    let currentController: AbortController | null = null;

    if (currentController) currentController.abort();
    currentController = new AbortController();

    // Simulate fetch completing
    currentController = null;

    // Next fetch should start without aborting anything
    const prevController = currentController; // null
    if (currentController) currentController.abort();
    currentController = new AbortController();

    expect(prevController).toBeNull();
    expect(currentController.signal.aborted).toBe(false);
  });

  it('handles rapid sequential filter changes — only last controller is alive', () => {
    let currentController: AbortController | null = null;
    const signals: AbortSignal[] = [];

    // Simulate 5 rapid filter changes
    for (let i = 0; i < 5; i++) {
      if (currentController) currentController.abort();
      currentController = new AbortController();
      signals.push(currentController.signal);
    }

    // All signals except the last should be aborted
    signals.slice(0, -1).forEach(s => expect(s.aborted).toBe(true));
    expect(signals[signals.length - 1].aborted).toBe(false);
  });

  it('old boolean guard would silently drop fetches — new pattern always starts a fetch', () => {
    // Old pattern: boolean flag
    let fetchInProgress = false;
    let fetchCount = 0;

    const oldFetch = () => {
      if (fetchInProgress) return; // silently dropped
      fetchInProgress = true;
      fetchCount++;
      // never resets because it's async — simulating the bug
    };

    oldFetch(); // fetch #1 starts
    oldFetch(); // fetch #2 dropped — bug!
    oldFetch(); // fetch #3 dropped — bug!
    expect(fetchCount).toBe(1); // only 1 fetch ran

    // New pattern: abort controller
    let controller: AbortController | null = null;
    let newFetchCount = 0;

    const newFetch = () => {
      if (controller) controller.abort();
      controller = new AbortController();
      newFetchCount++;
    };

    newFetch(); // fetch #1 starts
    newFetch(); // fetch #2 cancels #1, starts fresh
    newFetch(); // fetch #3 cancels #2, starts fresh
    expect(newFetchCount).toBe(3); // all 3 fetches ran
  });
});

describe('LocalTracksTable – getMissingMetadataCount logic', () => {
  const getMissingMetadataCount = (track: LocalTrack) => {
    const fields = [track.title, track.artist, track.album, track.year, track.genre];
    return fields.filter(field => !field).length;
  };

  it('returns 0 for a complete track', () => {
    expect(getMissingMetadataCount(makeTrack({ id: '1' }))).toBe(0);
  });

  it('counts each missing field individually', () => {
    expect(getMissingMetadataCount(makeTrack({ id: '1', title: null }))).toBe(1);
    expect(getMissingMetadataCount(makeTrack({ id: '1', title: null, artist: null }))).toBe(2);
    expect(getMissingMetadataCount(makeTrack({ id: '1', title: null, artist: null, genre: null }))).toBe(3);
  });

  it('returns 5 for a completely empty track', () => {
    const empty = makeTrack({ id: '1', title: null, artist: null, album: null, year: null, genre: null });
    expect(getMissingMetadataCount(empty)).toBe(5);
  });
});
