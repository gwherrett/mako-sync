/**
 * Rule: Auth Context Initialization Guard
 * Auth context must use useRef to prevent double-initialization
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';

export class AuthInitializationGuardRule extends BaseRule {
  constructor() {
    super({
      id: 'auth-004-initialization-guard',
      category: RuleCategory.CODING_PATTERN,
      severity: RuleSeverity.ERROR,
      description: 'Auth context must use useRef initialization guard to prevent double-initialization',
      rationale: 'Prevents race conditions and duplicate auth state initialization',
      filePatterns: ['**/NewAuthContext.tsx', '**/contexts/*Auth*.tsx'],
      excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**']
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent, filePath } = context;

    // Only check auth context provider files
    if (
      !filePath.includes('AuthContext') &&
      !filePath.includes('AuthProvider') &&
      !filePath.includes('contexts')
    ) {
      return violations;
    }

    // Check if this is a provider component
    if (!fileContent.includes('Provider') && !fileContent.includes('Context')) {
      return violations;
    }

    const lines = getLines(context);
    let hasUseRef = false;
    let hasInitializationCheck = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for useRef for initialization tracking
      if (
        line.includes('useRef') &&
        (line.includes('initialization') || line.includes('initialized') || line.includes('init'))
      ) {
        hasUseRef = true;
      }

      // Check for initialization guard pattern
      if (
        line.includes('current') &&
        (line.includes('initialization') || line.includes('initialized')) &&
        line.includes('if')
      ) {
        hasInitializationCheck = true;
      }
    }

    // If this looks like an auth provider but doesn't have initialization guard
    if (
      (fileContent.includes('AuthProvider') || fileContent.includes('NewAuthProvider')) &&
      (!hasUseRef || !hasInitializationCheck)
    ) {
      violations.push(
        this.createViolation(
          context,
          'Auth context provider must use useRef initialization guard to prevent double-initialization',
          1,
          undefined,
          'const initializationRef = useRef(false);\n  if (initializationRef.current) return;',
          'Add: const initializationRef = useRef(false); and check initializationRef.current before initialization'
        )
      );
    }

    return violations;
  }
}
