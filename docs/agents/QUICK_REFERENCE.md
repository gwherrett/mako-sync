# Mako Agents - Quick Reference Card

## 🚀 Quick Start (30 seconds)

```bash
# Validate entire codebase
npm run agents:validate

# Expected output:
# ✓ VALIDATION PASSED
# Files: 200 | Duration: 150ms
# Warnings: 51 | Errors: 0
```

---

## 📋 Common Commands

```bash
# All agents
npm run agents:validate

# Specific agents
npm run agents:validate:debug        # Debug patterns only
npm run agents:validate:auth         # Auth patterns only
npm run agents:validate:code         # Code patterns only

# Different formats
npm run agents:validate              # Detailed (default)
npx ts-node agents/cli/index.ts --format summary
npx ts-node agents/cli/index.ts --format by-file

# JSON export
npm run agents:validate:json > results.json

# Run tests
npm run agents:test
```

---

## 🤖 What Each Agent Does

| Agent | Rules | Focuses On |
|-------|-------|------------|
| **Debug** | 5 | Pagination, timeouts, session handling |
| **Auth** | 4 | Context consolidation, imports, initialization |
| **Code** | 6 | Service layer, edge functions, singletons |

**Total: 15 automated rules**

---

## 📁 Important Files

```
docs/agents/
├── README.md              # Complete usage guide ⭐ Start here
├── ARCHITECTURE.md        # System design & patterns
├── FINAL_SUMMARY.md       # This project summary
├── PHASE3_HANDOFF.md      # Next phase plan
└── QUICK_REFERENCE.md     # This file

agents/
├── core/                  # Framework
├── agents/                # 3 agents (Debug, Auth, Code)
├── rules/                 # 15 rules
└── cli/                   # Validation tool
```

---

## 🔧 How to Fix Violations

### 1. Run validation
```bash
npm run agents:validate
```

### 2. Read the output
```
❌ ERROR
File: src/components/MyComponent.tsx:42
Rule: code-001-service-layer
Message: Components must not query Supabase directly

Code:
   40 | const MyComponent = () => {
   41 |   const data = await supabase
→  42 |     .from('tracks')
   43 |     .select('*');

💡 Suggested Fix:
Move query to src/services/ and call service method
```

### 3. Apply the fix
- Follow the suggested fix
- Use service layer instead of direct queries
- Check documentation if unclear

### 4. Re-validate
```bash
npm run agents:validate
```

---

## ⚙️ Configuration

### Disable a rule temporarily
```typescript
// agents/cli/index.ts
// Comment out rule registration
// this.registerRule(new SomeRule());
```

### Change severity
```typescript
// agents/rules/debug/SomeRule.ts
severity: RuleSeverity.WARNING  // Instead of ERROR
```

### Add exclusions
```typescript
// agents/rules/code/ServiceLayerRule.ts
excludePatterns: [
  '**/__tests__/**',
  '**/my-special-file.ts'  // Add this
]
```

---

## 🎯 Common Issues

### "Too many violations!"
**Solution:** Start with one agent at a time
```bash
npm run agents:validate:code  # Easiest to fix first
```

### "False positives in test files"
**Solution:** Already excluded! If you see them:
- Check file path matches `**/__tests__/**`
- Update exclude patterns in rule

### "Validation is slow"
**Solution:** Should be < 200ms for 200 files
- Check if scanning too many node_modules
- Review exclude patterns

### "I want to add a rule"
**Solution:** See [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Extend `BaseRule`
- Implement `validate()` method
- Register with agent

---

## 📊 Rule Reference

### Debug Agent (5)
- `debug-001` - Supabase pagination (`.limit()` required)
- `debug-002` - No custom fetch wrappers
- `debug-003` - Promise timeout protection
- `debug-004` - Edge function timeout (45s+)
- `debug-005` - Direct session calls in critical flows

### Auth Agent (4)
- `auth-001` - Only NewAuthContext (no legacy)
- `auth-002` - Correct import paths
- `auth-003` - Deferred loading pattern
- `auth-004` - useRef initialization guard

### Code Agent (6)
- `code-001` - Service layer mandatory
- `code-002` - Supabase import path
- `code-003` - Edge function isolation
- `code-004` - SUPER_GENRES sorting
- `code-006` - Spotify manager singleton
- `code-007` - Edge function deploy registration

---

## 🔗 Links

- **Full Docs:** [`docs/agents/README.md`](README.md)
- **Architecture:** [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **Phase 3 Plan:** [`PHASE3_HANDOFF.md`](PHASE3_HANDOFF.md)
- **Migration Report:** [`MIGRATION_COMPLETE.md`](MIGRATION_COMPLETE.md)

---

## 💡 Pro Tips

1. **Run before committing** - Catch issues early
2. **Start with code agent** - Easiest fixes
3. **Fix warnings gradually** - Not blocking
4. **Use --format summary** - Quick overview
5. **Export JSON for CI** - Machine readable

---

## 🆘 Get Help

1. **Check docs:** `docs/agents/README.md`
2. **See examples:** `agents/__tests__/`
3. **Review architecture:** `docs/agents/ARCHITECTURE.md`
4. **Create issue:** If stuck, file GitHub issue

---

## ✅ Success Checklist

Before merging code:
- [ ] Run `npm run agents:validate`
- [ ] Zero errors (warnings OK)
- [ ] Read violation messages
- [ ] Apply suggested fixes
- [ ] Re-validate to confirm

---

**Last Updated:** 2026-01-06
**Version:** 1.0
**Status:** Production Ready
