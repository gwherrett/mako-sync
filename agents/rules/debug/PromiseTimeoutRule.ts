/**
 * Rule: Promise Timeout Protection
 * Use withTimeout() from src/utils/promiseUtils.ts to prevent hanging operations
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';

export class PromiseTimeoutRule extends BaseRule {
  constructor() {
    super({
      id: 'debug-003-promise-timeout',
      category: RuleCategory.DEBUGGING,
      severity: RuleSeverity.WARNING,
      description: 'Critical auth operations should use withTimeout() to prevent hanging',
      rationale: 'Operations like signOut can hang indefinitely without timeout protection',
      filePatterns: ['**/*.ts', '**/*.tsx'],
      excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/promiseUtils.ts',
        '**/__tests__/**',
        '**/agents/**'
      ]
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent } = context;

    // Check if file has critical auth operations
    const criticalOperations = ['signOut', 'signIn', 'signUp', 'resetPassword'];

    const lines = getLines(context);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if line contains a critical operation without timeout
      for (const operation of criticalOperations) {
        if (line.includes(operation) && line.includes('await')) {
          // Check if withTimeout is used in this or previous lines
          const contextBlock = lines
            .slice(Math.max(0, i - 2), Math.min(i + 3, lines.length))
            .join('\n');

          // Skip if already using timeout protection or retry services
          if (contextBlock.includes('withTimeout') ||
              contextBlock.includes('RetryService') ||
              contextBlock.includes('AuthService.')) {
            continue;
          }

          // Skip if this is inside AuthService (methods already have timeout protection)
          if (fileContent.includes('export class AuthService')) {
            continue;
          }

          // Skip if calling from useAuth hook (hook uses AuthService which has timeout)
          if (fileContent.includes('useAuth()') || fileContent.includes('const { signOut }')) {
            continue;
          }

          // Skip debug/test utilities
          if (context.filePath.includes('authDebugger') ||
              context.filePath.includes('debugHelpers') ||
              context.filePath.includes('test') ||
              context.filePath.includes('__tests__')) {
            continue;
          }

          const snippet = this.extractCodeSnippet(fileContent, i + 1);

          violations.push(
            this.createViolation(
              context,
              `Critical auth operation '${operation}' should use withTimeout() to prevent hanging`,
              i + 1,
              undefined,
              snippet,
              `Wrap with: await withTimeout(supabase.auth.${operation}(...), 10000)`
            )
          );
          break; // Only report once per line
        }
      }
    }

    return violations;
  }
}
