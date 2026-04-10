/**
 * Rule: Connection Check Cooldown
 * Detects multiple rapid calls to connection check without cooldown
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';
import { findCallExpressions, getNodePosition , getAST } from '../../core/ast-utils';
import * as ts from 'typescript';

export class ConnectionCooldownRule extends BaseRule {
  constructor() {
    super({
      id: 'architect-002-connection-cooldown',
      category: RuleCategory.RACE_CONDITION,
      severity: RuleSeverity.WARNING,
      description: 'Connection check calls must respect cooldown or use force: true',
      rationale: 'Prevents race conditions from simultaneous connection checks',
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

    // Look for checkConnection or similar connection check patterns
    const connectionCheckPattern = /checkConnection|verifyConnection|testConnection/i;

    if (!connectionCheckPattern.test(fileContent)) {
      return violations;
    }

    try {
      const astContext = getAST(context);

      if (!astContext || !astContext.tsAst) {
        return this.validateWithRegex(context);
      }

      // Find connection check calls
      const checkConnectionCalls = findCallExpressions(astContext.tsAst, 'checkConnection');

      // Check for rapid successive calls (heuristic: multiple calls in same function)
      const callsByFunction = this.groupCallsByFunction(checkConnectionCalls, astContext.tsAst);

      for (const [functionNode, calls] of callsByFunction) {
        if (calls.length > 1) {
          // Multiple calls in same function - check if any use force: true
          for (const call of calls) {
            const hasForceFlag = this.checkForForceFlag(call, astContext.tsAst);

            if (!hasForceFlag) {
              const position = getNodePosition(call, astContext.tsAst);
              const snippet = this.extractCodeSnippet(fileContent, position.line);

              violations.push(
                this.createViolation(
                  context,
                  'Multiple connection checks detected without force flag - potential race condition',
                  position.line,
                  position.column,
                  snippet,
                  'Use cooldown logic or add force: true to bypass'
                )
              );
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error in ConnectionCooldownRule for ${filePath}:`, error);
      return this.validateWithRegex(context);
    }

    return violations;
  }

  /**
   * Group call expressions by their containing function
   */
  private groupCallsByFunction(
    calls: ts.CallExpression[],
    ast: ts.SourceFile
  ): Map<ts.Node, ts.CallExpression[]> {
    const groups = new Map<ts.Node, ts.CallExpression[]>();

    for (const call of calls) {
      const containingFunction = this.findContainingFunction(call);
      const key = containingFunction || ast; // Use source file as key if no containing function

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(call);
    }

    return groups;
  }

  /**
   * Find the containing function for a node
   */
  private findContainingFunction(node: ts.Node): ts.Node | null {
    let current = node.parent;

    while (current) {
      if (
        ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isArrowFunction(current) ||
        ts.isMethodDeclaration(current)
      ) {
        return current;
      }
      current = current.parent;
    }

    return null;
  }

  /**
   * Check if a call expression has force: true argument
   */
  private checkForForceFlag(call: ts.CallExpression, ast: ts.SourceFile): boolean {
    if (call.arguments.length === 0) return false;

    // Check for object literal with force: true
    for (const arg of call.arguments) {
      if (ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const name = prop.name;
            if (ts.isIdentifier(name) && name.text === 'force') {
              // Check if value is true
              if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
                return true;
              }
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Fallback validation using regex
   */
  private validateWithRegex(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent } = context;
    const lines = getLines(context);

    // Find all checkConnection calls
    const checkConnectionPattern = /checkConnection\s*\(/g;
    const callLines: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (checkConnectionPattern.test(lines[i])) {
        callLines.push(i);
      }
    }

    // If multiple calls within 20 lines, flag as potential issue
    for (let i = 0; i < callLines.length - 1; i++) {
      const currentLine = callLines[i];
      const nextLine = callLines[i + 1];

      if (nextLine - currentLine < 20) {
        // Check if either call has force: true
        const hasForce = lines[currentLine].includes('force') || lines[nextLine].includes('force');

        if (!hasForce) {
          const snippet = this.extractCodeSnippet(fileContent, currentLine + 1);
          violations.push(
            this.createViolation(
              context,
              'Multiple connection checks detected without force flag - potential race condition',
              currentLine + 1,
              undefined,
              snippet,
              'Use cooldown logic or add force: true to bypass'
            )
          );
        }
      }
    }

    return violations;
  }
}
