import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmedMissingSection } from '@/components/ReviewMatches/ConfirmedMissingSection';
import {
  CSV_COLUMNS,
  buildMissingTracksCsv,
  genreEditTrack,
  groupByArtist,
  groupTracksByAlbum,
  missingTracksCsvFileName,
  selectedGroups,
  slskdAlbumTrack,
  slskdTracksForGroups,
} from '@/components/ReviewMatches/confirmedMissing.utils';
import { useSlskdConfig } from '@/hooks/useSlskdConfig';
import type { ConfirmedMissingTrack } from '@/services/manualMatch.service';
import { SlskdClientService } from '@/services/slskdClient.service';
import type { SpotifyTrack } from '@/services/trackMatchingEngine';
import type { SlskdConfig, SlskdSearchResponse } from '@/types/slskd';

/**
 * Tests for the Confirmed Missing section (MAK-181). The CSV, grouping and slskd cases moved
 * here from the old Missing Tracks tab tests. The suite runs without a DOM, so the section is
 * rendered to static markup and its handlers are tested through the pure helpers they call.
 */

vi.mock('@/hooks/useSlskdConfig', () => ({ useSlskdConfig: vi.fn() }));
vi.mock('@/hooks/useSlskdSync', () => ({
  useSlskdSync: () => ({
    syncToSlskd: vi.fn(),
    syncAlbumToSlskd: vi.fn(),
    isSyncing: false,
    syncResult: undefined,
    syncError: null,
    progress: null,
    reset: vi.fn(),
  }),
}));

function missing(
  id: string,
  title: string,
  artist: string,
  album: string | null,
  extra: Partial<SpotifyTrack> = {}
): ConfirmedMissingTrack {
  return {
    trackMatchId: `tm-${id}`,
    spotifyTrack: {
      id, spotify_id: `sp-${id}`, title, artist, primary_artist: artist, album,
      genre: 'deep house', super_genre: 'House', super_genre_manual_override: false, ...extra,
    },
    failureCategory: null,
    notes: null,
    reviewedAt: '2026-11-10T00:00:00.000Z',
  };
}

// Kerri Chandler has three tracks over two albums; Moodymann has one.
const tracks: ConfirmedMissingTrack[] = [
  missing('s1', 'Rain', 'Kerri Chandler', 'Computer Games'),
  missing('s2', 'Black Mahogani', 'Moodymann', 'Black Mahogani', { genre: 'detroit house', super_genre: 'Soul' }),
  missing('s3', 'Atmosphere', 'Kerri Chandler', 'Computer Games'),
  missing('s4', 'Bar A Thym', 'Kerri Chandler', 'Atmosphere EP'),
];

const ids = (list: ConfirmedMissingTrack[]) => list.map(t => t.spotifyTrack.id);

describe('groupByArtist', () => {
  const groups = groupByArtist(tracks);

  it('puts the artist with the most tracks first', () => {
    expect(groups.map(g => g.artist)).toEqual(['Kerri Chandler', 'Moodymann']);
  });

  it('sorts each artist\'s tracks by album, then title', () => {
    expect(ids(groups[0].tracks)).toEqual(['s4', 's3', 's1']);
  });

  it('collects genres and supergenres without repeats', () => {
    expect(groups[0].genres).toEqual(['deep house', 'House']);
    expect(groups[1].genres).toEqual(['detroit house', 'Soul']);
  });

  it('breaks a tie on track count by artist name', () => {
    const tied = groupByArtist([missing('a', 'T', 'Zed', null), missing('b', 'T', 'Ann', null)]);
    expect(tied.map(g => g.artist)).toEqual(['Ann', 'Zed']);
  });
});

