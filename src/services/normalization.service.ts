/**
 * Advanced Music Metadata Normalization Service
 * Implements comprehensive text normalization for accurate track matching
 */

export interface NormalizedMetadata {
  normalizedTitle: string;
  normalizedArtist: string;
  coreTitle: string;
  primaryArtist: string;
  featuredArtists: string[];
  mix: string | null;
}

export class NormalizationService {
  // Mix/version keywords that indicate track version information
  private readonly mixKeywords = [
    'remix', 'mix', 'edit', 'rework', 'bootleg', 'mashup',
    'version', 'radio', 'club', 'extended', 'vocal', 'instrumental', 'dub', 'original',
    'live', 'acoustic', 'unplugged', 'session',
    'remaster', 'remastered', 'demo', 'vip'
  ];

  // Artist feature keywords (negative indicators for mix info)
  private readonly artistKeywords = [
    'feat', 'ft', 'featuring', 'with', 'performed by'
  ];

  // Feature patterns
  private readonly featurePatterns = [
    /\s+feat\.?\s+/gi,
    /\s+ft\.?\s+/gi,
    /\s+featuring\s+/gi,
    /\s+with\s+/gi,
  ];

  /**
   * Step 1.1: Unicode normalization (NFKC) + casefold + trim + collapse whitespace
   */
  private unicodeNormalize(text: string | null): string {
    if (!text) return '';
    return text
      .normalize('NFKC')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Step 1.2: Remove accents and diacritics
   * "Beyoncé" → "beyonce"; "Sigur Rós" → "sigur ros"
   */
  private removeDiacritics(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Step 1.3: Unify punctuation
   * Various quotes → ', hyphens → -, &/x/+ → &
   */
  private unifyPunctuation(text: string): string {
    return text
      // Unify quotes
      .replace(/['']/g, "'")
      .replace(/[""]/g, '"')
      // Unify hyphens
      .replace(/[‐‑‒–—―]/g, '-')
      // Unify ampersands
      .replace(/\s+[x×]\s+/gi, ' & ')
      .replace(/\s+and\s+/gi, ' & ')
      // Remove most punctuation except &, -, and spaces
      .replace(/[^\w\s&'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Step 1.4: Standardize featuring notation
   * feat.|ft.|featuring|with → feat
   */
  private standardizeFeatures(text: string): string {
    let normalized = text;
    for (const pattern of this.featurePatterns) {
      normalized = normalized.replace(pattern, ' feat ');
    }
    return normalized.trim();
  }

  /**
   * Extract all metadata pieces from title (parentheses, brackets, hyphen)
   */
  private extractMetadataPieces(title: string): Array<{ content: string; type: string; position: number }> {
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
  private scoreMixCandidate(content: string): number {
    const lower = content.toLowerCase();
    let score = 0;

    // Positive indicators (mix/version keywords)
    for (const keyword of this.mixKeywords) {
      if (lower.includes(keyword)) {
        score += 10;
      }
    }

    // Negative indicators (artist feature keywords)
    for (const keyword of this.artistKeywords) {
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
  extractVersionInfo(title: string | null): { core: string; mix: string | null } {
    if (!title) return { core: '', mix: null };

    const pieces = this.extractMetadataPieces(title);
    
    if (pieces.length === 0) {
      return { core: title.trim(), mix: null };
    }

    // Score each piece
    const scoredPieces = pieces.map(piece => ({
      ...piece,
      score: this.scoreMixCandidate(piece.content)
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

      // Remove ONLY the specific mix piece, not all parens/brackets
      if (bestMix.type === 'parentheses') {
        // Escape the content for regex and remove only this specific parenthetical
        const escaped = bestMix.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        core = core.replace(new RegExp(`\\(${escaped}\\)`, ''), '').trim();
      } else if (bestMix.type === 'brackets') {
        const escaped = bestMix.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        core = core.replace(new RegExp(`\\[${escaped}\\]`, ''), '').trim();
      } else if (bestMix.type === 'hyphen') {
        core = core.replace(/\s+-\s+[^-]+$/, '').trim();
      }
    } else {
      // No good mix candidate found — only strip pieces that scored zero (neutral),
      // keep pieces with negative scores (artist features, subtitles)
      const neutralPieces = scoredPieces.filter(p => p.score === 0);
      for (const piece of neutralPieces) {
        if (piece.type === 'parentheses') {
          const escaped = piece.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          core = core.replace(new RegExp(`\\(${escaped}\\)`, ''), '').trim();
        } else if (piece.type === 'brackets') {
          const escaped = piece.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          core = core.replace(new RegExp(`\\[${escaped}\\]`, ''), '').trim();
        } else if (piece.type === 'hyphen') {
          core = core.replace(/\s+-\s+[^-]+$/, '').trim();
        }
      }
    }

    // Clean up whitespace
    core = core.replace(/\s+/g, ' ').trim();

    return { core, mix };
  }

  /**
   * Parse artist field into primary artist and featured artists
   */
  parseArtists(artist: string | null): { primary: string; featured: string[] } {
    if (!artist) return { primary: '', featured: [] };

    // Standardize featuring notation first
    let normalized = this.standardizeFeatures(artist);

    // Split on "feat"
    const parts = normalized.split(/\s+feat\s+/i);
    const primary = parts[0].trim();
    const featured = parts.slice(1).map(a => a.trim()).filter(a => a.length > 0);

    return { primary, featured };
  }

  /**
   * Full normalization pipeline for matching
   */
  normalize(text: string | null): string {
    if (!text) return '';
    
    let normalized = this.unicodeNormalize(text);
    normalized = this.removeDiacritics(normalized);
    normalized = this.unifyPunctuation(normalized);
    normalized = this.standardizeFeatures(normalized);
    
    return normalized.trim();
  }

  /**
   * Process complete track metadata
   */
  processMetadata(title: string | null, artist: string | null): NormalizedMetadata {
    // Extract mix info from title
    const { core, mix } = this.extractVersionInfo(title);
    
    // Parse artist information
    const { primary, featured } = this.parseArtists(artist);

    // Apply full normalization
    const normalizedTitle = this.normalize(title);
    const normalizedArtist = this.normalize(artist);
    const coreTitle = this.normalize(core);
    const primaryArtist = this.normalize(primary);

    return {
      normalizedTitle,
      normalizedArtist,
      coreTitle,
      primaryArtist,
      featuredArtists: featured,
      mix,
    };
  }
}
