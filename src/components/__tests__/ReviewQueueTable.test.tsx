import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewQueueTable } from '@/components/ReviewMatches/ReviewQueueTable';
import {
  candidateMatchMethod,
  getRowActions,
  getTierBadge,
  localTrackTitle,
  searchLocalTracks,
  splitByCandidate,
} from '@/components/ReviewMatches/reviewQueue.utils';
import type { ReviewItem } from '@/services/manualMatch.service';
import type { LocalTrack, SpotifyTrack } from '@/services/trackMatchingEngine';

/**
 * Tests for the review queue table (MAK-180). The suite runs without a DOM, so rows are
 * rendered to static markup and the per-row logic is tested through its pure helpers.
 */

function spotify(id: string, title: string, artist: string): SpotifyTrack {
  return {
    id, spotify_id: `sp-${id}`, title, artist, primary_artist: artist, album: 'Album', genre: 'deep house',
    super_genre: 'House', super_genre_manual_override: false,
  };
}

function local(id: string, title: string | null, artist: string | null): LocalTrack {
  return { id, title, artist, primary_artist: artist, album: 'Local Album', genre: null, file_path: `${id}.mp3` };
}

const coreTitleItem: ReviewItem = {
  spotifyTrack: spotify('s2', 'Rain (Remastered)', 'Kerri Chandler'),
  candidate: local('m2', 'Rain', 'Kerri Chandler'),
  tier: 2,
  rejectedMp3Ids: [],
};
const fuzzyItem: ReviewItem = {
  spotifyTrack: spotify('s3', 'Bar A Thym', 'Kerri Chandler'),
  candidate: local('m3', 'Bar A Thyme', 'Kerri Chandler'),
  tier: 3,
  similarity: 86.6,
  rejectedMp3Ids: [],
};
const noMatchItem: ReviewItem = {
  spotifyTrack: spotify('s4', 'Atmosphere', 'Kerri Chandler'),
  candidate: null,
  tier: null,
  rejectedMp3Ids: [],
};

/** The markup of each body row, keyed by its data-tier attribute. */
function renderRows(items: ReviewItem[], pendingIds: string[] = []): Record<string, string> {
  const noop = () => {};
  const html = renderToStaticMarkup(
    <ReviewQueueTable
      items={items}
      localTracks={[]}
      pendingIds={new Set(pendingIds)}
      onConfirm={noop}
      onPick={noop}
      onConfirmMissing={noop}
    />
  );
  const rows: Record<string, string> = {};
  for (const [row, tier] of html.matchAll(/<tr[^>]*data-tier="([^"]+)"[^>]*>.*?<\/tr>/gs)) {
    rows[tier] = row;
  }
  return rows;
}

/** The text of every button in a row, in order. */
function buttonLabels(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<button[^>]*>(.*?)<\/button>/gs)].map(([, inner]) =>
    inner.replace(/<[^>]+>/g, '').trim()
  );
}

describe('ReviewQueueTable — buttons per tier', () => {
  const rows = renderRows([coreTitleItem, fuzzyItem, noMatchItem]);

  it('renders one row per Spotify track', () => {
    expect(Object.keys(rows).sort()).toEqual(['2', '3', 'none']);
  });

  it('offers Confirm, Reject and Confirm Missing on a Core Title row', () => {
    expect(buttonLabels(rows['2'])).toEqual(['Confirm', 'Reject', 'Confirm Missing']);
  });

  it('offers Confirm, Reject and Confirm Missing on a Fuzzy row', () => {
    expect(buttonLabels(rows['3'])).toEqual(['Confirm', 'Reject', 'Confirm Missing']);
  });

  it('offers the picker and Confirm Missing on a no-match row', () => {
    expect(buttonLabels(rows['none'])).toEqual(['Pick file', 'Confirm Missing']);
  });

  it('treats a row whose candidate was rejected as a no-match row', () => {
    const rejected: ReviewItem = { ...noMatchItem, rejectedMp3Ids: ['m9'] };
    expect(buttonLabels(renderRows([rejected])['none'])).toEqual(['Pick file', 'Confirm Missing']);
  });

  it('disables every button on a row while its decision is saving', () => {
    const pending = renderRows([coreTitleItem, noMatchItem], ['s2']);
    expect(pending['2'].match(/<button[^>]*\sdisabled=""/g)).toHaveLength(3);
    expect(pending['none']).not.toMatch(/<button[^>]*\sdisabled=""/);
  });
});

describe('ReviewQueueTable — row content', () => {
  const rows = renderRows([coreTitleItem, fuzzyItem, noMatchItem]);

  it('shows the Spotify title and artist', () => {
    expect(rows['2']).toContain('Rain (Remastered)');
    expect(rows['2']).toContain('Kerri Chandler');
  });

  it('shows the candidate by its tags: title, artist and album', () => {
    expect(rows['3']).toContain('Bar A Thyme');
    expect(rows['3']).toContain('Kerri Chandler · Local Album');
  });

  it('does not show the candidate file path (MAK-207)', () => {
    expect(rows['3']).not.toContain('m3.mp3');
  });

  it('shows the file name for a candidate with no title tag', () => {
    const untagged: ReviewItem = {
      ...fuzzyItem,
      candidate: { ...local('m5', null, null), file_path: 'D:\\Music\\House/Metro - Hold Your Wig.mp3' },
    };
    const row = renderRows([untagged])['3'];
    expect(row).toContain('Metro - Hold Your Wig');
    expect(row).not.toContain('Music');
    expect(row).not.toContain('.mp3');
  });

  it('says there is no candidate on a no-match row', () => {
    expect(rows['none']).toContain('No candidate');
  });
});

