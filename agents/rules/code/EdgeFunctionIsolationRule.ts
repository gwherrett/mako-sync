/**
 * Rule: Edge Function Isolation
 * Edge functions cannot import from src/ directory
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';

export class EdgeFunctionIsolationRule extends BaseRule {
  constructor() {
    super({
      id: 'code-003-edge-function-isolation',
      category: RuleCategory.ARCHITECTURE,
      severity: RuleSeverity.ERROR,
      description: 'Edge functions cannot import from src/ directory - must be self-contained',
      rationale: 'Edge functions run in Deno environment and cannot access application src/ code',
      filePatterns: ['**/supabase/functions/**/*.ts'],
      excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**']
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent, filePath } = context;

    // Only check edge function files
    if (!filePath.includes('supabase/functions/')) {
      return violations;
    }

    const lines = getLines(context);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for imports from src/
      if (line.includes('import') && line.includes('from')) {
        // Look for patterns like '../../../src/' or '@/src/'
        if (line.match(/from\s+['"].*\/src\//)) {
          const snippet = this.extractCodeSnippet(fileContent, i + 1);

          violations.push(
            this.createViolation(
              context,
              'Edge functions cannot import from src/ directory - code must be duplicated or shared via edge function utilities',
              i + 1,
              undefined,
              snippet,
              'Duplicate the needed code within the edge function or create shared utilities in supabase/functions/_shared/'
            )
          );
        }
      }
    }

    return violations;
  }
}
