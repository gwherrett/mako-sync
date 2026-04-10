/**
 * File scanner for finding and reading files to validate
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ValidationContext } from '../core/types';

export class FileScanner {
  private excludePatterns: string[] = [
    'node_modules',
    'dist',
    'build',
    '.git',
    'coverage',
    '.next',
    'out'
  ];

  constructor(private projectRoot: string) {}

  /**
   * Scan directory recursively for files matching patterns
   */
  async scanDirectory(
    directory: string = this.projectRoot,
    extensions: string[] = ['.ts', '.tsx', '.js', '.jsx']
  ): Promise<ValidationContext[]> {
    const contexts: ValidationContext[] = [];

    const scanRecursive = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip excluded directories
        if (entry.isDirectory()) {
          if (!this.shouldExclude(entry.name)) {
            scanRecursive(fullPath);
          }
          continue;
        }

        // Process files matching extensions
        if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            try {
              const fileContent = fs.readFileSync(fullPath, 'utf-8');
              contexts.push({
                fileContent,
                filePath: fullPath,
                fileExtension: ext,
                projectRoot: this.projectRoot
              });
            } catch (error) {
              console.error(`Error reading file ${fullPath}:`, error);
            }
          }
        }
      }
    };

    scanRecursive(directory);
    return contexts;
  }

  /**
   * Scan specific files
   */
  async scanFiles(filePaths: string[]): Promise<ValidationContext[]> {
    const contexts: ValidationContext[] = [];

    for (const filePath of filePaths) {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.projectRoot, filePath);

      if (!fs.existsSync(fullPath)) {
        console.warn(`File not found: ${fullPath}`);
        continue;
      }

      try {
        const fileContent = fs.readFileSync(fullPath, 'utf-8');
        const ext = path.extname(fullPath);

        contexts.push({
          fileContent,
          filePath: fullPath,
          fileExtension: ext,
          projectRoot: this.projectRoot
        });
      } catch (error) {
        console.error(`Error reading file ${fullPath}:`, error);
      }
    }

    return contexts;
  }

  /**
   * Scan only files changed relative to baseRef (git diff --name-only)
   */
  async scanChangedFiles(baseRef = 'main'): Promise<ValidationContext[]> {
    try {
      const output = execSync(`git diff --name-only ${baseRef}...HEAD`, {
        cwd: this.projectRoot,
        encoding: 'utf-8'
      });
      const changedFiles = output
        .split('\n')
        .map(f => f.trim())
        .filter(f => /\.(ts|tsx)$/.test(f));
      return this.scanFiles(changedFiles);
    } catch (error) {
      console.warn('git diff failed, falling back to full scan:', error);
      return this.scanDirectory();
    }
  }

  private shouldExclude(name: string): boolean {
    return this.excludePatterns.some(pattern => name.includes(pattern));
  }

  addExcludePattern(pattern: string): void {
    this.excludePatterns.push(pattern);
  }
}