describe('groupTracksByAlbum', () => {
  it('splits sorted tracks into runs of the same album', () => {
    const albums = groupTracksByAlbum(groupByArtist(tracks)[0].tracks);
    expect(albums.map(a => [a.album, ids(a.tracks)])).toEqual([
      ['Atmosphere EP', ['s4']],
      ['Computer Games', ['s3', 's1']],
    ]);
  });

  it('keeps tracks with no album together', () => {
    const albums = groupTracksByAlbum([missing('a', 'A', 'X', null), missing('b', 'B', 'X', null)]);
    expect(albums).toHaveLength(1);
    expect(albums[0].album).toBeNull();
  });
});

describe('selectedGroups', () => {
  it('keeps display order, and ignores artists that are no longer in the list', () => {
    const groups = groupByArtist(tracks);
    const picked = selectedGroups(groups, new Set(['Moodymann', 'Kerri Chandler', 'Unliked Artist']));
    expect(picked.map(g => g.artist)).toEqual(['Kerri Chandler', 'Moodymann']);
  });
});

describe('buildMissingTracksCsv', () => {
  it('has the same columns as the old Missing Tracks export', () => {
    const [header] = buildMissingTracksCsv([]).split('\n');
    expect(header).toBe('Artist,Track Count,Track Title,Album,Spotify Genre,Supergenre');
    expect(CSV_COLUMNS).toHaveLength(6);
  });

  it('writes one row per track, with the artist and count on the artist\'s first row only', () => {
    const rows = buildMissingTracksCsv(groupByArtist(tracks)).split('\n');
    expect(rows.slice(1)).toEqual([
      '"Kerri Chandler",3,"Bar A Thym","Atmosphere EP","deep house","House"',
      '"","","Atmosphere","Computer Games","deep house","House"',
      '"","","Rain","Computer Games","deep house","House"',
      '"Moodymann",1,"Black Mahogani","Black Mahogani","detroit house","Soul"',
    ]);
  });

  it('exports only the groups it is given, so a selection exports just those artists', () => {
    const groups = groupByArtist(tracks);
    const rows = buildMissingTracksCsv(selectedGroups(groups, new Set(['Moodymann']))).split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('"Moodymann"');
  });

  it('writes empty cells for a missing album, genre or supergenre', () => {
    const rows = buildMissingTracksCsv(
      groupByArtist([missing('a', 'Untitled', 'X', null, { genre: null, super_genre: null })])
    ).split('\n');
    expect(rows[1]).toBe('"X",1,"Untitled","","",""');
  });

  it('doubles quotes inside a value, so they cannot end the field', () => {
    const rows = buildMissingTracksCsv(groupByArtist([missing('a', 'The "Real" Mix', 'X', null)])).split('\n');
    expect(rows[1]).toContain('"The ""Real"" Mix"');
  });
});

describe('missingTracksCsvFileName', () => {
  it('keeps the old file name pattern, dated in UTC', () => {
    expect(missingTracksCsvFileName(new Date('2026-11-11T23:30:00.000Z'))).toBe('missing-tracks-by-artist-2026-11-11.csv');
  });
});

describe('slskd payload', () => {
  const groups = groupByArtist(tracks);

  it('sends every track of the selected artists, with the full artist as primary_artist', () => {
    const payload = slskdTracksForGroups(selectedGroups(groups, new Set(['Moodymann'])));
    expect(payload).toEqual([
      { id: 's2', title: 'Black Mahogani', artist: 'Moodymann', primary_artist: 'Moodymann' },
    ]);
  });

  it('sends all of a selected artist\'s tracks across their albums, and none of the other artists', () => {
    const payload = slskdTracksForGroups(selectedGroups(groups, new Set(['Kerri Chandler'])));
    expect(payload.map(t => [t.title, t.artist])).toEqual([
      ['Bar A Thym', 'Kerri Chandler'],
      ['Atmosphere', 'Kerri Chandler'],
      ['Rain', 'Kerri Chandler'],
    ]);
  });

  it('sends nothing when no artist is selected', () => {
    expect(slskdTracksForGroups(selectedGroups(groups, new Set()))).toEqual([]);
  });

  it('uses spotify_liked ids, not Spotify ids', () => {
    expect(slskdTracksForGroups(groups).map(t => t.id)).toEqual(['s4', 's3', 's1', 's2']);
  });

  it('pushes an album with its first track and the album name', () => {
    const [, computerGames] = groupTracksByAlbum(groups[0].tracks);
    expect(slskdAlbumTrack(computerGames.tracks, 'Computer Games')).toEqual({
      id: 's3', title: 'Atmosphere', artist: 'Kerri Chandler', primary_artist: 'Kerri Chandler', album: 'Computer Games',
    });
  });
});

