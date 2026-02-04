# Mako Sync

Mako Sync is a metadata editor and syncing tool that helps music collectors bridge the gap between their Spotify library and local music collection. It automates the workflow of identifying missing tracks, downloading them via Slskd, and organizing files by Supergenre for DJ software.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-61dafb)](https://reactjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Latest-3ECF8E)](https://supabase.com/)

## Who It's For

DJs and music collectors who want to:
- Identify gaps in their local music library compared to Spotify
- Organize tracks by Supergenre (24 DJ-friendly categories)
- Automate the Spotify → Slskd → Local file workflow
- Maintain consistent genre tagging across their collection

## The 5-Step Workflow

1. **Spotify Sync** - Import your Liked songs from Spotify. Tracks are auto-mapped to Supergenres based on artist metadata.
2. **Local Files** - Select folders to scan your local collection. Metadata is extracted and mapped to Supergenres for matching.
3. **No Genre Tracks** - Assign Supergenres to tracks without Spotify genre data using AI suggestions or manual selection.
4. **Missing Tracks** - Compare your Spotify library to local files. Select artists and push missing tracks to Slskd for wishlist searches.
5. **Process Downloads** - Map ID3 genres to Supergenres and write tags for MediaMonkey collection management.

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Supabase account and project
- Spotify Developer account

### Installation

```bash
# Clone the repository
git clone https://github.com/gwherrett/mako-sync.git
cd mako-sync

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your Supabase and Spotify credentials

# Start development server
npm run dev
```

## Documentation

See the [docs/](docs/) folder for detailed documentation:

- [Mako Sync Overview](docs/mako-sync-overview.md) - Complete workflow guide with diagrams
- [Architecture](docs/architecture-mako-sync.md) - System design and technical architecture
- [Product Requirements](docs/prd-mako-sync.md) - Product vision and features
- [Setup Guide](docs/setup-guide.md) - Configuration and deployment

## Development

### Available Commands

```bash
# Development
npm run dev              # Start dev server on port 8080
npm run build            # Production build
npm run preview          # Preview production build

# Code Quality
npm run lint             # Run ESLint
npm run agents:validate  # Validate code patterns
npx vitest run           # Run tests

# Agents Framework
npm run agents:validate  # Validate all agents
npm run agents:test      # Run agent tests
npm run agents:fix       # Auto-fix violations
```

### Code Validation

This project uses the **Mako Agents Framework** - a TypeScript-based validation system enforcing coding patterns:

- Debug rules (pagination, timeouts, session handling)
- Auth rules (context consolidation, import patterns)
- Code rules (service layer, edge functions, singletons)

Run `npm run agents:validate` before committing.

## Tech Stack

### Frontend
- **React 18** with TypeScript
- **Vite** - Build tool and dev server
- **Tailwind CSS** + **shadcn/ui** - Styling and components
- **TanStack Query** - Data fetching and caching

### Backend
- **Supabase** - Database, auth, and edge functions
- **PostgreSQL** - Primary database with RLS
- **Supabase Vault** - Secure token storage

### Integrations
- **Spotify Web API** - Music data and OAuth
- **Slskd** - P2P download automation
- **MediaMonkey** - File organization via custom tags

## Security

- OAuth 2.0 for Spotify authentication
- Tokens stored in Supabase Vault (encrypted at rest)
- Row Level Security (RLS) on all tables
- Service role keys only in edge functions

## License

MIT
