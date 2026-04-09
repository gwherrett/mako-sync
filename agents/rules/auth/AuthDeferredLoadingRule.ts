/**
 * Rule: Auth Context Deferred Loading
 * User data loading must be deferred with setTimeout to prevent initialization deadlocks
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';
import { CodeFix } from '../../core/AutoFix';

export class AuthDeferredLoadingRule extends BaseRule {
  constructor() {
    super({
      id: 'auth-003-deferred-loading',
      category: RuleCategory.CODING_PATTERN,
      severity: RuleSeverity.WARNING,
      description: 'Auth context user data loading should be deferred with setTimeout',
      rationale: 'Prevents initialization deadlocks in auth context setup',
      filePatterns: ['**/NewAuthContext.tsx', '**/contexts/*Auth*.tsx'],
      excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**']
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent, filePath } = context;

    // Only check auth context files
    if (!filePath.includes('AuthContext') && !filePath.includes('contexts')) {
      return violations;
    }

    // Check if this file has user data loading
    const hasUserDataLoad =
      fileContent.includes('loadUserData') ||
      fileContent.includes('fetchUser') ||
      fileContent.includes('getUserData');

    if (!hasUserDataLoad) {
      return violations;
    }

    const lines = getLines(context);
    let foundDeferredLoad = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if user data loading is wrapped in setTimeout
      if (
        (line.includes('loadUserData') ||
         line.includes('fetchUser') ||
         line.includes('getUserData')) &&
        line.includes('(')
      ) {
        // Check if setTimeout is used in this block
        const contextBlock = lines
          .slice(Math.max(0, i - 3), Math.min(i + 3, lines.length))
          .join('\n');

        if (contextBlock.includes('setTimeout')) {
          foundDeferredLoad = true;
        } else {
          // This is a direct call without deferment
          const snippet = this.extractCodeSnippet(fileContent, i + 1);

          violations.push(
            this.createViolation(
              context,
              'User data loading must be deferred with setTimeout to prevent deadlocks',
              i + 1,
              undefined,
              snippet,
              'Wrap the data loading call in: setTimeout(() => { loadUserData() }, 0)'
            )
          );
        }
      }
    }

    return violations;
  }

  /**
   * Auto-fix: Wrap loadUserData call in setTimeout
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

    // Extract the function call (e.g., "await loadUserData(user.id)")
    const callMatch = line.match(/(await\s+)?(\w+)\([^)]*\)/);

    if (!callMatch) {
      return null;
    }

    const fullCall = callMatch[0];
    const hasAwait = !!callMatch[1];

    // Determine the indentation
    const indent = line.match(/^(\s*)/)?.[1] || '';

    // Create the wrapped version
    let newText: string;

    if (hasAwait) {
      // Can't await inside setTimeout, so remove await and wrap
      const callWithoutAwait = fullCall.replace('await ', '');
      newText = `${indent}setTimeout(() => { ${callWithoutAwait}; }, 0);`;
    } else {
      newText = `${indent}setTimeout(() => { ${fullCall}; }, 0);`;
    }

    return {
      description: 'Wrap user data loading in setTimeout to prevent deadlocks',
      filePath: context.filePath,
      changes: [
        {
          type: 'replace',
          start: { line: violation.line, column: 1 },
          end: { line: violation.line, column: line.length },
          oldText: line,
          newText
        }
      ]
    };
  }
}
