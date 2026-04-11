import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NormalizationService } from '../normalization.service';

describe('NormalizationService', () => {
  let service: NormalizationService;

  beforeEach(() => {
    service = new NormalizationService();
  });

  describe('normalize', () => {
    it('should normalize basic text', () => {
      expect(service.normalize('Hello World')).toBe('hello world');
    });

    it('should handle empty strings', () => {
      expect(service.normalize('')).toBe('');
    });

    it('should handle null/undefined', () => {
      expect(service.normalize(null)).toBe('');
    });

    it('should remove diacritics', () => {
      expect(service.normalize('Beyoncé')).toBe('beyonce');
    });

    it('should unify punctuation', () => {
      expect(service.normalize('Artist A & Artist B')).toContain('&');
    });
  });

  describe('extractVersionInfo', () => {
    it('should extract remix type', () => {
      const result = service.extractVersionInfo('Song Title (Radio Edit)');
      expect(result.mix).toBe('Radio Edit');
      expect(result.core).toBe('Song Title');
    });

    it('should handle titles without mix type', () => {
      const result = service.extractVersionInfo('Regular Song Title');
      expect(result.mix).toBeNull();
      expect(result.core).toBe('Regular Song Title');
    });

    it('should extract extended mix', () => {
      const result = service.extractVersionInfo('Track Name (Extended Mix)');
      expect(result.mix).toBe('Extended Mix');
    });

    it('should handle null input', () => {
      const result = service.extractVersionInfo(null);
      expect(result.core).toBe('');
      expect(result.mix).toBeNull();
    });
  });

  describe('parseArtists', () => {
    it('should extract primary artist from featuring format', () => {
      const result = service.parseArtists('Artist A feat. Artist B');
      expect(result.primary).toBe('Artist A');
      expect(result.featured).toContain('Artist B');
    });

    it('should handle single artist', () => {
      const result = service.parseArtists('Solo Artist');
      expect(result.primary).toBe('Solo Artist');
      expect(result.featured).toHaveLength(0);
    });

    it('should handle null input', () => {
      const result = service.parseArtists(null);
      expect(result.primary).toBe('');
      expect(result.featured).toHaveLength(0);
    });
  });

  describe('processMetadata', () => {
    it('should process complete track metadata', () => {
      const result = service.processMetadata(
        'Song Title (Extended Mix)',
        'Main Artist feat. Featured Artist'
      );

      expect(result.normalizedTitle).toBeDefined();
      expect(result.normalizedArtist).toBeDefined();
      expect(result.coreTitle).toBeDefined();
      expect(result.primaryArtist).toBeDefined();
      expect(result.featuredArtists).toBeInstanceOf(Array);
      expect(result.mix).toBe('Extended Mix');
    });

    it('should handle null inputs', () => {
      const result = service.processMetadata(null, null);
      expect(result.normalizedTitle).toBe('');
      expect(result.normalizedArtist).toBe('');
    });
  });
});

// ─── Additional edge-case coverage ───────────────────────────────────────────

describe('NormalizationService – normalize edge cases', () => {
  let service: NormalizationService;
  beforeEach(() => { service = new NormalizationService(); });

  it('handles whitespace-only input', () => {
    expect(service.normalize('   ')).toBe('');
  });

  it('collapses multiple spaces', () => {
    expect(service.normalize('too   many   spaces')).toBe('too many spaces');
  });

  it('handles unicode ligatures (NFKC)', () => {
    // ﬁ (fi ligature) → fi
    expect(service.normalize('ﬁlter')).toBe('filter');
  });

  it('lowercases the full string', () => {
    expect(service.normalize('UPPER CASE')).toBe('upper case');
  });

  it('strips diacritics from multi-character sequences', () => {
    expect(service.normalize('naïve')).toBe('naive');
    expect(service.normalize('café')).toBe('cafe');
  });
});

