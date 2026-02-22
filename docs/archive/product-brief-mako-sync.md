# Concept Brief: Mako-Sync

## Project Overview
Mako-Sync is a web application that helps music collectors identify gaps between what they like on Spotify and their local music files. The core value is **gap analysis** - understanding what's missing from your local collection compared to what you've saved on Spotify.   

Why is this important? You pay for the right to stream music form Spotify - you don't own anything. Tracks regular disappear disappear as licenses expire or artists want to to change how they monetize their music (outside of Spotify)

To support meaningful gap analysis, Mako-Sync provides intelligent genre classification tools that normalize diverse Spotify genre tags into a user-defined "Common Genre" taxonomy, with AI-assisted classification for tracks lacking genre metadata.

  ## Target Users
**Primary Users**: Music collectors who use Spotify to discover new music and and have local files collection. Think DJs, audiophiles, and vinyl/digital collectors

**User Needs**:
- See which Spotify liked songs are missing from their local collection
- Organize tracks by meaningful genre categories rather than Spotify's granular and 
- Fill genre gaps for tracks where Spotify provides no genre data
- Export actionable lists for acquisition decisions (build a record crate)
  

## Core User Stories

  

### Epic 1: Library Connection & Sync

  
**As a user**
I want to connect my Spotify account and sync my liked songs
So that I can compare my streaming library to my local files

**Acceptance Criteria:**
- OAuth-based Spotify authentication with secure token storage (vault)
- Initial full sync imports all liked songs with metadata
- Incremental sync detects newly added tracks only
- Sync progress displayed in real-time with track counts
- Manually assigned genres persist through sync operations
- Resume capability for interrupted syncs

### Epic 2: Local File Scanning

  **As a user**
I want to upload/scan my local MP3 files
So that the system knows what I already own

**Acceptance Criteria:**
- Browser-based file selection for MP3s
- Extract metadata (title, artist, album, year)
- Generate file hashes for duplicate detection
- Display local files in sortable/filterable table
- Show file count and last scan timestamp

### Epic 3: Genre Mapping

  **As a user**
I want to map Spotify granular genres to my own categories
So I can compare by genre

 **Acceptance Criteria:**
- Display all Spotify genres from user's library
- Map each to a user-defined Common Genre
- Override default mappings per user
- Bulk override support for efficiency
- Export genre mappings to CSV
- Show count of unmapped tracks
- Visual indication of user-overridden mappings

### Epic 4: Missing Tracks Analysis

  **As a user**
I want to identify Spotify tracks not in my local collection
So that I know what to acquire

**Acceptance Criteria:**
- Compare Spotify library against local files
- Filter results by Common Genre
- Group missing tracks by artist
- Display track count per artist
- Show genre badges for context
- Export results to CSV for shopping lists
- Summary stats: total missing, unique artists, top artist
 
### Epic 5: AI-Assisted Genre Classification

**As a user**
I want help classifying tracks that have no Spotify genre
So that no track falls through the cracks

**Acceptance Criteria:**
- Display tracks where Spotify provided no genre
- AI suggests Common Genre based on artist/track context
- Accept, reject, or manually override AI suggestions
- Process individual tracks or batches of 10
- Typeahead search in genre dropdowns
- Track-level granularity (not artist-level bulk assignment)
- Export track assignments to CSV
- Progress indicator showing assigned vs. unassigned

  

## Page Structure & User Flow

```

Authentication (/auth)

├── Email/Password Sign In
├── Email/Password Sign Up
└── Redirect to Dashboard on success

Main Dashboard (/)

├── Header
│ ├── Brand Logo & Title: "Mako-Sync"
│ ├── User Info & Sign Out
│ └── Settings Link
│
├── Collapsible Dashboard Section
│ ├── Stats Overview (Left Column)
│ │ ├── Liked Songs Count + Last Sync
│ │ └── Local Files Count + Last Scan
│ │
│ └── Setup Checklist (Right Column)
│ ├── Step 1: Connect Spotify [Connect/Disconnect]
│ ├── Step 2: Sync Liked Songs [Sync/Full Sync]
│ └── Step 3: Map Genres [Manage Genres →]
│
└── Main Tabs
├── Spotify Tab
│ ├── Sync Button + Progress
│ ├── Tracks Table (sortable, filterable)
│ └── Track Detail Panel (on select)
│
├── Local Tab
│ ├── File Upload Scanner
│ ├── Local Tracks Table (sortable, filterable)
│ └── Track Detail Panel (on select)
│
└── Matching Tab
└── Missing Tracks Analyzer
├── Genre Filter Dropdown
├── Analyze Button
├── Summary Stats Cards
└── Results: Missing Tracks by Artist
 

Genre Mapping (/genre-mapping)

├── Back Navigation
├── Alert: X Tracks Without Spotify Genre [Process with AI →]
└── Genre Mapping Table
├── Spotify Genre | Common Genre | Status
├── Inline Override Controls
└── Export CSV Button

Track-Level Genre Processor (/no-genre-tracks)

├── Back Navigation
├── Progress Bar (X/Y tracks assigned)
├── Export CSV Button
├── Process Next 10 Button
└── Track Table
├── Artist | Album | Track | Year | Common Genre | Actions
├── AI Suggestion Inline
├── Accept/Reject/Manual Controls
└── Typeahead Genre Selector

```

## Detailed UI Requirements

  
### Setup Checklist Card

