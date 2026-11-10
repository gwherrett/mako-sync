#!/usr/bin/env node

/**
 * Mako Agents Auto-Fix Tool
 * Automatically fixes rule violations
 */

import * as readline from 'readline';
import { AgentRegistry } from '../core/AgentRegistry';
import { debugAgent } from '../agents/DebugAgent';
import { authAgent } from '../agents/AuthAgent';
import { codeAgent } from '../agents/CodeAgent';
import { architectAgent } from '../agents/ArchitectAgent';
import { FileScanner } from './fileScanner';
import { applyFix, generateDiff, validateFix, rollbackFix, ApplyResult, CodeFix } from '../core/AutoFix';
import { RuleViolation, ValidationContext } from '../core/types';
import * as fs from 'fs';

interface FixOptions {
  projectRoot?: string;
  auto?: boolean; // Auto-fix all without prompting
  dryRun?: boolean; // Show what would be fixed without applying
  rule?: string; // Fix only specific rule
  agents?: string[]; // Fix only from specific agents
}

class MakoAgentsFixCLI {
  private registry: AgentRegistry;
  private scanner: FileScanner;
  private rl: readline.Interface;

  constructor(private options: FixOptions) {
    const projectRoot = options.projectRoot || process.cwd();
    this.scanner = new FileScanner(projectRoot);
    this.registry = AgentRegistry.getInstance();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Register agents
    this.registerAgents();
  }

  private registerAgents(): void {
    const { agents } = this.options;

    if (agents && agents.length > 0) {
      if (agents.includes('debug')) this.registry.registerAgent(debugAgent);
      if (agents.includes('auth')) this.registry.registerAgent(authAgent);
      if (agents.includes('code')) this.registry.registerAgent(codeAgent);
      if (agents.includes('architect')) this.registry.registerAgent(architectAgent);
    } else {
      this.registry.registerAgent(debugAgent);
      this.registry.registerAgent(authAgent);
      this.registry.registerAgent(codeAgent);
      this.registry.registerAgent(architectAgent);
    }
  }

  async run(): Promise<number> {
    console.log('\nðŸ”§ Mako Agents - Auto-Fix Tool\n');

    // Scan and validate
    const contexts = await this.scanner.scanDirectory();
    console.log(`Scanning ${contexts.length} file(s)...\n`);

    const result = await this.registry.validateFiles(contexts);

    // Filter violations that can be auto-fixed
    const fixableViolations = result.violations.filter(v => {
      // Check if rule ID matches filter
      if (this.options.rule && v.ruleId !== this.options.rule) {
        return false;
      }

      // Check if rule supports autofix
      const allRules = this.registry.getAllRules();
      const rule = allRules.find(r => r.config.id === v.ruleId);

      return rule && typeof rule.autofix === 'function';
    });

    if (fixableViolations.length === 0) {
      console.log('âœ… No fixable violations found!\n');
      return 0;
    }

    console.log(`Found ${fixableViolations.length} fixable violation(s)\n`);

    if (this.options.dryRun) {
      return await this.runDryMode(fixableViolations, contexts);
    } else if (this.options.auto) {
      return await this.runAutoMode(fixableViolations, contexts);
    } else {
      return await this.runInteractiveMode(fixableViolations, contexts);
    }
  }

  private async runDryMode(violations: RuleViolation[], contexts: ValidationContext[]): Promise<number> {
    console.log('ðŸ” DRY RUN MODE - No changes will be applied\n');

    let fixCount = 0;

    for (const violation of violations) {
      const context = contexts.find(c => c.filePath === violation.filePath);
      if (!context) continue;

      const fix = this.generateFix(violation, context);
      if (!fix) continue;

      console.log(`\n[${ fixCount + 1}/${violations.length}] ${violation.ruleId}`);
      console.log(`File: ${violation.filePath}:${violation.line}`);
      console.log(`Fix: ${fix.description}\n`);

      const diff = generateDiff(fix, context.fileContent);
      console.log(diff);

      fixCount++;
    }

    console.log(`\nâœ… Would fix ${fixCount} violation(s) (dry run)\n`);
    return 0;
  }

