/**
 * Rule: Service Layer Mandatory
 * Components must never query Supabase directly - always use service layer
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext } from '../../core/types';

export class ServiceLayerRule extends BaseRule {
  constructor() {
    super({
      id: 'code-001-service-layer',
      category: RuleCategory.CODING_PATTERN,
      severity: RuleSeverity.ERROR,
      description: 'Components must not query Supabase directly - use service layer',
      rationale: 'Service layer abstraction improves maintainability and testability',
      filePatterns: ['**/components/**/*.tsx', '**/pages/**/*.tsx'],
      excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/__tests__/**',
        '**/agents/**'
      ]
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent } = context;

    // Check if component imports supabase client
    if (!fileContent.includes('supabase')) {
      return violations;
    }

    const lines = fileContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for direct supabase queries in components
      if (
        (
          line.includes('supabase.from(') ||
          line.includes('supabase.rpc(') ||
          (line.includes('supabase.auth.') && !(line.includes('getSession') || line.includes('onAuthStateChange')))
        ) &&
        !line.includes('//')  // Not a comment
      ) {
        const snippet = this.extractCodeSnippet(fileContent, i + 1);

        violations.push(
          this.createViolation(
            context,
            'Components must not query Supabase directly - use service layer methods instead',
            i + 1,
            undefined,
            snippet,
            'Move this query to a service file in src/services/ and call the service method'
          )
        );
      }
    }

    return violations;
  }
}