```
┌─────────────────────────────────────────────────────────────────┐
│ ① Connect Spotify [Complete ✓] [Disconnect] │
│ Link your Spotify account to access liked songs │
├─────────────────────────────────────────────────────────────────┤
│ ② Sync Liked Songs [Complete ✓] [Sync] [Full Sync] │
│ Import your Spotify liked songs with metadata │
│ 4,523 songs synced │
├─────────────────────────────────────────────────────────────────┤
│ ③ Map Genres [⚠ 127 Unmapped] [Manage Genres →] │
│ Map Spotify genres to your Common Genres │
└─────────────────────────────────────────────────────────────────┘

```

### Missing Tracks Results

  ```

┌─────────────────────────────────────────────────────────────────┐
│ Missing: 847 Artists: 234 Top: Artist Name (42) │
└─────────────────────────────────────────────────────────────────┘
  

┌─────────────────────────────────────────────────────────────────┐
│ Artist Name [23 tracks] │
│ [House] [Electronic] │
│ • Track Title 1 • Album Name │
│ • Track Title 2 • Album Name │
│ • Track Title 3 • Album Name │
└─────────────────────────────────────────────────────────────────┘
```

### Track-Level Genre Processor 

```
┌───────────────────────────────────────────────────────────────────┐
│ Track Genre Assignment │
│ Assign Common Genres to tracks without Spotify genre data │
│ │
│ Progress: ████████░░░░ 67% (201/300) [Export CSV] [Process 10]│
└───────────────────────────────────────────────────────────────────┘

  
┌────────────────────────────────────────────────────────────────────────┐
│ Artist ▲ │ Album │ Track │ Year │ Common Genre │
├────────────────────────────────────────────────────────────────────────┤
│ Artist A │ Album X │ Song Title 1 │ 2019 │ [House ▼] │
│ Artist A │ Album X │ Song Title 2 │ 2019 │ [✓AI: House] [✗] │
│ Artist B │ Album Y │ Song Title 3 │ 2021 │ [▸ Get AI Suggestion]│
└────────────────────────────────────────────────────────────────────────┘

```

## Expected Behavior & Interactions

### Spotify Sync Flow

1. **Connect**: OAuth popup → Spotify authorization → callback stores tokens in vault
2. **Initial Sync**: Fetches all liked songs (paginated), extracts artist genres, maps to Common Genres
3. **Incremental Sync**: Detects newest `added_at`, fetches only newer tracks
4. **Full Sync**: Caches manual genre assignments → clears table → re-imports all → restores manual assignments
5. **Progress**: Real-time updates via Supabase subscription to `sync_progress` table

### Genre Mapping Flow

1. **Load**: Fetch base mappings + user overrides + genres from liked songs
2. **Override**: User selects new Common Genre → saves to `spotify_genre_map_overrides`
3. **Remove Override**: Reverts to base mapping
4. **Export**: Downloads CSV of all current mappings

### AI Genre Classification Flow

1. **Trigger**: User clicks sparkle icon on unassigned track
2. **Context**: System gathers artist existing genres, library patterns
3. **Suggest**: AI returns recommended Common Genre with confidence
4. **Accept/Reject**: User accepts (writes to DB), rejects (clears suggestion), or selects manually
5. **Batch**: "Process Next 10" triggers AI for 10 unassigned tracks sequentially

## Data Model

### Key Tables

| Table | Purpose |
|-------|---------|
| `spotify_liked` | User's Spotify liked songs with metadata |
| `local_mp3s` | User's scanned local files with metadata |
| `spotify_genre_map_base` | System-wide default genre mappings |
| `spotify_genre_map_overrides` | User-specific genre mapping overrides |
| `spotify_connections` | OAuth tokens (encrypted in vault) |
| `sync_progress` | Tracks sync state for resume capability |

### Key Fields: `spotify_liked`

```typescript
{
id: string;
user_id: string;
spotify_id: string;
title: string;
artist: string;
album: string | null;
year: number | null;
genre: string | null; // From Spotify (can be NULL)
super_genre: string | null; // User's Common Genre classification
added_at: string;
bpm: number | null;
key: string | null;
danceability: number | null;
}
```

## API Integration Points

### Supabase Edge Functions

| Function | Purpose |
|----------|---------|
| `spotify-auth` | Initiate OAuth flow |
| `spotify-callback` | Handle OAuth callback, store tokens |
| `spotify-sync-liked` | Full/incremental sync with progress tracking |
| `spotify-resync-tracks` | Re-apply genre mappings after changes |
| `genre-mapping` | Fetch/export genre mappings |
| `ai-track-genre-suggest` | AI-powered genre recommendations |

### External APIs

- **Spotify Web API**: User profile, liked songs, artist metadata
- **Lovable AI**: Genre classification suggestions


## Technical Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS, shadcn/ui components |
| State | TanStack Query, React Context |
| Backend | Supabase (Auth, Database, Edge Functions, Vault) |
| AI | Lovable AI integration |


## Success Criteria


### Functional Requirements

- ✅ Complete Spotify OAuth flow with secure token storage
- ✅ Full and incremental sync with progress tracking
- ✅ Manual genre assignments persist through all sync operations
- ✅ Missing tracks analysis with genre filtering
- ✅ Export capabilities for gap analysis results
- ✅ AI-assisted genre classification for untagged tracks
- ✅ User-customizable Common Genre taxonomy
  

### User Experience Requirements

- ✅ Clear onboarding checklist guides new users
- ✅ Real-time sync progress feedback
- ✅ Collapsible dashboard for focused workflows
- ✅ Typeahead search in genre selection
- ✅ One-click AI suggestions with accept/reject
- ✅ Batch processing for efficiency
- ✅ CSV exports for offline analysis

### Data Integrity Requirements

- ✅ Manual genre assignments never lost during sync
- ✅ Sync resume capability preserves progress
- ✅ Pagination handles libraries >1000 tracks
- ✅ Duplicate detection via file hashing (local files)
  
--- 