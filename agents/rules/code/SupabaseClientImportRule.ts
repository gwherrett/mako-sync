/**
 * Rule: Supabase Client Import
 * Always use the standard import path for Supabase client
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';

export class SupabaseClientImportRule extends BaseRule {
  constructor() {
    super({
      id: 'code-002-supabase-import',
      category: RuleCategory.CODING_PATTERN,
      severity: RuleSeverity.ERROR,
      description: "Always import supabase from '@/integrations/supabase/client'",
      rationale: 'Ensures consistent Supabase client configuration across the application',
      filePatterns: ['**/*.ts', '**/*.tsx'],
      excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/__tests__/**',
        '**/agents/**',
        '**/integrations/supabase/client.ts'
      ]
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent } = context;

    const lines = getLines(context);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for supabase imports from wrong paths
      if (line.includes('import') && line.includes('supabase') && line.includes('from')) {
        // Should use the standard import path
        if (
          !line.includes('@/integrations/supabase/client') &&
          !line.includes('@supabase/supabase-js') && // Allow importing types
          line.includes('createClient')
        ) {
          const snippet = this.extractCodeSnippet(fileContent, i + 1);

          violations.push(
            this.createViolation(
              context,
              "Supabase client must be imported from '@/integrations/supabase/client'",
              i + 1,
              undefined,
              snippet,
              "Use: import { supabase } from '@/integrations/supabase/client'"
            )
          );
        }
      }
    }

    return violations;
  }
}
