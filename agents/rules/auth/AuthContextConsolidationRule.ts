/**
 * Rule: Auth Context Consolidation
 * Only NewAuthProvider exists - no legacy AuthContext imports allowed
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';

export class AuthContextConsolidationRule extends BaseRule {
  constructor() {
    super({
      id: 'auth-001-context-consolidation',
      category: RuleCategory.CODING_PATTERN,
      severity: RuleSeverity.ERROR,
      description: 'Only NewAuthProvider exists - no legacy AuthContext imports allowed',
      rationale: 'Legacy AuthContext was removed to prevent conflicts and race conditions',
      filePatterns: ['**/*.ts', '**/*.tsx'],
      excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/__tests__/**',
        '**/agents/rules/**',
        '**/agents/__tests__/**'
      ]
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent } = context;

    const lines = getLines(context);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for legacy AuthContext imports (but not NewAuthContext)
      if (
        line.includes('AuthContext') &&
        !line.includes('NewAuthContext') &&
        (line.includes('import') || line.includes('from'))
      ) {
        // Check if it's actually importing AuthContext (not just a comment)
        if (line.trim().startsWith('import') && line.includes('AuthContext')) {
          const snippet = this.extractCodeSnippet(fileContent, i + 1);

          violations.push(
            this.createViolation(
              context,
              'Legacy AuthContext import detected - use NewAuthContext instead',
              i + 1,
              undefined,
              snippet,
              "Replace with: import { useAuth } from '@/contexts/NewAuthContext'"
            )
          );
        }
      }

      // Check for useAuthContext usage (legacy hook)
      if (line.includes('useAuthContext') && !line.includes('//')) {
        const snippet = this.extractCodeSnippet(fileContent, i + 1);

        violations.push(
          this.createViolation(
            context,
            'Legacy useAuthContext hook detected - use useAuth from NewAuthContext instead',
            i + 1,
            undefined,
            snippet,
            "Replace with: const { user, session } = useAuth()"
          )
        );
      }
    }

    return violations;
  }
}
