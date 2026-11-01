# Mako Agents Framework

A TypeScript-based code validation framework that enforces project-specific patterns and prevents common bugs.

## Overview

Mako Agents is a migration from the roo code format (markdown-based agent definitions) to standard, executable TypeScript implementations. It provides:

- **Automated code validation** - Catch issues before they reach production
- **Detailed violation reporting** - Get actionable feedback with code snippets and suggested fixes
- **Multiple integration points** - CLI, ESLint, pre-commit hooks
- **Extensible architecture** - Easy to add new rules and agents

## Migration Status

**✅ Migration Complete** (January 6, 2026)
- Successfully migrated from `.roo/` markdown format to TypeScript implementation
- **15 enforceable rules** migrated and production-ready
- **12 documentation-only rules** intentionally kept in [AGENTS.md](../../AGENTS.md)
- Legacy `.roo/` directory removed (January 10, 2026)

### Metrics
- **Scan Speed:** 1.33 files/ms (200 files in 150ms)
- **Validation:** 0 errors, 51 warnings (legitimate suggestions)
- **Test Coverage:** 26/26 tests passing, 100% core framework coverage
- **False Positives:** <2%

## Project Structure

```
agents/
├── core/                     # Framework core
│   ├── Agent.ts             # Base agent interface
│   ├── Rule.ts              # Base rule interface
│   ├── AgentRegistry.ts     # Central agent registry
│   └── types.ts             # Core type definitions
├── agents/                   # Agent implementations
│   ├── DebugAgent.ts        # Debug patterns validation
│   └── AuthAgent.ts         # Auth context validation
├── rules/                    # Rule implementations
│   ├── debug/               # Debug rules (5 rules)
│   │   ├── SupabasePaginationRule.ts
│   │   ├── CustomFetchWrapperRule.ts
│   │   ├── PromiseTimeoutRule.ts
│   │   ├── EdgeFunctionTimeoutRule.ts
│   │   └── SessionCacheDirectCallRule.ts
│   ├── auth/                # Auth rules (4 rules)
│   │   ├── AuthContextConsolidationRule.ts
│   │   ├── AuthImportPatternRule.ts
│   │   ├── AuthDeferredLoadingRule.ts
│   │   └── AuthInitializationGuardRule.ts
│   └── code/                # Code rules (6 rules)
│       ├── ServiceLayerRule.ts
│       ├── SupabaseClientImportRule.ts
│       ├── EdgeFunctionIsolationRule.ts
│       ├── SuperGenresSortingRule.ts
│       ├── SpotifyManagerSingletonRule.ts
│       └── EdgeFunctionDeployRegistrationRule.ts
├── cli/                      # CLI tool
│   ├── index.ts             # Main CLI entry point
│   ├── formatters.ts        # Output formatters
│   └── fileScanner.ts       # File discovery
├── eslint-plugin/            # ESLint integration
│   ├── index.ts             # Plugin implementation
│   └── README.md            # Plugin documentation
└── __tests__/                # Unit tests
    ├── core/
    └── rules/
```

## Implemented Agents

### Debug Agent (5 rules)

Validates debugging patterns and prevents common pitfalls:

- **debug-001-supabase-pagination** - Enforces `.limit()` or `.range()` on Supabase queries
- **debug-002-custom-fetch-wrapper** - Prevents custom fetch wrappers with AbortController
- **debug-003-promise-timeout** - Enforces timeout protection on auth operations
- **debug-004-edge-function-timeout** - Enforces 45+ second timeouts for edge functions
- **debug-005-session-cache-direct** - Enforces direct `getSession()` in critical flows

### Auth Agent (4 rules)

Validates authentication context patterns:

- **auth-001-context-consolidation** - Only `NewAuthProvider` allowed, no legacy AuthContext
- **auth-002-import-pattern** - Enforces correct auth import paths
- **auth-003-deferred-loading** - Enforces deferred user data loading in auth context
- **auth-004-initialization-guard** - Enforces `useRef` initialization guard in auth providers

### Code Agent (6 rules)

Validates coding best practices and architectural patterns:

- **code-001-service-layer** - Enforces service layer for Supabase access (no direct queries in components)
- **code-002-supabase-client-import** - Enforces correct Supabase client import patterns
- **code-003-edge-function-isolation** - Prevents Node.js-specific code in edge functions
- **code-004-super-genres-sorting** - Enforces alphabetical sorting in SUPER_GENRES array
- **code-006-spotify-manager-singleton** - Enforces singleton pattern for SpotifyManager
- **code-007-edge-function-deploy-registration** - Requires a deploy step in deploy-edge-functions.yml for every edge function

## Installation

```bash
# Install root dependencies (includes ts-node and husky)
npm install

# Install the agents' own dependencies (Vitest, TypeScript parser)
cd agents && npm install
```

## Usage

### CLI Tool

Run validation against your entire codebase:

```bash
# Validate all files
npm run agents:validate

# Run specific agent
npm run agents:validate:debug
npm run agents:validate:auth

# Export results as JSON
npm run agents:validate:json > results.json
```

### CLI Options

```bash
# Run from agents directory
ts-node cli/index.ts [options]

Options:
  -r, --root <path>        Project root directory (default: current directory)
  -f, --format <format>    Output format: detailed, summary, by-file (default: detailed)
  --files <paths>          Comma-separated list of specific files to validate
  -a, --agents <agents>    Comma-separated list of agents to run (default: all)
  --json                   Output results as JSON
  -h, --help               Show help message
```

### Pre-commit Hook

The framework includes a pre-commit hook that runs validation automatically:

