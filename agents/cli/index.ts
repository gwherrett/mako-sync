#!/usr/bin/env node

/**
 * Mako Agents CLI Tool
 * Validates codebase against registered agent rules
 */

import * as path from 'path';
import { AgentRegistry } from '../core/AgentRegistry';
import { debugAgent } from '../agents/DebugAgent';
import { authAgent } from '../agents/AuthAgent';
import { codeAgent } from '../agents/CodeAgent';
import { architectAgent } from '../agents/ArchitectAgent';
import { FileScanner } from './fileScanner';
import { ViolationFormatter } from './formatters';
import { enableTiming, ruleTiming } from '../core/Agent';

interface CLIOptions {
  projectRoot?: string;
  format?: 'detailed' | 'summary' | 'by-file';
  files?: string[];
  agents?: string[];
  outputFormat?: 'text' | 'json';
  changedOnly?: boolean;
  changedBase?: string;
  timing?: boolean;
}

class MakoAgentsCLI {
  private registry: AgentRegistry;
  private scanner: FileScanner;

  constructor(private options: CLIOptions) {
    const projectRoot = options.projectRoot || process.cwd();
    this.scanner = new FileScanner(projectRoot);
    this.registry = AgentRegistry.getInstance();

    // Register agents
    this.registerAgents();
  }

  private registerAgents(): void {
    const { agents } = this.options;

    // If specific agents requested, only register those
    if (agents && agents.length > 0) {
      if (agents.includes('debug')) {
        this.registry.registerAgent(debugAgent);
      }
      if (agents.includes('auth')) {
        this.registry.registerAgent(authAgent);
      }
      if (agents.includes('code')) {
        this.registry.registerAgent(codeAgent);
      }
      if (agents.includes('architect')) {
        this.registry.registerAgent(architectAgent);
      }
    } else {
      // Register all agents by default
      this.registry.registerAgent(debugAgent);
      this.registry.registerAgent(authAgent);
      this.registry.registerAgent(codeAgent);
      this.registry.registerAgent(architectAgent);
    }
  }

  async run(): Promise<number> {
    console.log('\n🤖 Mako Agents - Code Validation Tool\n');

    if (this.options.timing) enableTiming();

    const stats = this.registry.getStats();
    console.log(`Loaded ${stats.agentCount} agent(s) with ${stats.ruleCount} rule(s)\n`);

    // Scan files
    let contexts;
    if (this.options.files) {
      contexts = await this.scanner.scanFiles(this.options.files);
    } else if (this.options.changedOnly) {
      contexts = await this.scanner.scanChangedFiles(this.options.changedBase ?? 'main');
    } else {
      contexts = await this.scanner.scanDirectory();
    }

    console.log(`Scanning ${contexts.length} file(s)...\n`);

    // Validate
    const result = await this.registry.validateFiles(contexts);

    // Output results
    if (this.options.outputFormat === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      this.printResults(result);
    }

    // Print timing table if requested
    if (this.options.timing && ruleTiming.size > 0) {
      this.printTimingTable();
    }

    return result.exitCode;
  }

  private printTimingTable(): void {
    console.log('\n📊 Rule Timing\n');
    const rows = Array.from(ruleTiming.entries())
      .map(([id, { totalMs, count }]) => ({ id, avgMs: totalMs / count, count }))
      .sort((a, b) => b.avgMs - a.avgMs);
    const maxIdLen = Math.max(...rows.map(r => r.id.length), 4);
    console.log(`${'Rule'.padEnd(maxIdLen)}  Avg ms  Files`);
    console.log(`${'-'.repeat(maxIdLen)}  ------  -----`);
    for (const { id, avgMs, count } of rows) {
      console.log(`${id.padEnd(maxIdLen)}  ${avgMs.toFixed(2).padStart(6)}  ${count}`);
    }
    console.log('');
  }

  private printResults(result: any): void {
    const format = this.options.format || 'detailed';

    if (result.violations.length === 0) {
      console.log('\n✅ No violations found!\n');
      console.log(ViolationFormatter.formatSummary(result));
      return;
    }

    // Print violations
    if (format === 'detailed') {
      result.violations.forEach((violation: any, index: number) => {
        console.log(ViolationFormatter.formatViolation(violation, index + 1));
      });
    }

    if (format === 'by-file') {
      console.log(ViolationFormatter.formatByFile(result.violations));
    }

    // Always print summary
    console.log(ViolationFormatter.formatSummary(result));
  }
}

// Parse command line arguments
function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--root' || arg === '-r') {
      options.projectRoot = args[++i];
    } else if (arg === '--format' || arg === '-f') {
      options.format = args[++i] as any;
    } else if (arg === '--files') {
      options.files = args[++i].split(',');
    } else if (arg === '--agents' || arg === '-a') {
      options.agents = args[++i].split(',');
    } else if (arg === '--json') {
      options.outputFormat = 'json';
    } else if (arg === '--changed-only') {
      options.changedOnly = true;
    } else if (arg === '--base') {
      options.changedBase = args[++i];
    } else if (arg === '--timing') {
      options.timing = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Mako Agents CLI - Code Validation Tool

Usage: mako-agents [options]

Options:
  -r, --root <path>        Project root directory (default: current directory)
  -f, --format <format>    Output format: detailed, summary, by-file (default: detailed)
  --files <paths>          Comma-separated list of specific files to validate
  -a, --agents <agents>    Comma-separated list of agents to run (default: all)
  --json                   Output results as JSON
  --changed-only           Only validate files changed vs base ref (git diff)
  --base <ref>             Base ref for --changed-only (default: main)
  --timing                 Print per-rule avg execution time table
  -h, --help               Show this help message

Exit codes:
  0  No violations
  1  Warnings only
  2  One or more errors

Examples:
  mako-agents                                    # Validate entire project
  mako-agents --format by-file                   # Group violations by file
  mako-agents --agents debug,auth                # Run only specific agents
  mako-agents --files src/App.tsx,src/Auth.tsx  # Validate specific files
  mako-agents --json > results.json              # Export results as JSON
  mako-agents --changed-only                     # Validate only changed files
  mako-agents --timing                           # Show rule execution times
  `);
}

// Main execution
if (require.main === module) {
  const options = parseArgs();
  const cli = new MakoAgentsCLI(options);

  cli
    .run()
    .then(exitCode => {
      process.exit(exitCode);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { MakoAgentsCLI };
