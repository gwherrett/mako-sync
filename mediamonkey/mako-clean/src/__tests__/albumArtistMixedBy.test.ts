import { describe, it, expect } from 'vitest';
import { albumArtistMixedBy } from '../core/rules/albumArtistMixedBy';
import { RULES } from '../core/rules';
import { planTrack } from '../core/runner';
import type { RuleContext } from '../core/types';

const ctx: RuleContext = { genreMap: new Map([['deep house', 'House']]), genreSeparator: '; ' };

function newAlbumArtist(albumArtist: string): string {
  const result = albumArtistMixedBy.run({ genre: '', grouping: '', albumArtist }, ctx);
  return result.changes?.[0]?.value ?? albumArtist;
}

describe('albumArtistMixedBy (MAK-200 cases)', () => {
  it.each([
    ['Mixed by DJ Mako', 'DJ Mako'],
    ['MIXED BY DJ Mako', 'DJ Mako'],
    ['Mixed by  DJ Mako', 'DJ Mako'],
    ['Mixed Bystander', 'Mixed Bystander'],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(newAlbumArtist(input)).toBe(expected);
  });

  it('leaves "Mixed by " with nothing after it alone rather than blanking it', () => {
    expect(albumArtistMixedBy.run({ genre: '', grouping: '', albumArtist: 'Mixed by ' }, ctx)).toEqual({});
  });
});

describe('RULES', () => {
  it('runs Grouping, then Album Artist, in one pass', () => {
    expect(RULES.map((r) => r.id)).toEqual(['superGenreGrouping', 'albumArtistMixedBy']);

    const plan = planTrack(
      {
        id: '1',
        label: 'A - T',
        file: 't.mp3',
        fields: { genre: 'Deep House', grouping: '', albumArtist: 'Mixed by DJ Mako' },
      },
      RULES,
      ctx
    );

    expect(plan.changes).toEqual([
      { field: 'grouping', from: '', to: 'House', overwrite: false },
      { field: 'albumArtist', from: 'Mixed by DJ Mako', to: 'DJ Mako', overwrite: false },
    ]);
  });

  it('still fixes Album Artist when the genre does not map, and notes the genre', () => {
    const plan = planTrack(
      {
        id: '1',
        label: 'A - T',
        file: 't.mp3',
        fields: { genre: 'Zydeco', grouping: '', albumArtist: 'Mixed by DJ Mako' },
      },
      RULES,
      ctx
    );

    expect(plan.changes.map((c) => c.field)).toEqual(['albumArtist']);
    expect(plan.skipReasons).toEqual(['No SuperGenre for genres: Zydeco']);
  });
});
