# Mako Sync Documentation

**Last Updated**: February 2026

---

## Quick Navigation

### Product & Architecture
- [Product Requirements (PRD)](prd-mako-sync.md) - Full product vision, epics, and acceptance criteria
- [Product Overview](mako-sync-overview.md) - Visual 5-step workflow with diagrams
- [Architecture](architecture-mako-sync.md) - System architecture and technical design
- [Design Brief](design-brief-mako-sync.md) - Design system, colors, and brand identity

### Reference Guides
- [Authentication Reference](reference/authentication-reference.md) - Auth implementation, debugging, and testing
- [Spotify Reference](reference/spotify-reference.md) - Spotify integration, OAuth, and troubleshooting
- [Production Deployment](reference/production-deployment.md) - Environment setup, configuration, and deployment

### Feature Plans
- [slskd Integration](plans/slskd-complete-implementation.md) - Complete slskd implementation guide
- [FLAC/M4A Tag Writing](plans/flac-m4a-tag-writing-plan.md) - Tag writing for non-MP3 formats
- [UI Changes](plans/plan-ui-changes.md) - Planned UI improvements
- [Test Improvement](plans/test-improvement-plan.md) - Test coverage improvement plan

### Agents Framework
- [Agents README](agents/README.md) - Usage guide, CLI options, installation
- [Agents Architecture](agents/ARCHITECTURE.md) - Framework design and data flow
- [Agents Quick Reference](agents/QUICK_REFERENCE.md) - All 15 rules at a glance

### Archive
- [Archive](archive/) - Historical docs preserved for context (not actively maintained)

---

## Documentation Structure

```
docs/
├── README.md                          # This navigation file
├── prd-mako-sync.md                   # Product requirements
├── mako-sync-overview.md              # Visual workflow overview
├── architecture-mako-sync.md          # Technical architecture
├── design-brief-mako-sync.md          # Design system
│
├── reference/                         # Implementation & operations
│   ├── authentication-reference.md    # Auth: impl + debugging + testing
│   ├── spotify-reference.md           # Spotify: impl + config + troubleshooting
│   └── production-deployment.md       # Deployment: env vars + config + checklist
│
├── plans/                             # Active feature plans
│   ├── slskd-complete-implementation.md
│   ├── flac-m4a-tag-writing-plan.md
│   ├── plan-ui-changes.md
│   └── test-improvement-plan.md
│
├── agents/                            # Validation framework docs
│   ├── README.md
│   ├── ARCHITECTURE.md
│   └── QUICK_REFERENCE.md
│
└── archive/                           # Historical (read-only)
    ├── README.md
    ├── product-brief-mako-sync.md
    ├── current-status-assessment.md
    ├── debugging-task-strategy.md
    ├── authentication-system-status.md
    └── spotify-integration-status.md
```

---

## Location Rules

| Location | What goes here | When to update |
|----------|---------------|----------------|
| Root (`README.md`, `CLAUDE.md`, `AGENTS.md`) | Short, high-signal entry points | Rarely - major changes only |
| `docs/` (root level) | Product vision & architecture | Major product changes |
| `docs/reference/` | Implementation guides, debugging, deployment | When procedures change |
| `docs/plans/` | Active feature implementation plans | While feature is in progress |
| `docs/agents/` | Validation framework documentation | When agent rules change |
| `docs/archive/` | Historical docs for context | Never (read-only) |
| `agents/README.md` | Framework quick start | Point to docs/agents/ for details |

---

## Documentation Template

Every doc in `docs/` (except archive/) should follow this format:

```markdown
# [Title]

> **[Category]**: One-line description.

**Status**: Active | Draft | Archived
**Last Updated**: [Date]

---

## Overview
[2-3 sentences: what this covers, who should read it]

## [Content Sections]

## Troubleshooting (if applicable)

---

**See also**: [Related doc links]
```

**File naming**: lowercase with dashes (e.g., `setup-guide.md`)

---

## Maintenance

- Update `Last Updated` when making meaningful changes
- Commit with: `docs: update [topic] for [reason]`
- One authoritative source per topic - no duplication
- When a feature plan is complete, move it to `archive/` or fold key info into the reference guide
