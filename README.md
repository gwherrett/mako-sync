# Mako Sync

Mako Sync is a local music collection hub for DJs and music collectors. Your local files are the source of truth — Spotify and Discogs connect as enrichment layers, giving you genre metadata, library comparisons, and vinyl collection management without forcing a rigid workflow.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-61dafb)](https://reactjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Latest-3ECF8E)](https://supabase.com/)

## What It Does

**Local Files** are the core. Scan your MP3, FLAC, and M4A collection — metadata is extracted, Supergenres are assigned, and everything is available for comparison and tagging.

**Spotify** connects as an enrichment source. Sync your Liked songs to pull in genre data, compare your Spotify library against local files to find gaps, and use AI suggestions to fill in missing genres.

**Discogs** connects as a vinyl collection layer. Sync your Discogs collection, browse records with pricing and tracklist data, and find which tracks from your vinyl are missing from your local digital files.

These three integrations work independently — connect whichever ones are relevant to you.

## Core Features

### Local Files
- Scan folders for MP3, FLAC, and M4A files
- Extract and display metadata (title, artist, album, genre)
- Map ID3 genres to Supergenres (24 DJ-friendly categories)
- Write Supergenre tags back to files for MediaMonkey

### Spotify Integration
- OAuth sync of Liked songs
- Auto-map artists to Supergenres via Spotify genre data
- AI-assisted genre suggestions for unclassified tracks
- Compare Spotify library vs local files — push missing tracks to Slskd wishlist

### Discogs Integration
- OAuth sync of your Discogs vinyl collection
- Browse collection with cover art, pricing, and tracklist data
- Find vinyl tracks missing from your local digital library
- Incremental sync keeps your collection up to date

### Genre Management
- Supergenre mapping across Spotify and Discogs genre terms
- Manual overrides for edge cases
- Bulk genre assignment tools

## Quick Start

### Prerequisites

- Node.js 24 and npm (set in `engines` in `package.json`; CI and Vercel build on 24)
- Supabase account and project
- Spotify Developer account (optional)
- Discogs account (optional)

### Installation

```bash
git clone https://github.com/gwherrett/mako-sync.git
cd mako-sync
npm install
cp .env.example .env
# Edit .env with your Supabase credentials and any integration keys
npm run dev
```

## Documentation

See the [docs/](docs/) folder for detailed documentation:

- [Mako Sync Overview](docs/mako-sync-overview.md) - Product overview and architecture
- [Architecture](docs/architecture-mako-sync.md) - System design and technical details
- [Deployment Guide](docs/reference/production-deployment.md) - Configuration and deployment

## Development

```bash
# Development
npm run dev              # Start dev server on port 8080
npm run build            # Production build

# Testing & Quality
npm run lint             # Run ESLint
npx vitest run           # Run tests
npx vitest run --coverage  # Run with coverage

# Code Validation
npm run agents:validate  # Validate code patterns
npm run agents:fix       # Auto-fix violations
```

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
- **Spotify Web API** - Music metadata and OAuth
- **Discogs API** - Vinyl collection sync and release data
- **Slskd** - P2P download automation
- **MediaMonkey** - File organization via custom tags

## Security

- OAuth 2.0 for Spotify and Discogs authentication
- Tokens stored in Supabase Vault (encrypted at rest)
- Row Level Security (RLS) on all tables
- Service role keys only in edge functions

## License

MIT
