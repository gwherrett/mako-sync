/**
 * Server-side normalization for Spotify tracks
 * Mirrors the client-side normalization logic
 */

export interface NormalizedMetadata {
  normalized_title: string;
  normalized_artist: string;
  core_title: string;
  primary_artist: string;
  featured_artists: string[];
  mix: string | null;
}

// Common version/remix patterns
const versionPatterns = [
  /\(live(?:\s+at\s+[^)]+)?\)/gi,
  /\(live\)/gi,
  /\(remaster(?:ed)?(?:\s+\d{4})?\)/gi,
  /\(radio\s+edit\)/gi,
  /\(original\s+mix\)/gi,
  /\(extended\s+mix\)/gi,
  /\(club\s+mix\)/gi,
  /\(dub\s+mix\)/gi,
  /\(instrumental\)/gi,
  /\(acoustic\)/gi,
  /\(unplugged\)/gi,
  /\(\d{4}\s+remaster\)/gi,
];

// Remix patterns - capture remixer name
const remixPattern = /\(([^)]+)\s+(?:remix|mix|edit)\)/gi;

// Feature patterns
const featurePatterns = [
  /\s+feat\.?\s+/gi,
  /\s+ft\.?\s+/gi,
  /\s+featuring\s+/gi,
  /\s+with\s+/gi,
];

/**
 * Step 1.1: Unicode normalization (NFKC) + casefold + trim + collapse whitespace
 */
function unicodeNormalize(text: string | null): string {
  if (!text) return '';
  return text
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Step 1.2: Remove accents and diacritics
 */
function removeDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Step 1.3: Unify punctuation
 */
function unifyPunctuation(text: string): string {
  return text
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+[x×]\s+/gi, ' & ')
    .replace(/\s+and\s+/gi, ' & ')
    .replace(/[^\w\s&'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Step 1.4: Standardize featuring notation
 */
function standardizeFeatures(text: string): string {
  let normalized = text;
  for (const pattern of featurePatterns) {
    normalized = normalized.replace(pattern, ' feat ');
  }
  return normalized.trim();
}

// Mix/version keywords that indicate track version information
const mixKeywords = [
  'remix', 'mix', 'edit', 'rework', 'bootleg', 'mashup',
  'version', 'radio', 'club', 'extended', 'vocal', 'instrumental', 'dub', 'original',
  'live', 'acoustic', 'unplugged', 'session',
  'remaster', 'remastered', 'demo', 'vip'
];

// Artist feature keywords (negative indicators for mix info)
const artistKeywords = [
  'feat', 'ft', 'featuring', 'with', 'performed by'
];

/**
 * Extract all metadata pieces from title (parentheses, brackets, hyphen)
 */
function extractMetadataPieces(title: string): Array<{ content: string; type: string; position: number }> {
  const pieces: Array<{ content: string; type: string; position: number }> = [];

  // Extract from parentheses
  const parenthesesRegex = /\(([^)]+)\)/g;
  let match;
  while ((match = parenthesesRegex.exec(title)) !== null) {
    pieces.push({ content: match[1].trim(), type: 'parentheses', position: match.index });
  }

  // Extract from square brackets
  const bracketsRegex = /\[([^\]]+)\]/g;
  while ((match = bracketsRegex.exec(title)) !== null) {
    pieces.push({ content: match[1].trim(), type: 'brackets', position: match.index });
  }

  // Extract from hyphen separator (only last occurrence with spaces)
  const hyphenMatch = title.match(/^(.+?)\s+-\s+([^-]+)$/);
  if (hyphenMatch) {
    pieces.push({ content: hyphenMatch[2].trim(), type: 'hyphen', position: hyphenMatch[1].length });
  }

  return pieces;
}

/**
 * Score a metadata piece to determine if it's mix info (positive) or artist info (negative)
 */
function scoreMixCandidate(content: string): number {
  const lower = content.toLowerCase();
  let score = 0;

  // Positive indicators (mix/version keywords)
  for (const keyword of mixKeywords) {
    if (lower.includes(keyword)) {
      score += 10;
    }
  }

  // Negative indicators (artist feature keywords)
  for (const keyword of artistKeywords) {
    if (lower.includes(keyword)) {
      score -= 20;
    }
  }

  // All caps might be artist name (negative)
  if (content === content.toUpperCase() && content.length > 3) {
    score -= 5;
  }

  return score;
}

/**
 * Step 1.5: Extract mix/version information using smart semantic analysis
 * Prioritizes mix info over artist features by scoring all metadata pieces
 */
function extractVersionInfo(title: string | null): { core: string; mix: string | null } {
  if (!title) return { core: '', mix: null };

  const pieces = extractMetadataPieces(title);
  
  if (pieces.length === 0) {
    return { core: title.trim(), mix: null };
  }

  // Score each piece
  const scoredPieces = pieces.map(piece => ({
    ...piece,
    score: scoreMixCandidate(piece.content)
  }));

  // Find best mix candidate (highest positive score)
  const bestMix = scoredPieces
    .filter(p => p.score > 0)
    .sort((a, b) => {
      // Sort by score, then by type priority (brackets > parentheses > hyphen)
      if (b.score !== a.score) return b.score - a.score;
      const typePriority = { brackets: 3, parentheses: 2, hyphen: 1 };
      return typePriority[b.type as keyof typeof typePriority] - typePriority[a.type as keyof typeof typePriority];
    })[0];

  let core = title;
  let mix: string | null = null;

  if (bestMix) {
    mix = bestMix.content;
    
    // Remove the mix piece from title to get core
    if (bestMix.type === 'parentheses') {
      core = core.replace(/\([^)]*\)/g, '').trim();
    } else if (bestMix.type === 'brackets') {
      core = core.replace(/\[[^\]]*\]/g, '').trim();
    } else if (bestMix.type === 'hyphen') {
      core = core.replace(/\s+-\s+[^-]+$/, '').trim();
    }
  } else {
    // No good mix candidate found, remove all metadata but keep as core
    core = core.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+-\s+[^-]+$/, '').trim();
  }

  // Clean up whitespace
  core = core.replace(/\s+/g, ' ').trim();

  return { core, mix };
}

/**
 * Parse artist field into primary artist and featured artists
 */
function parseArtists(artist: string | null): { primary: string; featured: string[] } {
  if (!artist) return { primary: '', featured: [] };

  // Standardize featuring notation first
  let normalized = standardizeFeatures(artist);

  // Split on "feat"
  const parts = normalized.split(/\s+feat\s+/i);
  const primary = parts[0].trim();
  const featured = parts.slice(1).map(a => a.trim()).filter(a => a.length > 0);

  return { primary, featured };
}

/**
 * Full normalization pipeline for matching
 */
export function normalize(text: string | null): string {
  if (!text) return '';
  
  let normalized = unicodeNormalize(text);
  normalized = removeDiacritics(normalized);
  normalized = unifyPunctuation(normalized);
  normalized = standardizeFeatures(normalized);
  
  return normalized.trim();
}

/**
 * Process complete track metadata
 */
export function processMetadata(title: string | null, artist: string | null): NormalizedMetadata {
  // Extract mix info from title
  const { core, mix } = extractVersionInfo(title);
  
  // Parse artist information
  const { primary, featured } = parseArtists(artist);

  // Apply full normalization
  const normalized_title = normalize(title);
  const normalized_artist = normalize(artist);
  const core_title = normalize(core);
  const primary_artist = normalize(primary);

  return {
    normalized_title,
    normalized_artist,
    core_title,
    primary_artist,
    featured_artists: featured,
    mix,
  };
}
