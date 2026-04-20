/**
 * Rule: auth-005 — Service-scoped fetch gate usage
 *
 * After MAK-101 split dataFetchEnabled into two flags:
 *   - spotifyDataFetchEnabled  gated by Spotify TOKEN_REFRESHED events
 *   - dataFetchEnabled         general gate, only cleared on SIGNED_OUT
 *
 * Discogs / vinyl hooks must NOT consume spotifyDataFetchEnabled (ERROR).
 * Spotify hooks should consume spotifyDataFetchEnabled, not dataFetchEnabled (WARNING).
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';

const DISCOGS_PATTERN = /hooks\/useDiscogs|hooks\/useVinyl/;
const SPOTIFY_PATTERN = /hooks\/useSpotify|hooks\/useUnifiedSpotify/;

export class AuthFetchGateRule extends BaseRule {
  constructor() {
    super({
      id: 'auth-005-service-scoped-fetch-gate',
      category: RuleCategory.AUTHENTICATION_FLOW,
      severity: RuleSeverity.ERROR,
      description: 'Discogs/vinyl hooks must not consume spotifyDataFetchEnabled; Spotify hooks should prefer spotifyDataFetchEnabled over dataFetchEnabled',
      rationale: 'MAK-101: dataFetchEnabled was split into service-scoped gates. Using the wrong gate causes Discogs queries to be blocked unnecessarily during Spotify token refreshes.',
      filePatterns: ['**/*.ts', '**/*.tsx'],
      excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/__tests__/**',
        '**/agents/**',
        '**/NewAuthContext.tsx',
      ]
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const { filePath, fileContent } = context;
    const violations: RuleViolation[] = [];

    const isDiscogsHook = DISCOGS_PATTERN.test(filePath);
    const isSpotifyHook = SPOTIFY_PATTERN.test(filePath);

    if (!isDiscogsHook && !isSpotifyHook) return violations;

    const lines = getLines(context);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const trimmed = line.trim();

      if (trimmed.startsWith('//')) continue;

      if (isDiscogsHook && line.includes('spotifyDataFetchEnabled')) {
        violations.push(
          this.createViolation(
            context,
            'Discogs/vinyl hook must not use spotifyDataFetchEnabled — use dataFetchEnabled instead (Discogs has no relation to Spotify token refresh lifecycle)',
            lineNum,
            undefined,
            this.extractCodeSnippet(fileContent, lineNum),
            'Replace spotifyDataFetchEnabled with dataFetchEnabled'
          )
        );
      }

      if (isSpotifyHook && /\bdataFetchEnabled\b/.test(line) && !line.includes('spotifyDataFetchEnabled')) {
        violations.push({
          ruleId: this.config.id,
          message: 'Spotify hook should use spotifyDataFetchEnabled instead of the general dataFetchEnabled gate',
          filePath: context.filePath,
          line: lineNum,
          severity: 'warning',
          snippet: this.extractCodeSnippet(fileContent, lineNum),
          suggestedFix: 'Replace dataFetchEnabled with spotifyDataFetchEnabled',
          category: this.config.category,
        });
      }
    }

    return violations;
  }
}
