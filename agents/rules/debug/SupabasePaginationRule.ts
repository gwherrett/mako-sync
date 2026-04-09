/**
 * Rule: Supabase Silent Truncation
 * Queries return max 1000 rows without error - must use explicit .limit() or .range()
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';
import { CodeFix } from '../../core/AutoFix';

export class SupabasePaginationRule extends BaseRule {
  constructor() {
    super({
      id: 'debug-001-supabase-pagination',
      category: RuleCategory.DEBUGGING,
      severity: RuleSeverity.WARNING,
      description: 'Supabase queries return max 1000 rows without error - must use explicit .limit() or .range()',
      rationale: 'Supabase silently truncates results at 1000 rows which can cause hard-to-debug issues',
      filePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
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

    // Skip if file doesn't use Supabase
    if (!fileContent.includes('supabase') || !fileContent.includes('.from(')) {
      return violations;
    }

    const lines = getLines(context);

    // Track if we're inside a multi-line query
    let queryStartLine = -1;
    let queryBuffer = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip import lines
      if (line.trim().startsWith('import')) {
        continue;
      }

      // Check if line contains supabase query start
      if (line.includes('supabase') && line.includes('.from(')) {
        queryStartLine = i + 1;
        queryBuffer = line;

        // Check if query continues on next lines
        let j = i + 1;
        while (j < lines.length && !lines[j].includes(';') && j < i + 20) {
          queryBuffer += ' ' + lines[j];
          j++;
        }

        // Normalize query buffer
        const normalized = queryBuffer.replace(/\s+/g, ' ');

        // Check if query has .select() and is missing both .limit() and .range()
        if (
          normalized.includes('.select(') &&
          !normalized.includes('.limit(') &&
          !normalized.includes('.range(')
        ) {
          const snippet = this.extractCodeSnippet(fileContent, queryStartLine);

          violations.push(
            this.createViolation(
              context,
              'Supabase query without .limit() or .range() - may silently truncate at 1000 rows',
              queryStartLine,
              undefined,
              snippet,
              'Add .limit(n) or .range(start, end) to the query chain'
            )
          );
        }

        // Skip lines we already processed
        i = j - 1;
        queryBuffer = '';
        queryStartLine = -1;
      }
    }

    return violations;
  }

  /**
   * Auto-fix: Add .limit(1000) to the query chain
   *
   * NOTE: This is a complex fix because:
   * 1. The validation logic incorrectly flags import lines
   * 2. Supabase queries are often multi-line
   * 3. We need to find the actual query, not the import
   *
   * For now, returning null to prevent incorrect fixes.
   * The validation logic itself needs to be fixed first.
   */
  autofix(violation: RuleViolation, context: ValidationContext): CodeFix | null {
    // TODO: Fix the validation logic to report correct line numbers
    // then implement proper autofix
    return null;
  }

}
