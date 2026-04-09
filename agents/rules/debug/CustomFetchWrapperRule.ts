/**
 * Rule: Custom Fetch Wrapper Conflicts
 * Supabase client custom fetch wrappers with AbortController conflict with SDK's internal handling
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';

export class CustomFetchWrapperRule extends BaseRule {
  constructor() {
    super({
      id: 'debug-002-custom-fetch-wrapper',
      category: RuleCategory.DEBUGGING,
      severity: RuleSeverity.ERROR,
      description: 'Supabase client must not use custom fetch wrappers with AbortController',
      rationale: 'Custom fetch wrappers with AbortController conflict with Supabase SDK internal handling',
      filePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
      excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**']
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent } = context;

    // Check if file creates Supabase client
    if (!fileContent.includes('createClient') && !fileContent.includes('supabase')) {
      return violations;
    }

    const lines = getLines(context);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for custom fetch configuration with AbortController
      if (
        (line.includes('createClient') || line.includes('supabase')) &&
        this.hasCustomFetchWithAbort(lines, i)
      ) {
        const snippet = this.extractCodeSnippet(fileContent, i + 1);

        violations.push(
          this.createViolation(
            context,
            'Supabase client configuration should not include custom fetch with AbortController',
            i + 1,
            undefined,
            snippet,
            'Remove custom fetch wrapper and use default SDK configuration'
          )
        );
      }
    }

    return violations;
  }

  private hasCustomFetchWithAbort(lines: string[], startLine: number): boolean {
    // Look for custom fetch configuration in the next 20 lines
    const configBlock = lines
      .slice(startLine, Math.min(startLine + 20, lines.length))
      .join('\n');

    // Check for patterns indicating custom fetch with AbortController
    return (
      (configBlock.includes('global:') || configBlock.includes('fetch:')) &&
      (configBlock.includes('AbortController') || configBlock.includes('signal:'))
    );
  }
}
