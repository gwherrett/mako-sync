import { describe, it, expect } from 'vitest';
import { splitLegacyId3Genres } from '../audioTags';

describe('audioTags', () => {
  describe('splitLegacyId3Genres', () => {
    it('returns an empty list when there are no genres', () => {
      expect(splitLegacyId3Genres(undefined, ['ID3v2.3'])).toEqual([]);
      expect(splitLegacyId3Genres([], ['ID3v2.3'])).toEqual([]);
    });

    it('splits a slash-joined ID3v2.3 genre', () => {
      expect(splitLegacyId3Genres(['Hip Hop/Rap'], ['ID3v2.3'])).toEqual(['Hip Hop', 'Rap']);
    });

    it('splits a slash-joined ID3v2.2 genre', () => {
      expect(splitLegacyId3Genres(['Hip Hop/Rap'], ['ID3v2.2'])).toEqual(['Hip Hop', 'Rap']);
    });

    it('splits when an ID3v1 tag sits next to the ID3v2.3 tag', () => {
      expect(splitLegacyId3Genres(['Hip Hop/Rap'], ['ID3v2.3', 'ID3v1'])).toEqual(['Hip Hop', 'Rap']);
    });

    it('splits every entry of a genre list', () => {
      expect(splitLegacyId3Genres(['House/Techno', 'Pop'], ['ID3v2.3'])).toEqual([
        'House',
        'Techno',
        'Pop',
      ]);
    });

    it('trims parts and drops empty ones', () => {
      expect(splitLegacyId3Genres(['Hip Hop / Rap /', '/Soul'], ['ID3v2.3'])).toEqual([
        'Hip Hop',
        'Rap',
        'Soul',
      ]);
    });

    it('leaves ID3v2.4 genres alone', () => {
      expect(splitLegacyId3Genres(['Hip Hop/Rap'], ['ID3v2.4'])).toEqual(['Hip Hop/Rap']);
    });

    it('leaves ID3v1-only genres alone', () => {
      expect(splitLegacyId3Genres(['Hip Hop/Rap'], ['ID3v1'])).toEqual(['Hip Hop/Rap']);
    });

    it('leaves Vorbis (FLAC) and iTunes (M4A) genres alone', () => {
      expect(splitLegacyId3Genres(['R&B/Soul'], ['vorbis'])).toEqual(['R&B/Soul']);
      expect(splitLegacyId3Genres(['Hip-Hop/Rap'], ['iTunes'])).toEqual(['Hip-Hop/Rap']);
    });

    it('leaves genres alone when the tag types are unknown', () => {
      expect(splitLegacyId3Genres(['Hip Hop/Rap'], undefined)).toEqual(['Hip Hop/Rap']);
    });

    it('drops empty values without splitting', () => {
      expect(splitLegacyId3Genres(['', 'Rock'], ['ID3v2.4'])).toEqual(['Rock']);
    });

    it('does not modify the list it was given', () => {
      const genres = ['Hip Hop/Rap'];
      splitLegacyId3Genres(genres, ['ID3v2.3']);
      expect(genres).toEqual(['Hip Hop/Rap']);
    });
  });
});
