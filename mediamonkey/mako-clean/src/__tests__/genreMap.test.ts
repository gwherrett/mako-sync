import { describe, it, expect } from 'vitest';
import { cleanPath, parseGenreMapExport } from '../core/genreMap';

const valid = {
  version: 1,
  exportedAt: '2026-11-21T10:00:00.000Z',
  mappings: [
    ['acid house', 'House'],
    ['Deep House ', 'House'],
    ['disco', 'Disco'],
  ],
};

describe('parseGenreMapExport', () => {
  it('reads the export, keeping its order and normalizing keys', () => {
    const result = parseGenreMapExport(JSON.stringify(valid));
    expect(result.exportedAt).toBe('2026-11-21T10:00:00.000Z');
    expect([...result.map.entries()]).toEqual([
      ['acid house', 'House'],
      ['deep house', 'House'],
      ['disco', 'Disco'],
    ]);
  });

  it('ignores a byte-order mark', () => {
    const result = parseGenreMapExport(String.fromCharCode(0xfeff) + JSON.stringify(valid));
    expect(result.map.size).toBe(3);
  });

  it('keeps the first entry when a key repeats', () => {
    const result = parseGenreMapExport(JSON.stringify({
      ...valid,
      mappings: [['house', 'House'], ['House', 'Disco']],
    }));
    expect(result.map.get('house')).toBe('House');
  });

  it('stops with a clear message for a file that is not JSON', () => {
    expect(() => parseGenreMapExport('spotify_genre,super_genre\n')).toThrow(/isn't valid JSON.*Download for MediaMonkey/);
  });

  it('stops for an unknown version', () => {
    expect(() => parseGenreMapExport(JSON.stringify({ ...valid, version: 2 }))).toThrow(/version 2/);
  });

  it('stops when the mappings list is missing', () => {
    expect(() => parseGenreMapExport(JSON.stringify({ version: 1 }))).toThrow(/no mappings list/);
  });

  it('stops for an entry that is not a pair of strings', () => {
    expect(() => parseGenreMapExport(JSON.stringify({ version: 1, mappings: [['house', 3]] }))).toThrow(/pair/);
  });

  it('stops for a JSON value that is not an object', () => {
    expect(() => parseGenreMapExport('null')).toThrow(/unexpected format/);
  });
});

describe('cleanPath', () => {
  it('strips the quotes from "Copy as path"', () => {
    expect(cleanPath(' "C:\\Users\\me\\Downloads\\mako-genre-map.json" ')).toBe('C:\\Users\\me\\Downloads\\mako-genre-map.json');
  });

  it('leaves a plain path alone', () => {
    expect(cleanPath('C:\\map.json')).toBe('C:\\map.json');
  });
});
