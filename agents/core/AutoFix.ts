/**
 * Auto-Fix Engine
 * Generates and applies code fixes for rule violations
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Position {
  line: number;
  column: number;
}

export interface CodeChange {
  type: 'replace' | 'insert' | 'delete';
  start: Position;
  end: Position;
  oldText: string;
  newText: string;
}

export interface CodeFix {
  description: string;
  filePath: string;
  changes: CodeChange[];
}

export interface ApplyResult {
  success: boolean;
  filePath: string;
  error?: string;
  originalContent?: string; // For rollback
}

/**
 * Generate a unified diff preview of changes
 */
export function generateDiff(fix: CodeFix, fileContent: string): string {
  const lines = fileContent.split('\n');
  let diff = '';

  diff += `\n--- ${fix.filePath}\n`;
  diff += `+++ ${fix.filePath} (fixed)\n`;

  for (const change of fix.changes) {
    const contextBefore = 2;
    const contextAfter = 2;
    const startLine = Math.max(0, change.start.line - contextBefore - 1);
    const endLine = Math.min(lines.length, change.end.line + contextAfter);

    diff += `@@ -${change.start.line},${change.end.line - change.start.line + 1} +${change.start.line},${change.end.line - change.start.line + 1} @@\n`;

    for (let i = startLine; i < endLine; i++) {
      const lineNum = i + 1;

      if (lineNum >= change.start.line && lineNum <= change.end.line) {
        // Show the change
        diff += `- ${lines[i]}\n`;
        diff += `+ ${lines[i].replace(change.oldText, change.newText)}\n`;
      } else {
        // Context lines
        diff += `  ${lines[i]}\n`;
      }
    }
  }

  return diff;
}

/**
 * Apply a code fix to a file
 */
export async function applyFix(fix: CodeFix): Promise<ApplyResult> {
  try {
    // Read the current file content
    const originalContent = fs.readFileSync(fix.filePath, 'utf-8');
    let modifiedContent = originalContent;

    // Apply changes (in reverse order to maintain positions)
    const sortedChanges = [...fix.changes].sort((a, b) => {
      // Sort by line descending, then column descending
      if (b.start.line !== a.start.line) {
        return b.start.line - a.start.line;
      }
      return b.start.column - a.start.column;
    });

    const lines = modifiedContent.split('\n');

    for (const change of sortedChanges) {
      const lineIndex = change.start.line - 1;

      if (lineIndex < 0 || lineIndex >= lines.length) {
        throw new Error(`Invalid line number: ${change.start.line}`);
      }

      const line = lines[lineIndex];

      switch (change.type) {
        case 'replace':
          // Replace text in the line
          if (!line.includes(change.oldText)) {
            throw new Error(
              `Could not find text to replace: "${change.oldText}" at line ${change.start.line}`
            );
          }
          lines[lineIndex] = line.replace(change.oldText, change.newText);
          break;

        case 'insert': {
          // Insert new text at position
          const before = line.substring(0, change.start.column - 1);
          const after = line.substring(change.start.column - 1);
          lines[lineIndex] = before + change.newText + after;
          break;
        }

        case 'delete':
          // Delete text from line
          lines[lineIndex] = line.replace(change.oldText, '');
          break;
      }
    }

    modifiedContent = lines.join('\n');

    // Write the modified content back
    fs.writeFileSync(fix.filePath, modifiedContent, 'utf-8');

    return {
      success: true,
      filePath: fix.filePath,
      originalContent
    };
  } catch (error) {
    return {
      success: false,
      filePath: fix.filePath,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Rollback a fix by restoring original content
 */
export async function rollbackFix(filePath: string, originalContent: string): Promise<boolean> {
  try {
    fs.writeFileSync(filePath, originalContent, 'utf-8');
    return true;
  } catch (error) {
    console.error(`Failed to rollback ${filePath}:`, error);
    return false;
  }
}

/**
 * Validate that a fix can be safely applied
 */
export function validateFix(fix: CodeFix, fileContent: string): { valid: boolean; reason?: string } {
  const lines = fileContent.split('\n');

  for (const change of fix.changes) {
    // Check line bounds
    if (change.start.line < 1 || change.start.line > lines.length) {
      return {
        valid: false,
        reason: `Line ${change.start.line} is out of bounds (file has ${lines.length} lines)`
      };
    }

    // For replace operations, verify the old text exists
    if (change.type === 'replace') {
      const line = lines[change.start.line - 1];
      if (!line.includes(change.oldText)) {
        return {
          valid: false,
          reason: `Cannot find text to replace: "${change.oldText}" at line ${change.start.line}`
        };
      }
    }
  }

  return { valid: true };
}
