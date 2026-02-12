# Mako Agents Framework

Code validation framework for enforcing project-specific patterns.

## Quick Start

```bash
# Run validation
npm run agents:validate

# Run tests
cd agents && npm test
```

## Documentation

Full documentation available in [`docs/agents/`](../docs/agents/):

- **[README.md](../docs/agents/README.md)** - Complete usage guide, installation, CLI options
- **[ARCHITECTURE.md](../docs/agents/ARCHITECTURE.md)** - System architecture, data flow, extension points
- **[QUICK_REFERENCE.md](../docs/agents/QUICK_REFERENCE.md)** - All rules at a glance

## Structure

```
agents/
├── core/          # Framework core (Agent, Rule, Registry)
├── agents/        # Agent implementations (Debug, Auth)
├── rules/         # Rule implementations
├── cli/           # CLI tool
├── eslint-plugin/ # ESLint integration
└── __tests__/     # Unit tests
```

## Implemented Agents

- **Debug Agent** - 5 rules for debugging patterns (pagination, timeouts, etc.)
- **Auth Agent** - 4 rules for authentication context patterns

See [docs/agents/README.md](../docs/agents/README.md) for complete details.