  private async runAutoMode(violations: RuleViolation[], contexts: ValidationContext[]): Promise<number> {
    console.log('âš¡ AUTO MODE - Fixing all violations automatically\n');

    const results: ApplyResult[] = [];

    for (let i = 0; i < violations.length; i++) {
      const violation = violations[i];
      const context = contexts.find(c => c.filePath === violation.filePath);
      if (!context) continue;

      const fix = this.generateFix(violation, context);
      if (!fix) continue;

      console.log(`[${i + 1}/${violations.length}] Fixing ${violation.ruleId} in ${violation.filePath}...`);

      const result = await applyFix(fix);
      results.push(result);

      if (result.success) {
        console.log(`  âœ… Fixed`);
      } else {
        console.log(`  âŒ Failed: ${result.error}`);
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`\nâœ… Fixed ${successCount} violation(s)`);
    if (failCount > 0) {
      console.log(`âŒ Failed to fix ${failCount} violation(s)`);
    }

    return failCount > 0 ? 1 : 0;
  }

  private async runInteractiveMode(violations: RuleViolation[], contexts: ValidationContext[]): Promise<number> {
    console.log('ðŸŽ¯ INTERACTIVE MODE - Review each fix before applying\n');

    const results: ApplyResult[] = [];
    let skipped = 0;

    for (let i = 0; i < violations.length; i++) {
      const violation = violations[i];
      const context = contexts.find(c => c.filePath === violation.filePath);
      if (!context) continue;

      const fix = this.generateFix(violation, context);
      if (!fix) continue;

      console.log(`\n[${ i + 1}/${violations.length}] ${violation.ruleId}`);
      console.log(`File: ${violation.filePath}:${violation.line}`);
      console.log(`Message: ${violation.message}`);
      console.log(`Fix: ${fix.description}\n`);

      const diff = generateDiff(fix, context.fileContent);
      console.log(diff);

      const answer = await this.askQuestion('\nApply this fix? [y]es, [n]o, [a]ll, [q]uit: ');

      if (answer === 'q' || answer === 'quit') {
        console.log('\nâŒ Cancelled by user\n');
        break;
      }

      if (answer === 'a' || answer === 'all') {
        // Apply this and all remaining fixes
        const result = await applyFix(fix);
        results.push(result);

        if (result.success) {
          console.log('âœ… Applied');
        } else {
          console.log(`âŒ Failed: ${result.error}`);
        }

        // Apply remaining fixes automatically
        for (let j = i + 1; j < violations.length; j++) {
          const v = violations[j];
          const ctx = contexts.find(c => c.filePath === v.filePath);
          if (!ctx) continue;

          const f = this.generateFix(v, ctx);
          if (!f) continue;

          console.log(`\n[${j + 1}/${violations.length}] Fixing ${v.ruleId}...`);
          const r = await applyFix(f);
          results.push(r);

          if (r.success) {
            console.log('  âœ… Applied');
          } else {
            console.log(`  âŒ Failed: ${r.error}`);
          }
        }
        break;
      }

      if (answer === 'y' || answer === 'yes') {
        const result = await applyFix(fix);
        results.push(result);

        if (result.success) {
          console.log('âœ… Applied');
        } else {
          console.log(`âŒ Failed: ${result.error}`);
        }
      } else {
        console.log('â­ï¸  Skipped');
        skipped++;
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`\nâœ… Fixed ${successCount} violation(s)`);
    if (skipped > 0) {
      console.log(`â­ï¸  Skipped ${skipped} violation(s)`);
    }
    if (failCount > 0) {
      console.log(`âŒ Failed to fix ${failCount} violation(s)`);
    }

    this.rl.close();
    return failCount > 0 ? 1 : 0;
  }

  private generateFix(violation: RuleViolation, context: ValidationContext): CodeFix | null {
    const allRules = this.registry.getAllRules();
    const rule = allRules.find(r => r.config.id === violation.ruleId);

    if (!rule || !rule.autofix) {
      return null;
    }

    return rule.autofix(violation, context);
  }

  private askQuestion(question: string): Promise<string> {
    return new Promise(resolve => {
      this.rl.question(question, answer => {
        resolve(answer.toLowerCase().trim());
      });
    });
  }
}

// Parse command line arguments
function parseArgs(): FixOptions {
  const args = process.argv.slice(2);
  const options: FixOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--auto') {
      options.auto = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--rule') {
      options.rule = args[++i];
    } else if (arg === '--agents' || arg === '-a') {
      options.agents = args[++i].split(',');
    } else if (arg === '--root' || arg === '-r') {
      options.projectRoot = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Mako Agents Auto-Fix Tool

Usage: agents:fix [options]

Options:
  --auto              Auto-fix all violations without prompting
  --dry-run           Show what would be fixed without applying changes
  --rule <rule-id>    Fix only violations from a specific rule
  -a, --agents <list> Fix only from specific agents (comma-separated)
  -r, --root <path>   Project root directory (default: current directory)
  -h, --help          Show this help message

Examples:
  npm run agents:fix                    # Interactive mode
  npm run agents:fix -- --dry-run       # Preview fixes
  npm run agents:fix -- --auto          # Auto-fix all
  npm run agents:fix -- --rule debug-001-supabase-pagination
  `);
}

// Main execution
if (require.main === module) {
  const options = parseArgs();
  const cli = new MakoAgentsFixCLI(options);

  cli
    .run()
    .then(exitCode => {
      process.exit(exitCode);
    })
    .catch(error => {
      console.error('\nâŒ Fatal error:', error);
      process.exit(1);
    });
}

export { MakoAgentsFixCLI };