describe('NormalizationService – extractVersionInfo edge cases', () => {
  let service: NormalizationService;
  beforeEach(() => { service = new NormalizationService(); });

  it('extracts Remix from parentheses', () => {
    const result = service.extractVersionInfo('Song (Deadmau5 Remix)');
    expect(result.mix).toContain('Remix');
    expect(result.core).toBe('Song');
  });

  it('extracts VIP mix', () => {
    const result = service.extractVersionInfo('Track (VIP)');
    expect(result.mix).toBe('VIP');
  });

  it('extracts mix from brackets', () => {
    const result = service.extractVersionInfo('Song [Club Mix]');
    expect(result.mix).toContain('Club Mix');
    expect(result.core).toBe('Song');
  });

  it('does not strip featured artist parenthetical as mix', () => {
    const result = service.extractVersionInfo('Song (feat. Artist B)');
    // feat. signals artist, not mix — core should remain full title
    expect(result.mix).toBeNull();
  });

  it('handles multiple parentheticals — picks best mix candidate', () => {
    const result = service.extractVersionInfo('Song (feat. Artist) (Radio Edit)');
    expect(result.mix).toContain('Radio Edit');
  });

  it('handles title with no parentheses', () => {
    const result = service.extractVersionInfo('Plain Song Title');
    expect(result.core).toBe('Plain Song Title');
    expect(result.mix).toBeNull();
  });

  it('handles null gracefully', () => {
    const result = service.extractVersionInfo(null);
    expect(result.core).toBe('');
    expect(result.mix).toBeNull();
  });

  it('handles Remastered suffix', () => {
    const result = service.extractVersionInfo('Song (2011 Remastered)');
    expect(result.mix).toContain('Remaster');
  });

  it('preserves subtitle parenthetical (non-mix content)', () => {
    // "(If This Ain't Love)" has no mix keywords — should not be extracted as mix
    const result = service.extractVersionInfo("Song (If This Ain't Love)");
    expect(result.mix).toBeNull();
  });

  it('strips (Deluxe Edition) from core title', () => {
    const result = service.extractVersionInfo('Album Title (Deluxe Edition)');
    expect(result.core).toBe('Album Title');
    expect(result.mix).toContain('Deluxe Edition');
  });

  it('strips (Deluxe) from core title', () => {
    const result = service.extractVersionInfo('Song Title (Deluxe)');
    expect(result.core).toBe('Song Title');
  });
});

describe('NormalizationService – parseArtists edge cases', () => {
  let service: NormalizationService;
  beforeEach(() => { service = new NormalizationService(); });

  it('handles "ft." notation', () => {
    const result = service.parseArtists('DJ Shadow ft. Mos Def');
    expect(result.primary).toBe('DJ Shadow');
    expect(result.featured).toContain('Mos Def');
  });

  it('handles "featuring" notation', () => {
    const result = service.parseArtists('Artist featuring Vocalist');
    expect(result.primary).toBe('Artist');
    expect(result.featured).toContain('Vocalist');
  });

  it('handles multiple featured artists via feat chain', () => {
    const result = service.parseArtists('Main Artist feat. A feat. B');
    expect(result.primary).toBe('Main Artist');
    expect(result.featured.length).toBeGreaterThan(0);
  });

  it('returns empty featured array for single artist', () => {
    const result = service.parseArtists('Aphex Twin');
    expect(result.primary).toBe('Aphex Twin');
    expect(result.featured).toHaveLength(0);
  });

  it('handles null', () => {
    const result = service.parseArtists(null);
    expect(result.primary).toBe('');
    expect(result.featured).toHaveLength(0);
  });

  it('handles empty string', () => {
    const result = service.parseArtists('');
    expect(result.primary).toBe('');
  });
});

describe('NormalizationService – processMetadata edge cases', () => {
  let service: NormalizationService;
  beforeEach(() => { service = new NormalizationService(); });

  it('sets featuredArtists from feat. in artist field', () => {
    const result = service.processMetadata('Song', 'Artist A feat. Artist B');
    expect(result.featuredArtists).toContain('Artist B');
    expect(result.primaryArtist).toContain('artist a');
  });

  it('extracts mix from title', () => {
    const result = service.processMetadata('Song (Club Mix)', 'Artist');
    expect(result.mix).toContain('Club Mix');
    expect(result.coreTitle).toBe('song');
  });

  it('coreTitle is normalized version of core (no mix)', () => {
    const result = service.processMetadata('SONG (Radio Edit)', 'Artist');
    expect(result.coreTitle).toBe('song');
  });

  it('normalizedTitle includes full title including mix info', () => {
    const result = service.processMetadata('Song (Club Mix)', 'Artist');
    expect(result.normalizedTitle).toContain('song');
    expect(result.normalizedTitle).toContain('club mix');
  });

  it('mix is null when no version info present', () => {
    const result = service.processMetadata('Plain Track', 'Artist');
    expect(result.mix).toBeNull();
  });
});
