/**
 * Rule: Error Classification
 * Detects generic Error usage instead of specific error types
 */

import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext, getLines } from '../../core/types';
import { parseCode, findNodes, getNodePosition } from '../../core/ast-utils';
import * as ts from 'typescript';

export class ErrorClassificationRule extends BaseRule {
  // Specific error types that should be used
  private readonly SPECIFIC_ERROR_TYPES = [
    'NetworkError',
    'TimeoutError',
    'AuthenticationError',
    'AuthorizationError',
    'ValidationError',
    'NotFoundError',
    'ConflictError',
    'ServerError'
  ];

  constructor() {
    super({
      id: 'architect-004-error-classification',
      category: RuleCategory.ERROR_HANDLING,
      severity: RuleSeverity.WARNING,
      description: 'Use specific error types (NetworkError, TimeoutError) instead of generic Error',
      rationale: 'Enables proper error handling and differentiation between network, server, and client errors',
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

    // Skip files that don't throw errors
    if (!fileContent.includes('throw') && !fileContent.includes('new Error')) {
      return violations;
    }

    try {
      const astContext = parseCode(fileContent, filePath);

      if (!astContext.tsAst) {
        return this.validateWithRegex(context);
      }

      // Find all throw statements
      const throwStatements = findNodes(astContext.tsAst, ts.SyntaxKind.ThrowStatement) as ts.ThrowStatement[];

      for (const throwStmt of throwStatements) {
        const expression = throwStmt.expression;

        if (expression && ts.isNewExpression(expression)) {
          const typeName = this.getTypeName(expression);

          // Check if throwing generic Error
          if (typeName === 'Error') {
            const position = getNodePosition(throwStmt, astContext.tsAst);
            const snippet = this.extractCodeSnippet(fileContent, position.line);

            // Get context to suggest appropriate error type
            const suggestedType = this.suggestErrorType(throwStmt, fileContent);

            violations.push(
              this.createViolation(
                context,
                `Use specific error type instead of generic Error`,
                position.line,
                position.column,
                snippet,
                `Consider using: throw new ${suggestedType}(...)`
              )
            );
          }
        }
      }

      // Check for error type differentiation in catch blocks
      this.checkCatchBlocks(context, astContext.tsAst, violations);

    } catch (error) {
      console.error(`Error in ErrorClassificationRule for ${filePath}:`, error);
      return this.validateWithRegex(context);
    }

    return violations;
  }

  /**
   * Get the type name from a new expression
   */
  private getTypeName(newExpr: ts.NewExpression): string {
    const expression = newExpr.expression;

    if (ts.isIdentifier(expression)) {
      return expression.text;
    }

    return '';
  }

  /**
   * Suggest appropriate error type based on context
   */
  private suggestErrorType(throwStmt: ts.ThrowStatement, fileContent: string): string {
    const expression = throwStmt.expression;

    if (expression && ts.isNewExpression(expression)) {
      // Get error message if available
      const args = expression.arguments;
      if (args && args.length > 0) {
        const firstArg = args[0];
        if (ts.isStringLiteral(firstArg)) {
          const message = firstArg.text.toLowerCase();

          // Suggest based on message content
          if (message.includes('network') || message.includes('connection')) {
            return 'NetworkError';
          }
          if (message.includes('timeout')) {
            return 'TimeoutError';
          }
          if (message.includes('auth')) {
            return 'AuthenticationError';
          }
          if (message.includes('not found')) {
            return 'NotFoundError';
          }
          if (message.includes('validation') || message.includes('invalid')) {
            return 'ValidationError';
          }
          if (message.includes('server')) {
            return 'ServerError';
          }
        }
      }
    }

    // Check surrounding code context
    const surroundingCode = this.getSurroundingCode(throwStmt, fileContent, 10);

    if (/fetch|axios|http|request/i.test(surroundingCode)) {
      return 'NetworkError';
    }
    if (/timeout|delay/i.test(surroundingCode)) {
      return 'TimeoutError';
    }
    if (/auth|login|token/i.test(surroundingCode)) {
      return 'AuthenticationError';
    }

    return 'CustomError';
  }

  /**
   * Get surrounding code context
   */
  private getSurroundingCode(node: ts.Node, fileContent: string, linesBefore: number): string {
    const sourceFile = node.getSourceFile();
    const position = node.getStart();
    const { line } = sourceFile.getLineAndCharacterOfPosition(position);

    const lines = fileContent.split('\n');
    const startLine = Math.max(0, line - linesBefore);
    const endLine = Math.min(lines.length, line + linesBefore);

    return lines.slice(startLine, endLine).join('\n');
  }

  /**
   * Check catch blocks for proper error type differentiation
   */
  private checkCatchBlocks(
    context: ValidationContext,
    ast: ts.SourceFile,
    violations: RuleViolation[]
  ): void {
    const catchClauses = findNodes(ast, ts.SyntaxKind.CatchClause) as ts.CatchClause[];

    for (const catchClause of catchClauses) {
      const block = catchClause.block;

      // Check if catch block differentiates error types
      const hasTypeCheck = this.hasErrorTypeCheck(block, ast);

      if (!hasTypeCheck && block.statements.length > 2) {
        // Only flag if catch block is non-trivial
        const position = getNodePosition(catchClause, ast);
        const snippet = this.extractCodeSnippet(context.fileContent, position.line);

        violations.push(
          this.createViolation(
            context,
            'Catch block should differentiate between error types (network vs server vs client)',
            position.line,
            position.column,
            snippet,
            'Use instanceof checks to handle different error types appropriately'
          )
        );
      }
    }
  }

  /**
   * Check if a block has error type checking
   */
  private hasErrorTypeCheck(block: ts.Block, ast: ts.SourceFile): boolean {
    let hasCheck = false;

    const visit = (node: ts.Node) => {
      // Look for instanceof checks
      if (ts.isBinaryExpression(node)) {
        if (node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
          hasCheck = true;
          return;
        }
      }

      // Look for error.name checks
      if (ts.isPropertyAccessExpression(node)) {
        if (ts.isIdentifier(node.name) && node.name.text === 'name') {
          hasCheck = true;
          return;
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(block);
    return hasCheck;
  }

  /**
   * Fallback validation using regex
   */
  private validateWithRegex(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const { fileContent } = context;
    const lines = getLines(context);

    // Pattern for throw new Error(
    const genericErrorPattern = /throw\s+new\s+Error\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (genericErrorPattern.test(line) && !line.trim().startsWith('//')) {
        const snippet = this.extractCodeSnippet(fileContent, i + 1);

        // Suggest based on surrounding context
        const surroundingLines = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 5)).join('\n');
        let suggestedType = 'CustomError';

        if (/network|fetch|http/i.test(surroundingLines)) {
          suggestedType = 'NetworkError';
        } else if (/timeout/i.test(surroundingLines)) {
          suggestedType = 'TimeoutError';
        } else if (/auth/i.test(surroundingLines)) {
          suggestedType = 'AuthenticationError';
        }

        violations.push(
          this.createViolation(
            context,
            'Use specific error type instead of generic Error',
            i + 1,
            undefined,
            snippet,
            `Consider using: throw new ${suggestedType}(...)`
          )
        );
      }
    }

    return violations;
  }
}
