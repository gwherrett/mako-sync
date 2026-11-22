import { normalizeGenreKey } from '@/utils/superGenreMapping';

/**
 * The genre map file from Mako's Genre Tools page (Download for MediaMonkey),
 * made by the genre-mapping Edge Function's ?export=json:
 * { "version": 1, "exportedAt": "<ISO time>", "mappings": [["<genre>", "<SuperGenre>"], ...] }
 */
export interface GenreMapExport {
  exportedAt: string;
  /** Genre -> SuperGenre, in the file's order (the order Mako's Step 5 uses) */
  map: Map<string, string>;
}

const DOWNLOAD_HINT = "Download it again from Mako's Genre Tools page (Download for MediaMonkey).";

export function parseGenreMapExport(text: string): GenreMapExport {
  let data: unknown;
  try {
    // Drop a byte-order mark. Written as a char code so the built file stays ASCII.
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new Error(`The genre map file isn't valid JSON. ${DOWNLOAD_HINT}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`The genre map file has an unexpected format. ${DOWNLOAD_HINT}`);
  }
  const { version, exportedAt, mappings } = data as Record<string, unknown>;

  if (version !== 1) {
    throw new Error(`The genre map file is version ${String(version)}; this add-on reads version 1. ${DOWNLOAD_HINT}`);
  }
  if (!Array.isArray(mappings)) {
    throw new Error(`The genre map file has no mappings list. ${DOWNLOAD_HINT}`);
  }

  const map = new Map<string, string>();
  for (const pair of mappings) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
      throw new Error(`The genre map file has an entry that isn't a [genre, SuperGenre] pair. ${DOWNLOAD_HINT}`);
    }
    const key = normalizeGenreKey(pair[0]);
    // Keep the first entry for a key, as a Map built in this order would
    if (key && pair[1] && !map.has(key)) map.set(key, pair[1]);
  }

  return {
    exportedAt: typeof exportedAt === 'string' ? exportedAt : '',
    map,
  };
}

/** Strip the quotes Windows "Copy as path" puts around a path. */
export function cleanPath(path: string): string {
  return path.trim().replace(/^"(.*)"$/, '$1').trim();
}
