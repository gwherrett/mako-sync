import type { Rule } from '../types';

const PREFIX = 'mixed by ';

/**
 * Remove a "Mixed by " prefix from Album Artist: "Mixed by DJ Mako" -> "DJ Mako".
 * Same rule as python/fix_album_artist.py (prefix matched ignoring case, with the
 * trailing space), and the result is also trimmed, which the script doesn't do.
 */
export const albumArtistMixedBy: Rule = {
  id: 'albumArtistMixedBy',
  run(fields) {
    const value = fields.albumArtist;
    if (!value.toLowerCase().startsWith(PREFIX)) return {};

    const stripped = value.slice(PREFIX.length).trim();
    if (!stripped) return {};

    return { changes: [{ field: 'albumArtist', value: stripped }] };
  },
};