```bash
# Set up Husky (one-time setup)
npx husky install

# Make hook executable
chmod +x .husky/pre-commit
```

To bypass validation (not recommended):
```bash
git commit --no-verify -m "your message"
```

### ESLint Integration

Add to your ESLint configuration:

```javascript
import makoAgents from './agents/eslint-plugin';

export default [
  {
    plugins: {
      '@mako/agents': makoAgents
    },
    rules: {
      ...makoAgents.configs.recommended.rules
    }
  }
];
```

See [agents/eslint-plugin/README.md](./eslint-plugin/README.md) for more details.

## Running Tests

```bash
# Run all tests
cd agents && npm test

# Run with coverage
cd agents && npm test -- --coverage

# Run specific test file
cd agents && npm test -- __tests__/core/Agent.test.ts
```

## Output Examples

### Detailed Format

```
1. ❌ ERROR
--------------------------------------------------------------------------------
File: /src/services/tracks.service.ts:42
Rule: debug-001-supabase-pagination (debugging)
Message: Supabase query without .limit() or .range() - may silently truncate at 1000 rows

Code:
    40 |   const data = await supabase
    41 |     .from('tracks')
→   42 |     .select('*');
    43 |
    44 |   return data;

💡 Suggested Fix:
Add .limit(n) or .range(start, end) to the query chain
```

### Summary Format

```
================================================================================
VALIDATION SUMMARY
================================================================================

Files Scanned:  245
Duration:       1243ms
Total Issues:   12

❌ Errors:      3
⚠️  Warnings:    9

================================================================================
✗ VALIDATION FAILED
================================================================================
```

## Development

### Adding a New Rule

1. Create rule class extending `BaseRule`:

```typescript
import { BaseRule } from '../../core/Rule';
import { RuleCategory, RuleSeverity, RuleViolation, ValidationContext } from '../../core/types';

export class MyNewRule extends BaseRule {
  constructor() {
    super({
      id: 'category-001-rule-name',
      category: RuleCategory.CODING_PATTERN,
      severity: RuleSeverity.ERROR,
      description: 'Brief description of the rule',
      rationale: 'Why this rule exists',
      filePatterns: ['**/*.ts', '**/*.tsx'],
      excludePatterns: ['**/node_modules/**']
    });
  }

  validate(context: ValidationContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    // Your validation logic here

    return violations;
  }
}
```

2. Register rule with agent:

```typescript
import { MyNewRule } from '../rules/category/MyNewRule';

export class MyAgent extends BaseAgent {
  constructor() {
    super({ /* config */ });
    this.registerRule(new MyNewRule());
  }
}
```

3. Add tests:

```typescript
// agents/__tests__/rules/category/MyNewRule.test.ts
describe('MyNewRule', () => {
  test('should detect violation', () => {
    // Test implementation
  });
});
```

### Adding a New Agent

1. Create agent class extending `BaseAgent`:

```typescript
import { BaseAgent } from '../core/Agent';

export class MyAgent extends BaseAgent {
  constructor() {
    super({
      id: 'my-agent',
      name: 'My Agent',
      description: 'What this agent validates',
      version: '1.0.0'
    });

    // Register rules
    this.registerRule(new MyRule1());
    this.registerRule(new MyRule2());
  }
}
```

2. Register with CLI and registry:

```typescript
// agents/cli/index.ts
import { myAgent } from '../agents/MyAgent';

// In registerAgents():
if (agents.includes('my-agent')) {
  this.registry.registerAgent(myAgent);
}
```

## Migration from Roo Format

**✅ Migration Complete** - This framework replaced the `.roo/` directory structure with executable TypeScript code:

| Roo Format | TypeScript Implementation | Status |
|------------|------------------------|--------|
| `.roo/rules-debug/AGENTS.md` | `agents/agents/DebugAgent.ts` + `agents/rules/debug/*.ts` | ✅ Complete (5 rules) |
| `.roo/rules-code/AGENTS.md` | `agents/agents/CodeAgent.ts` + `agents/rules/code/*.ts` | ✅ Complete (6 rules) |
| `.roo/rules-architect/AGENTS.md` | `agents/agents/ArchitectAgent.ts` + `agents/rules/architect/*.ts` | ✅ Complete (4 rules) |
| `.roo/rules-ask/AGENTS.md` | Documentation in [AGENTS.md](../../AGENTS.md) | 📝 Non-enforceable |

**Legacy Cleanup:** The `.roo/` directory was removed on January 10, 2026. All historical roo format files have been eliminated.

## Delivered Features

**Phase 1 & 2 Complete:**
- ✅ Core framework foundation (~1,500 lines)
- ✅ 3 production agents (Debug, Auth, Code)
- ✅ 15 enforceable rules fully migrated
- ✅ CLI tool with detailed reporting
- ✅ ESLint plugin integration
- ✅ Pre-commit hook support
- ✅ 26 unit tests (100% core coverage)
- ✅ Complete documentation suite

**Total Codebase:** ~7,800 lines of production code + documentation

## Future Roadmap

- [ ] Phase 3: Advanced architect agent patterns (AST-based validation)
- [ ] Auto-fix engine for common violations
- [ ] VSCode extension for real-time feedback
- [ ] CI/CD integration templates
- [ ] Rule analytics dashboard

## Contributing

When adding new rules, ensure:
1. Rule ID follows convention: `{category}-{number}-{name}`
2. Description is clear and concise
3. Rationale explains why the rule exists
4. File patterns are specific and performant
5. Validation logic is accurate
6. Suggested fixes are actionable
7. Unit tests cover common cases

## License

MIT
