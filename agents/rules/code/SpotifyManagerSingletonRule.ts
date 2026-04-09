/**
 * Rule: Spotify Manager Singleton
 * Must use SpotifyAuthManager.getInstance() - never instantiate directly
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';

export class SpotifyManagerSingletonRule extends BaseRule {
  constructor() {
    super({
      id: 'code-006-spotify-manager-singleton',
      category: RuleCategory.CODING_PATTERN,
      severity: RuleSeverity.ERROR,
      description: 'Must use SpotifyAuthManager.getInstance() - never new SpotifyAuthManager()',
      rationale: 'SpotifyAuthManager is a singleton - direct instantiation creates multiple instances',
      filePatterns: ['**/*.ts', '**/*.tsx'],
      excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/__tests__/**',
        '**/agents/**',
        '**/spotifyAuthManager.service.ts',
        '**/spotifyAuthManager.mock.service.ts'
      ]
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent } = context;

    // Check if file uses SpotifyAuthManager
    if (!fileContent.includes('SpotifyAuthManager')) {
      return violations;
    }

    const lines = getLines(context);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for direct instantiation
      if (
        line.includes('new SpotifyAuthManager') &&
        !line.includes('//') // Not a comment
      ) {
        const snippet = this.extractCodeSnippet(fileContent, i + 1);

        violations.push(
          this.createViolation(
            context,
            'SpotifyAuthManager must be accessed via getInstance() - never instantiate directly',
            i + 1,
            undefined,
            snippet,
            'Use: const manager = SpotifyAuthManager.getInstance()'
          )
        );
      }
    }

    return violations;
  }
}
