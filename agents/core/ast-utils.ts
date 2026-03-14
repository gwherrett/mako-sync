/**
 * AST Utilities for advanced code analysis
 * Uses TypeScript Compiler API for parsing and traversal
 */

import * as ts from 'typescript';
import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';

export interface ASTContext {
  /** Original source code */
  sourceCode: string;
  /** File path being analyzed */
  filePath: string;
  /** TypeScript AST */
  tsAst?: ts.SourceFile;
  /** ESTree AST (more compatible with ESLint patterns) */
  estree?: TSESTree.Program;
}

/**
 * Parse TypeScript/JavaScript code into AST
 */
export function parseCode(code: string, filePath: string): ASTContext {
  const context: ASTContext = {
    sourceCode: code,
    filePath
  };

  try {
    // Parse using TypeScript compiler API
    context.tsAst = ts.createSourceFile(
      filePath,
      code,
      ts.ScriptTarget.Latest,
      true // setParentNodes
    );

    // Parse using typescript-estree for ESLint-compatible AST
    context.estree = parse(code, {
      loc: true,
      range: true,
      tokens: false,
      comment: false,
      jsx: filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
    });
  } catch (error) {
    // If parsing fails, return context with just source code
    console.error(`Failed to parse ${filePath}:`, error);
  }

  return context;
}

/**
 * Find all nodes of a specific kind in the AST
 */
export function findNodes(
  node: ts.Node,
  kind: ts.SyntaxKind,
  results: ts.Node[] = []
): ts.Node[] {
  if (node.kind === kind) {
    results.push(node);
  }

  ts.forEachChild(node, child => { findNodes(child, kind, results); });
  return results;
}

/**
 * Find all call expressions with a specific method name
 */
export function findCallExpressions(
  ast: ts.SourceFile,
  methodName: string
): ts.CallExpression[] {
  const callExpressions: ts.CallExpression[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;

      // Check for direct method calls: obj.method()
      if (ts.isPropertyAccessExpression(expression)) {
        if (expression.name.text === methodName) {
          callExpressions.push(node);
        }
      }
      // Check for direct function calls: method()
      else if (ts.isIdentifier(expression)) {
        if (expression.text === methodName) {
          callExpressions.push(node);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(ast);
  return callExpressions;
}

/**
 * Find all useEffect hooks in the code
 */
export function findUseEffectHooks(ast: ts.SourceFile): ts.CallExpression[] {
  return findCallExpressions(ast, 'useEffect');
}

/**
 * Get the text content of a node
 */
export function getNodeText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile);
}

/**
 * Get line and column position from a node
 */
export function getNodePosition(node: ts.Node, sourceFile: ts.SourceFile): {
  line: number;
  column: number;
} {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return { line: line + 1, column: character + 1 }; // Convert to 1-based
}

/**
 * Check if a node is within a specific parent node type
 */
export function isWithinNodeType(node: ts.Node, parentKind: ts.SyntaxKind): boolean {
  let current = node.parent;
  while (current) {
    if (current.kind === parentKind) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Find import declarations
 */
export function findImports(ast: ts.SourceFile): ts.ImportDeclaration[] {
  const imports: ts.ImportDeclaration[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      imports.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(ast);
  return imports;
}

/**
 * Check if code contains a specific identifier
 */
export function hasIdentifier(ast: ts.SourceFile, identifierName: string): boolean {
  let found = false;

  function visit(node: ts.Node) {
    if (found) return;

    if (ts.isIdentifier(node) && node.text === identifierName) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(ast);
  return found;
}

/**
 * Extract function/method body
 */
export function getFunctionBody(
  node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
): ts.Block | ts.ConciseBody | undefined {
  return node.body;
}

/**
 * Check if a useEffect has cleanup (return function)
 */
export function hasCleanupFunction(useEffectCall: ts.CallExpression): boolean {
  if (useEffectCall.arguments.length === 0) return false;

  const callback = useEffectCall.arguments[0];

  // Check if callback is an arrow function or function expression
  if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
    const body = callback.body;

    // If body is a block, check for return statement
    if (ts.isBlock(body)) {
      for (const statement of body.statements) {
        if (ts.isReturnStatement(statement) && statement.expression) {
          // Check if return value is a function
          if (
            ts.isArrowFunction(statement.expression) ||
            ts.isFunctionExpression(statement.expression)
          ) {
            return true;
          }
        }
      }
    }
  }

  return false;
}
