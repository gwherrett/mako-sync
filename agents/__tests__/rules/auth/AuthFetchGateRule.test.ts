/**
 * Tests for AuthFetchGateRule (auth-005)
 */

import { AuthFetchGateRule } from '../../../rules/auth/AuthFetchGateRule';
import { ValidationContext } from '../../../core/types';

describe('AuthFetchGateRule', () => {
  let rule: AuthFetchGateRule;

  beforeEach(() => {
    rule = new AuthFetchGateRule();
  });

  function ctx(filePath: string, fileContent: string): ValidationContext {
    return { fileContent, filePath, fileExtension: '.ts', projectRoot: '/project' };
  }

  // ── Discogs hooks ──────────────────────────────────────────────────────────

  describe('Discogs hooks', () => {
    it('flags spotifyDataFetchEnabled with ERROR', () => {
      const violations = rule.validate(ctx(
        '/project/src/hooks/useDiscogsAuth.ts',
        `const { spotifyDataFetchEnabled } = useAuth();`
      ));

      expect(violations).toHaveLength(1);
      expect(violations[0].severity).toBe('error');
      expect(violations[0].message).toContain('spotifyDataFetchEnabled');
      expect(violations[0].suggestedFix).toContain('dataFetchEnabled');
    });

    it('flags spotifyDataFetchEnabled in useVinyl hooks with ERROR', () => {
      const violations = rule.validate(ctx(
        '/project/src/hooks/useVinylCollection.ts',
        `if (!spotifyDataFetchEnabled) return;`
      ));

      expect(violations).toHaveLength(1);
      expect(violations[0].severity).toBe('error');
    });

    it('does not flag dataFetchEnabled in Discogs hooks', () => {
      const violations = rule.validate(ctx(
        '/project/src/hooks/useDiscogsAuth.ts',
        `const { dataFetchEnabled } = useAuth();`
      ));

      expect(violations).toHaveLength(0);
    });

    it('ignores commented-out spotifyDataFetchEnabled', () => {
      const violations = rule.validate(ctx(
        '/project/src/hooks/useDiscogsAuth.ts',
        `// const { spotifyDataFetchEnabled } = useAuth();`
      ));

      expect(violations).toHaveLength(0);
    });
  });

  // ── Spotify hooks ──────────────────────────────────────────────────────────

  describe('Spotify hooks', () => {
    it('flags dataFetchEnabled with WARNING', () => {
      const violations = rule.validate(ctx(
        '/project/src/hooks/useUnifiedSpotifyAuth.ts',
        `const { dataFetchEnabled } = useAuth();`
      ));

      expect(violations).toHaveLength(1);
      expect(violations[0].severity).toBe('warning');
      expect(violations[0].message).toContain('spotifyDataFetchEnabled');
    });

    it('flags dataFetchEnabled in useSpotify hooks with WARNING', () => {
      const violations = rule.validate(ctx(
        '/project/src/hooks/useSpotifySync.ts',
        `if (!dataFetchEnabled) return;`
      ));

      expect(violations).toHaveLength(1);
      expect(violations[0].severity).toBe('warning');
    });

    it('does not flag spotifyDataFetchEnabled in Spotify hooks', () => {
      const violations = rule.validate(ctx(
        '/project/src/hooks/useUnifiedSpotifyAuth.ts',
        `const { spotifyDataFetchEnabled } = useAuth();`
      ));

      expect(violations).toHaveLength(0);
    });

    it('does not flag a line that contains both flags (already correct)', () => {
      const violations = rule.validate(ctx(
        '/project/src/hooks/useUnifiedSpotifyAuth.ts',
        `const { spotifyDataFetchEnabled, dataFetchEnabled } = useAuth();`
      ));

      // Line contains both — the dataFetchEnabled check skips lines that also have spotifyDataFetchEnabled
      expect(violations).toHaveLength(0);
    });

    it('ignores commented-out dataFetchEnabled', () => {
      const violations = rule.validate(ctx(
        '/project/src/hooks/useSpotifySync.ts',
        `// if (!dataFetchEnabled) return;`
      ));

      expect(violations).toHaveLength(0);
    });
  });

  // ── Non-targeted files ─────────────────────────────────────────────────────

  describe('non-targeted files', () => {
    it('does not flag components regardless of gate usage', () => {
      const violations = rule.validate(ctx(
        '/project/src/components/TracksTable.tsx',
        `const { spotifyDataFetchEnabled, dataFetchEnabled } = useAuth();`
      ));

      expect(violations).toHaveLength(0);
    });

    it('does not flag service files', () => {
      const violations = rule.validate(ctx(
        '/project/src/services/someService.ts',
        `const { dataFetchEnabled } = useAuth();`
      ));

      expect(violations).toHaveLength(0);
    });
  });
});
