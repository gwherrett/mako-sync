/**
 * Rule: SUPER_GENRES Sorting
 * UI components must sort SUPER_GENRES array before display
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';

export class SuperGenresSortingRule extends BaseRule {
  constructor() {
    super({
      id: 'code-004-super-genres-sorting',
      category: RuleCategory.CODING_PATTERN,
      severity: RuleSeverity.WARNING,
      description: 'SUPER_GENRES must be sorted before display in UI - use [...SUPER_GENRES].sort()',
      rationale: 'SUPER_GENRES array is intentionally unsorted - UI must sort alphabetically',
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

    // Check if file uses SUPER_GENRES
    if (!fileContent.includes('SUPER_GENRES')) {
      return violations;
    }

    const lines = getLines(context);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for SUPER_GENRES usage without sorting
      if (
        line.includes('SUPER_GENRES') &&
        !line.includes('.sort()') &&
        !line.includes('//') && // Not a comment
        (line.includes('.map(') || line.includes('.filter(') || line.includes('forEach'))
      ) {
        const snippet = this.extractCodeSnippet(fileContent, i + 1);

        violations.push(
          this.createViolation(
            context,
            'SUPER_GENRES should be sorted before use in UI - array is intentionally unsorted',
            i + 1,
            undefined,
            snippet,
            'Use [...SUPER_GENRES].sort() instead of SUPER_GENRES directly'
          )
        );
      }
    }

    return violations;
  }
}
