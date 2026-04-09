/**
 * Rule: State Subscription Pattern
 * Detects subscribe() calls without proper cleanup (memory leak prevention)
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';
import { parseCode, findCallExpressions, findUseEffectHooks, hasCleanupFunction, getNodePosition, getNodeText } from '../../core/ast-utils';
import * as ts from 'typescript';

export class StateSubscriptionRule extends BaseRule {
  constructor() {
    super({
      id: 'architect-001-state-subscription',
      category: RuleCategory.MEMORY_LEAK,
      severity: RuleSeverity.WARNING,
      description: 'Components using subscribe() must call unsubscribe in cleanup',
      rationale: 'Prevents memory leaks from abandoned subscriptions in React components',
      filePatterns: ['**/*.ts', '**/*.tsx'],
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
    const { fileContent, filePath } = context;

    // Only check React component files
    if (!fileContent.includes('useEffect')) {
      return violations;
    }

    try {
      const astContext = parseCode(fileContent, filePath);

      if (!astContext.tsAst) {
        // If AST parsing failed, fall back to regex-based detection
        return this.validateWithRegex(context);
      }

      // Find all subscribe() calls
      const subscribeCallsInUseEffect = this.findSubscribeCallsInUseEffect(astContext.tsAst);

      // Check each subscribe call for proper cleanup
      for (const { subscribeCall, useEffectCall } of subscribeCallsInUseEffect) {
        const hasCleanup = hasCleanupFunction(useEffectCall);

        if (!hasCleanup) {
          const position = getNodePosition(subscribeCall, astContext.tsAst);
          const snippet = this.extractCodeSnippet(fileContent, position.line);

          violations.push(
            this.createViolation(
              context,
              'subscribe() call found without cleanup function - potential memory leak',
              position.line,
              position.column,
              snippet,
              'Add cleanup: return () => { subscription.unsubscribe(); }'
            )
          );
        } else {
          // Check if unsubscribe is called in cleanup
          const cleanupHasUnsubscribe = this.checkCleanupHasUnsubscribe(useEffectCall, astContext.tsAst, subscribeCall);

          if (!cleanupHasUnsubscribe) {
            const position = getNodePosition(subscribeCall, astContext.tsAst);
            const snippet = this.extractCodeSnippet(fileContent, position.line);

            violations.push(
              this.createViolation(
                context,
                'subscribe() call has cleanup but unsubscribe() is not called',
                position.line,
                position.column,
                snippet,
                'Call unsubscribe in cleanup: subscription.unsubscribe()'
              )
            );
          }
        }
      }
    } catch (error) {
      console.error(`Error in StateSubscriptionRule for ${filePath}:`, error);
      // Fall back to regex-based validation
      return this.validateWithRegex(context);
    }

    return violations;
  }

  /**
   * Find subscribe() calls that are within useEffect hooks
   */
  private findSubscribeCallsInUseEffect(ast: ts.SourceFile): Array<{
    subscribeCall: ts.CallExpression;
    useEffectCall: ts.CallExpression;
  }> {
    const results: Array<{ subscribeCall: ts.CallExpression; useEffectCall: ts.CallExpression }> = [];
    const useEffectHooks = findUseEffectHooks(ast);

    for (const useEffectCall of useEffectHooks) {
      // Find subscribe calls within this useEffect
      const subscribeCalls = this.findSubscribeCallsInNode(useEffectCall);

      for (const subscribeCall of subscribeCalls) {
        results.push({ subscribeCall, useEffectCall });
      }
    }

    return results;
  }

  /**
   * Find all subscribe() calls within a node
   */
  private findSubscribeCallsInNode(node: ts.Node): ts.CallExpression[] {
    const subscribeCalls: ts.CallExpression[] = [];

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const expression = n.expression;

        // Check for .subscribe() pattern
        if (ts.isPropertyAccessExpression(expression)) {
          if (expression.name.text === 'subscribe') {
            subscribeCalls.push(n);
          }
        }
      }

      ts.forEachChild(n, visit);
    };

    visit(node);
    return subscribeCalls;
  }

  /**
   * Check if cleanup function contains unsubscribe call
   */
  private checkCleanupHasUnsubscribe(useEffectCall: ts.CallExpression, sourceFile: ts.SourceFile, subscribeCall: ts.CallExpression): boolean {
    if (useEffectCall.arguments.length === 0) return false;

    const callback = useEffectCall.arguments[0];

    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
      return false;
    }

    const body = callback.body;

    if (!ts.isBlock(body)) return false;

    // Look for return statement with cleanup function
    for (const statement of body.statements) {
      if (ts.isReturnStatement(statement) && statement.expression) {
        const cleanupFunc = statement.expression;

        // Check if cleanup function contains 'unsubscribe'
        const cleanupText = getNodeText(cleanupFunc, sourceFile);

        // Pattern 1: cleanup function body contains .unsubscribe()
        if (cleanupText.includes('.unsubscribe()')) {
          return true;
        }

        // Pattern 2: returning a variable/function (check the whole useEffect body for unsubscribe pattern)
        const useEffectBodyText = getNodeText(body, sourceFile);

        // Check if there's a variable assignment with subscribe and it's returned
        if (/const\s+\w+\s*=.*\.subscribe\(/.test(useEffectBodyText) &&
            /return\s+\w+/.test(useEffectBodyText)) {
          // This is the pattern: const unsubscribe = ...subscribe(...); return unsubscribe;
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Fallback validation using regex when AST parsing fails
   */
  private validateWithRegex(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent } = context;
    const lines = getLines(context);

    // Simple pattern: find .subscribe( calls
    const subscribePattern = /\.subscribe\(/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (subscribePattern.test(line)) {
        // Check if we're in a useEffect (naive check)
        let inUseEffect = false;

        // Look backwards for useEffect
        for (let j = Math.max(0, i - 20); j < i; j++) {
          if (lines[j].includes('useEffect')) {
            inUseEffect = true;
            break;
          }
        }

        if (inUseEffect) {
          // Look for cleanup function (return statement in next 10 lines)
          let hasCleanup = false;
          for (let j = i; j < Math.min(lines.length, i + 10); j++) {
            if (lines[j].includes('return') && lines[j].includes('=>')) {
              hasCleanup = true;
              break;
            }
          }

          if (!hasCleanup) {
            const snippet = this.extractCodeSnippet(fileContent, i + 1);
            violations.push(
              this.createViolation(
                context,
                'subscribe() call found without cleanup function - potential memory leak',
                i + 1,
                undefined,
                snippet,
                'Add cleanup: return () => { subscription.unsubscribe(); }'
              )
            );
          }
        }
      }
    }

    return violations;
  }
}