describe('tier badge', () => {
  it('labels each tier', () => {
    expect(getTierBadge(coreTitleItem).label).toBe('Core Title');
    expect(getTierBadge(fuzzyItem).label).toBe('Fuzzy 87%');
    expect(getTierBadge(noMatchItem).label).toBe('No Match');
  });

  it('leaves the % off a Fuzzy badge with no similarity', () => {
    expect(getTierBadge({ tier: 3 }).label).toBe('Fuzzy');
  });

  it('gives Fuzzy an amber colour that Core Title and No Match do not have', () => {
    expect(getTierBadge(fuzzyItem).className).toContain('amber');
    expect(getTierBadge(coreTitleItem).className).not.toContain('amber');
    expect(getTierBadge(noMatchItem).className).toContain('text-muted-foreground');
  });

  it('applies the badge text and colour classes to the rendered badge', () => {
    const rows = renderRows([coreTitleItem, fuzzyItem, noMatchItem]);
    expect(rows['3']).toMatch(/class="[^"]*bg-amber-500\/10[^"]*text-amber-600[^"]*"[^>]*>Fuzzy 87%</);
    expect(rows['2']).toMatch(/class="[^"]*bg-muted[^"]*text-foreground[^"]*"[^>]*>Core Title</);
    expect(rows['none']).toMatch(/class="[^"]*text-muted-foreground[^"]*"[^>]*>No Match</);
  });
});

describe('row helpers', () => {
  it('lists the actions for each kind of row', () => {
    expect(getRowActions(fuzzyItem)).toEqual(['confirm', 'reject', 'confirmMissing']);
    expect(getRowActions(noMatchItem)).toEqual(['pick', 'confirmMissing']);
  });

  it('maps a row to the match_method of the tier that suggested its candidate', () => {
    expect(candidateMatchMethod(coreTitleItem)).toBe('tier2_core');
    expect(candidateMatchMethod(fuzzyItem)).toBe('tier3_fuzzy');
    expect(candidateMatchMethod(noMatchItem)).toBe('manual');
  });
});

describe('localTrackTitle', () => {
  it('uses the title tag when there is one', () => {
    expect(localTrackTitle({ title: 'Rain', file_path: 'a/b/other.mp3' })).toBe('Rain');
  });

  it('falls back to the file name without folders or extension', () => {
    expect(localTrackTitle({ title: null, file_path: 'a/b/Metro - Hold Your Wig.flac' })).toBe('Metro - Hold Your Wig');
    expect(localTrackTitle({ title: '  ', file_path: 'C:\\Music\\Track 01.mp3' })).toBe('Track 01');
  });

  it('says Untitled when there is no title and no file name', () => {
    expect(localTrackTitle({ title: null, file_path: '' })).toBe('Untitled');
  });
});

describe('searchLocalTracks — picker search', () => {
  const tracks = [
    local('a', 'Rain', 'Kerri Chandler'),
    local('b', 'Atmosphere', 'Kerri Chandler'),
    local('c', 'Rain Dance', 'Moodymann'),
    local('d', null, null),
  ];
  const ids = (result: LocalTrack[]) => result.map(track => track.id);

  it('returns every file when nothing is typed', () => {
    expect(ids(searchLocalTracks(tracks, ''))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('matches the title, ignoring case', () => {
    expect(ids(searchLocalTracks(tracks, 'RAIN'))).toEqual(['a', 'c']);
  });

  it('matches the artist', () => {
    expect(ids(searchLocalTracks(tracks, 'moody'))).toEqual(['c']);
  });

  it('matches the file name, for files with wrong or empty tags', () => {
    const untagged: LocalTrack = { ...local('e', null, null), file_path: 'Metro - Hold Your Wig.mp3' };
    expect(ids(searchLocalTracks([...tracks, untagged], 'hold wig'))).toEqual(['e']);
  });

  it('needs every typed word, across title and artist', () => {
    expect(ids(searchLocalTracks(tracks, 'rain kerri'))).toEqual(['a']);
  });

  it('leaves out excluded files', () => {
    expect(ids(searchLocalTracks(tracks, 'rain', { excludeIds: ['a'] }))).toEqual(['c']);
  });

  it('lists files by the preferred artist first', () => {
    expect(ids(searchLocalTracks(tracks, '', { preferredArtist: 'Moodymann' }))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('stops at the limit', () => {
    expect(searchLocalTracks(tracks, '', { limit: 2 })).toHaveLength(2);
  });
});

describe('splitByCandidate', () => {
  it('puts rows with a candidate in potentialMatches and keeps the order of each group', () => {
    const { potentialMatches, noCandidate } = splitByCandidate([noMatchItem, coreTitleItem, fuzzyItem]);

    expect(potentialMatches.map(item => item.spotifyTrack.id)).toEqual(['s2', 's3']);
    expect(noCandidate.map(item => item.spotifyTrack.id)).toEqual([noMatchItem.spotifyTrack.id]);
  });
});