/**
 * The Confirmed Missing payload run through the real push code (MAK-216), against a stand-in for
 * slskd's /api/v0/searches that keeps each search Mako starts. Without a DOM the buttons can't be
 * clicked, so these start from the helpers the buttons call.
 */
describe('pushing Confirmed Missing tracks to slskd', () => {
  const slskdConfig = { apiEndpoint: 'http://localhost:5030', apiKey: 'key', searchFormat: 'primary' } as SlskdConfig;

  // Kerri Chandler has three tracks over two albums. The other two artists have one each.
  const groups = groupByArtist([
    missing('p1', 'Rain', 'Kerri Chandler', 'Computer Games'),
    missing('p2', 'Atmosphere', 'Kerri Chandler', 'Computer Games'),
    missing('p3', 'Bar A Thym', 'Kerri Chandler', 'Atmosphere EP'),
    missing('p4', 'Shades of Jae', 'Moodymann feat. Andrés', 'Silence in the Secret Garden'),
    missing('p5', 'Strings of Life', 'Rhythim Is Rhythim', null),
  ]);

  let saved: SlskdSearchResponse[];
  let fetchSpy: MockInstance<typeof fetch>;
  const postedSearchTexts = () =>
    fetchSpy.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)).searchText);

  beforeEach(() => {
    saved = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        const { searchText } = JSON.parse(String(init.body));
        const search = { id: `search-${saved.length + 1}`, searchText, state: 'InProgress' };
        // By the next push it has finished, the way most slskd searches end.
        saved.push({ ...search, state: 'Completed, TimedOut' });
        return new Response(JSON.stringify(search));
      }
      return new Response(JSON.stringify(saved));
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('pushes every track of the 2 selected artists as `Primary Artist - Title`, then skips them all on a second push', async () => {
    const payload = slskdTracksForGroups(selectedGroups(groups, new Set(['Kerri Chandler', 'Moodymann feat. Andrés'])));

    const first = await SlskdClientService.pushTracks(slskdConfig, payload, undefined, 0);
    expect(first).toEqual({ totalTracks: 4, addedCount: 4, skippedCount: 0, failedCount: 0, errors: [] });
    expect(postedSearchTexts()).toEqual([
      'Kerri Chandler - Bar A Thym',
      'Kerri Chandler - Atmosphere',
      'Kerri Chandler - Rain',
      'Moodymann - Shades of Jae',
    ]);
    expect(postedSearchTexts().join('\n')).not.toMatch(/feat|320|mp3|flac/i);

    const second = await SlskdClientService.pushTracks(slskdConfig, payload, undefined, 0);
    expect(second).toEqual({ totalTracks: 4, addedCount: 0, skippedCount: 4, failedCount: 0, errors: [] });
    expect(postedSearchTexts()).toHaveLength(4);
  });

  it('pushes an album as one `Artist - Album` search, however many tracks it has', async () => {
    const [, computerGames] = groupTracksByAlbum(groups[0].tracks);
    expect(computerGames.tracks).toHaveLength(2);

    const { outcome } = await SlskdClientService.pushAlbum(slskdConfig, {
      ...slskdAlbumTrack(computerGames.tracks, 'Computer Games'),
      album: 'Computer Games',
    });

    expect(outcome).toBe('started');
    expect(postedSearchTexts()).toEqual(['Kerri Chandler - Computer Games']);
  });
});

