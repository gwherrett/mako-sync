import { describe, it, expect, vi } from 'vitest';
import {
  DANCE_ALL_VALUE,
  DANCE_SUPER_GENRES,
  SUPERDJ_LABEL,
  applySuperGenreFilter,
  getSuperGenreFilterLabel,
} from '../genreMapping';

const makeQuery = () => {
  const query = {
    in: vi.fn(() => query),
    eq: vi.fn(() => query),
  };
  return query;
};

describe('genreMapping SuperDJ group', () => {
  describe('getSuperGenreFilterLabel', () => {
    it('labels the group sentinel as SuperDJ', () => {
      expect(SUPERDJ_LABEL).toBe('SuperDJ');
      expect(getSuperGenreFilterLabel(DANCE_ALL_VALUE)).toBe('SuperDJ');
    });

    it('returns an individual SuperGenre unchanged, including Dance', () => {
      expect(getSuperGenreFilterLabel('House')).toBe('House');
      expect(getSuperGenreFilterLabel('Dance')).toBe('Dance');
    });
  });

  describe('applySuperGenreFilter', () => {
    it('expands the SuperDJ sentinel into an .in() match on the group', () => {
      const query = makeQuery();
      applySuperGenreFilter(query, DANCE_ALL_VALUE);
      expect(query.in).toHaveBeenCalledWith('super_genre', DANCE_SUPER_GENRES);
      expect(query.eq).not.toHaveBeenCalled();
    });

    it('uses .eq() for a single SuperGenre', () => {
      const query = makeQuery();
      applySuperGenreFilter(query, 'Dance');
      expect(query.eq).toHaveBeenCalledWith('super_genre', 'Dance');
      expect(query.in).not.toHaveBeenCalled();
    });

    it.each(['all', '', null, undefined])('leaves the query unfiltered for %s', (value) => {
      const query = makeQuery();
      expect(applySuperGenreFilter(query, value)).toBe(query);
      expect(query.in).not.toHaveBeenCalled();
      expect(query.eq).not.toHaveBeenCalled();
    });
  });
});
