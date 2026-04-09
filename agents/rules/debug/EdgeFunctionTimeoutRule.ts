/**
 * Rule: Edge Function Cold Start Timeouts
 * Edge functions need 45+ second timeouts for complex operations
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';

export class EdgeFunctionTimeoutRule extends BaseRule {
  constructor() {
    super({
      id: 'debug-004-edge-function-timeout',
      category: RuleCategory.DEBUGGING,
      severity: RuleSeverity.WARNING,
      description: 'Edge function timeouts should be 45+ seconds for complex operations',
      rationale:
        'Cold-start edge functions with auth, token exchange, and vault operations need longer timeouts',
      filePatterns: ['**/*.ts', '**/*.tsx'],
      excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/supabase/functions/**']
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent } = context;

    // Look for edge function invocations with timeout
    const lines = getLines(context);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for Supabase function invocations
      if (line.includes('.functions.invoke(')) {
        // Look for timeout in nearby lines
        const configBlock = lines
          .slice(i, Math.min(i + 10, lines.length))
          .join('\n');

        // Extract timeout value
        const timeoutMatch = configBlock.match(/timeout[:\s]*(\d+)/);

        if (timeoutMatch) {
          const timeout = parseInt(timeoutMatch[1], 10);

          // Check if timeout is too aggressive (less than 45000ms = 45s)
          if (timeout < 45000) {
            const snippet = this.extractCodeSnippet(fileContent, i + 1);

            violations.push(
              this.createViolation(
                context,
                `Edge function timeout of ${timeout}ms is too low - use 45000ms (45s) or higher for cold starts`,
                i + 1,
                undefined,
                snippet,
                'Increase timeout to at least 45000ms for complex edge function operations'
              )
            );
          }
        }
      }
    }

    return violations;
  }
}
