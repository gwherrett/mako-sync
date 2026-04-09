/**
 * Rule: Auth Import Pattern
 * Always import from @/contexts/NewAuthContext
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';
import { CodeFix } from '../../core/AutoFix';

export class AuthImportPatternRule extends BaseRule {
  constructor() {
    super({
      id: 'auth-002-import-pattern',
      category: RuleCategory.CODING_PATTERN,
      severity: RuleSeverity.ERROR,
      description: "Auth imports must use '@/contexts/NewAuthContext' path",
      rationale: 'Ensures consistent auth context usage across the application',
      filePatterns: ['**/*.ts', '**/*.tsx'],
      excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/NewAuthContext.tsx',
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

      // Check for auth-related imports from wrong paths
      // Match exact 'useAuth' import (not useAuthRedirect, useAuthState, etc.)
      if (line.includes('import') && /\buseAuth\b/.test(line)) {
        // Check if it's importing from the correct path
        if (!line.includes('@/contexts/NewAuthContext')) {
          // Could be importing from relative path or different location
          const snippet = this.extractCodeSnippet(fileContent, i + 1);

          violations.push(
            this.createViolation(
              context,
              "Auth imports must use '@/contexts/NewAuthContext' path",
              i + 1,
              undefined,
              snippet,
              "Use: import { useAuth } from '@/contexts/NewAuthContext'"
            )
          );
        }
      }

      // Check for AuthProvider imports (should use NewAuthProvider)
      if (line.includes('import') && line.includes('AuthProvider') && !line.includes('NewAuthProvider')) {
        const snippet = this.extractCodeSnippet(fileContent, i + 1);

        violations.push(
          this.createViolation(
            context,
            'Use NewAuthProvider instead of AuthProvider',
            i + 1,
            undefined,
            snippet,
            "Import: import { NewAuthProvider } from '@/contexts/NewAuthContext'"
          )
        );
      }
    }

    return violations;
  }

  /**
   * Auto-fix: Replace import path with correct '@/contexts/NewAuthContext'
   */
  autofix(violation: RuleViolation, context: ValidationContext): CodeFix | null {
    const { fileContent } = context;
    const lines = getLines(context);

    if (!violation.line) {
      return null;
    }

    const lineIndex = violation.line - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      return null;
    }

    const line = lines[lineIndex];

    // Detect which type of fix is needed
    let oldText: string;
    let newText: string;

    if (line.includes('useAuth') && !line.includes('@/contexts/NewAuthContext')) {
      // Fix useAuth import path
      // Match patterns like: from '../contexts/AuthContext' or from './AuthContext'
      const fromMatch = line.match(/from\s+['"]([^'"]+)['"]/);

      if (fromMatch) {
        oldText = fromMatch[0]; // e.g., "from '../contexts/AuthContext'"
        newText = "from '@/contexts/NewAuthContext'";
      } else {
        return null; // Can't parse the import
      }
    } else if (line.includes('AuthProvider') && !line.includes('NewAuthProvider')) {
      // Fix AuthProvider -> NewAuthProvider
      oldText = 'AuthProvider';
      newText = 'NewAuthProvider';

      // Also fix the path if needed
      const fromMatch = line.match(/from\s+['"]([^'"]+)['"]/);
      if (fromMatch && !fromMatch[1].includes('@/contexts/NewAuthContext')) {
        // Need to fix both the name and the path
        const pathOld = fromMatch[0];
        const pathNew = "from '@/contexts/NewAuthContext'";

        return {
          description: "Fix import: use NewAuthProvider from '@/contexts/NewAuthContext'",
          filePath: context.filePath,
          changes: [
            {
              type: 'replace',
              start: { line: violation.line, column: 1 },
              end: { line: violation.line, column: line.length },
              oldText: 'AuthProvider',
              newText: 'NewAuthProvider'
            },
            {
              type: 'replace',
              start: { line: violation.line, column: 1 },
              end: { line: violation.line, column: line.length },
              oldText: pathOld,
              newText: pathNew
            }
          ]
        };
      }
    } else {
      return null;
    }

    return {
      description: "Fix import path to use '@/contexts/NewAuthContext'",
      filePath: context.filePath,
      changes: [
        {
          type: 'replace',
          start: { line: violation.line, column: 1 },
          end: { line: violation.line, column: line.length },
          oldText,
          newText
        }
      ]
    };
  }
}