describe('genreEditTrack — Edit SuperGenre dialog track', () => {
  it('maps the confirmed-missing track to the dialog fields', () => {
    expect(genreEditTrack(missing('abc-123', 'Doin It Right', 'Daft Punk', 'Random Access Memories', {
      genre: 'french house', super_genre: 'Electronic',
    }))).toEqual({
      id: 'abc-123',
      title: 'Doin It Right',
      artist: 'Daft Punk',
      genre: 'french house',
      super_genre: 'Electronic',
      super_genre_manual_override: false,
    });
  });

  it('keeps super_genre_manual_override = true for pinned tracks', () => {
    const track = missing('xyz-999', 'Pinned Track', 'Some Artist', null, { super_genre_manual_override: true });
    expect(genreEditTrack(track).super_genre_manual_override).toBe(true);
  });
});

describe('ConfirmedMissingSection — rendering', () => {
  const noop = async () => {};

  function render(list: ConfirmedMissingTrack[]): string {
    return renderToStaticMarkup(
      <ConfirmedMissingSection tracks={list} onUndo={noop} onUnlike={noop} onGenreSaved={() => {}} />
    );
  }

  /** The markup of one artist's card. */
  function artistCard(html: string, artist: string): string {
    const start = html.indexOf(`data-artist="${artist}"`);
    expect(start).toBeGreaterThan(-1);
    const next = html.indexOf('data-artist="', start + 1);
    return html.slice(start, next === -1 ? undefined : next);
  }

  beforeEach(() => {
    vi.mocked(useSlskdConfig).mockReturnValue({ isConfigured: true } as ReturnType<typeof useSlskdConfig>);
  });

  it('shows one card per artist, most tracks first, with a checkbox each', () => {
    const html = render(tracks);
    const artists = [...html.matchAll(/data-artist="([^"]+)"/g)].map(([, a]) => a);
    expect(artists).toEqual(['Kerri Chandler', 'Moodymann']);
    expect(html).toContain('aria-label="Select Kerri Chandler"');
    expect(html).toContain('aria-label="Select Moodymann"');
    expect(html).toContain('4 tracks by 2 artists');
  });

  it('lists each artist\'s tracks under their album, with an actions menu per track', () => {
    const card = artistCard(render(tracks), 'Kerri Chandler');
    expect(card.indexOf('Atmosphere EP')).toBeLessThan(card.indexOf('Computer Games'));
    expect(card.indexOf('Atmosphere</span>')).toBeLessThan(card.indexOf('Rain</span>'));
    expect(card).toContain('aria-label="Actions for Bar A Thym"');
    expect(card.match(/Push album/g)).toHaveLength(2);
  });

  it('shows the pin only on tracks with a manual supergenre', () => {
    const html = render([
      missing('a', 'Pinned', 'X', null, { super_genre_manual_override: true }),
      missing('b', 'Auto', 'Y', null),
    ]);
    expect(artistCard(html, 'X')).toContain('SuperGenre manually overridden');
    expect(artistCard(html, 'Y')).not.toContain('SuperGenre manually overridden');
  });

  it('offers Export CSV, and Push to slskd disabled until an artist is selected', () => {
    const html = render(tracks);
    expect(html).toContain('Export CSV');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Push to slskd/s);
  });

  it('explains how to set up slskd when it is not configured, and hides the album push', () => {
    vi.mocked(useSlskdConfig).mockReturnValue({ isConfigured: false } as ReturnType<typeof useSlskdConfig>);
    const html = render(tracks);
    expect(html).toContain('Configure slskd in Settings → Security');
    expect(html).not.toContain('Push album');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Push to slskd/s);
  });

  it('says where the tracks come from when there are none yet', () => {
    const html = render([]);
    expect(html).toContain('Confirmed Missing');
    expect(html).toContain('Tracks you confirm as missing in the review queue show up here.');
    expect(html).not.toContain('Export CSV');
  });
});
