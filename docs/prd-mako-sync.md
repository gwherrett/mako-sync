# **Product Requirements Document: mako-sync**

**Document Version:** 1.0  
**Last Updated:** December 4, 2025
**Product Owner:** [To be assigned]  
**Engineering Lead:** [To be assigned]

---

## **1. Executive Summary**

### **1.1 Product Vision**

mako-sync is a web-based tool that bridges the gap between Spotify libraries and local music collections. It enables DJs and music collectors to identify missing tracks, classify their music into super genres, and maintain organized, synchronized music libraries across digital and physical formats.

### **1.2 Business Objectives**

* Help users identify gaps between their Spotify liked songs and local music files
* Provide intelligent super genre classification for music organization
* Enable DJs to quickly identify tracks they need to acquire for their local collection
* Deliver a free, accessible tool for the music community

### **1.3 Success Metrics**

| Metric | Target | Measurement Method |
| :---- | :---- | :---- |
| Genre Classification Accuracy | >90% of tracks correctly mapped to super genres | User feedback and override rate |
| Missing Tracks Identified | 100% of gaps accurately detected | Comparison validation testing |
| User Engagement | Users complete full library sync | Sync completion tracking |
| Return Usage | 70% return within 30 days to re-sync | User session tracking |

---

## **2. Product Scope**

### **2.1 In Scope**

* Web-based single-page application (SPA)
* Spotify OAuth integration for liked songs sync
* Local MP3 file metadata scanning via browser
* Super genre classification system with AI assistance
* Missing tracks analyzer (gap analysis)
* User-specific genre mapping overrides
* Responsive design (mobile, tablet, desktop)
* Email/password authentication

### **2.2 Out of Scope**

* Other streaming services (Apple Music, Tidal, Amazon Music)
* Playlist sync (only liked songs)
* Auto-download or acquisition of missing tracks
* Native mobile applications (iOS/Android)
* Multi-user collaboration features
* Offline mode or PWA capabilities
* Payment processing or premium features
* File transfer or cloud storage

### **2.3 Future Considerations**

* Playlist synchronization support
* Additional streaming service integrations
* Mobile app (PWA or native)
* Export to DJ software formats (Rekordbox, Serato)
* Batch metadata editing
* Track recommendations based on library gaps

### **2.4 Data Ownership & Rights**

**User Data Ownership:**
* Users own all manually entered data including:
  - Genre assignments and overrides
  - Local file metadata and organization
  - Custom genre mapping preferences
  - Sync preferences and settings

**Data Portability:**
* Complete data export functionality via CSV/JSON formats
* Export includes all user-assigned genres, mappings, and preferences
* No vendor lock-in - users can migrate data to other systems

**Data Retention:**
* User data retained for 2 years from last activity (as specified in NFR-18)
* Users may delete their data at any time via account settings
* Account deletion removes all user data within 30 days
* Spotify tokens automatically expire and are refreshed; stale connections (>90 days) flagged for cleanup

---

## **3. User Personas & Use Cases**

### **3.1 Primary Persona: Professional/Hobbyist DJ**

**Profile:**

* Role: DJ who performs at venues, events, or streams
* Goal: Maintain a comprehensive local music collection that matches their streaming favorites
* Pain Points: 
  - Tracks liked on Spotify during discovery sessions aren't in local collection
  - Inconsistent genre tagging across different music sources
  - Time-consuming manual comparison of libraries
* Technical Proficiency: Medium to High

**Primary Use Cases:**

1. Sync Spotify liked songs to identify new tracks to acquire
2. Classify music library by DJ-friendly super genres (House, Drum & Bass, etc.)
3. Identify which tracks are missing from local collection
4. Maintain consistent genre organization for DJ software integration

### **3.2 Secondary Persona: Music Collector/Enthusiast**

**Profile:**

* Role: Music enthusiast who maintains both streaming and local libraries
* Goal: Keep organized music collection with proper categorization
* Pain Points:
  - Disorganized local music files with inconsistent metadata
  - No easy way to see what's in Spotify but not downloaded
  - Manual genre tagging is tedious
* Technical Proficiency: Low to Medium

**Primary Use Cases:**

1. Upload local music library for organization
2. Connect Spotify to discover what's missing locally
3. Use AI-assisted genre classification for better organization
4. Track collection growth over time

---

## **4. Functional Requirements**

### **4.1 Epic 1: User Authentication**

**User Story:**  
As a user, I want to create an account so that my data is saved and private.

**Acceptance Criteria:**

* **FR-1.1:** System SHALL provide email/password registration with:
  - Email validation (format check)
  - Password minimum 8 characters
  - Email confirmation (optional, configurable)
* **FR-1.2:** System SHALL provide login with email/password
* **FR-1.3:** System SHALL provide password reset via email
* **FR-1.4:** System SHALL redirect authenticated users to main dashboard
* **FR-1.5:** System SHALL protect all user data with Row Level Security

**Priority:** P0 (Critical)  
**Dependencies:** Supabase Auth configured  
**Estimated Effort:** 5 story points

---

### **4.2 Epic 2: Spotify Connection & Sync**

**User Story:**  
As a DJ, I want to connect my Spotify account so that I can sync my liked songs.

**Acceptance Criteria:**

* **FR-2.1:** System SHALL provide "Connect Spotify" button initiating OAuth flow
* **FR-2.2:** OAuth popup SHALL request user-library-read scope
* **FR-2.3:** System SHALL securely store Spotify tokens in Supabase Vault
* **FR-2.4:** System SHALL display connected Spotify account info (display name, email)
* **FR-2.5:** System SHALL provide "Sync Liked Songs" button
* **FR-2.6:** Sync SHALL fetch all liked songs from Spotify API
* **FR-2.7:** System SHALL support incremental sync:
  - Only fetch tracks added after last sync `added_at` timestamp
  - Preserve manually assigned `super_genre` values during sync
  - **Note:** Incremental sync does NOT detect deleted tracks (use full sync for cleanup)
* **FR-2.8:** System SHALL support full re-sync option:
  - Clears and re-fetches all tracks
  - Detects and removes tracks unliked from Spotify
  - Recommended periodically (e.g., monthly) to clean up deleted tracks
* **FR-2.9:** System SHALL display sync progress with:
  - Tracks fetched count
  - Tracks processed count
  - New tracks added count
  - Tracks removed count (full sync only)
  - Error messages if any
* **FR-2.10:** System SHALL automatically refresh expired Spotify tokens (5 min before expiry)
* **FR-2.11:** System SHALL allow disconnection of Spotify account

**Priority:** P0 (Critical)  
**Dependencies:** Spotify Developer App credentials  
**Estimated Effort:** 13 story points

---

### **4.3 Epic 3: Local Music Library Scanning**

**User Story:**  
As a music collector, I want to scan my local music files so that I can compare them with Spotify.

**Acceptance Criteria:**

* **FR-3.1:** System SHALL provide file upload interface for MP3 files
* **FR-3.2:** System SHALL extract metadata from uploaded files:
  - Title
  - Artist
  - Album
  - Genre
  - BPM
  - Key
  - Year
  - File path
  - Bitrate
  - File size
* **FR-3.3:** System SHALL parse artist field to extract:
  - Primary artist
  - Featured artists
  - Normalized artist name
* **FR-3.4:** System SHALL parse title field to extract:
  - Core title (without mix info)
  - Mix/remix information
  - Normalized title
* **FR-3.5:** System SHALL detect duplicate files via hash comparison
* **FR-3.6:** System SHALL display scan progress with file count
* **FR-3.7:** System SHALL store scanned tracks in user's local_mp3s table
* **FR-3.8:** System SHALL provide table view of all local tracks with:
  - Sorting by any column
  - Filtering by genre, artist, album
  - Search functionality

**Priority:** P0 (Critical)  
**Dependencies:** music-metadata-browser library  
**Estimated Effort:** 13 story points

---

### **4.4 Epic 4: Super Genre Classification**

**User Story:**  
As a DJ, I want my tracks automatically classified into super genres so I can organize my library for sets.

**Acceptance Criteria:**

* **FR-4.1:** System SHALL map Spotify genre tags to super genres using base mapping table
* **FR-4.2:** Super genres SHALL include:
  - Bass, Blues, Books & Spoken, Country, Dance, Disco
  - Drum & Bass, Electronic, Folk, Hip Hop, House
  - Indie-Alternative, Jazz, Latin, Metal, Orchestral
  - Unclassified, Pop, Reggae-Dancehall, Rock
  - Seasonal, Soul-Funk, UK Garage, Urban, World
* **FR-4.3:** System SHALL allow users to override genre mappings per-user
* **FR-4.4:** User overrides SHALL persist and apply to future syncs
* **FR-4.5:** System SHALL display genre mapping table with:
  - Spotify genre
  - Current super genre assignment
  - Override indicator if user-customized
* **FR-4.6:** System SHALL provide filter/search in genre mapping table
* **FR-4.7:** System SHALL apply genre rules:
  - R&B ≤1990 → Soul-Funk
  - R&B >1990 → Urban
  - 80s synth pop → Pop (not Electronic)
  - Boom bap hip hop → Hip Hop (not Urban)
  - House is priority genre when in doubt

### **4.4.1 Genre Mapping Precedence Rules**

The system applies genre classifications in the following priority order (highest to lowest):

1. **User-Specific Override Mappings** (Highest Priority)
   - Custom mappings in `spotify_genre_map_overrides` table
   - User-defined rules: "jazz fusion" → "Jazz" instead of default "Electronic"
   - Applies to all tracks with matching Spotify genre

2. **Manual User Assignment**
   - Direct assignment of `super_genre` on individual tracks
   - Persists through all sync operations including full re-sync
   - Cannot be overridden by automated processes

3. **Base System Mappings**
   - Default mappings in `spotify_genre_map_base` table
   - Covers 1000+ Spotify genres mapped to 27 super genres
   - Includes special rules (R&B ≤1990 → Soul-Funk, R&B >1990 → Urban)

4. **AI Suggestions** (Lowest Priority)
   - Applied only when no Spotify genre available AND no manual assignment
   - Considers artist's existing genres in user's library
   - Requires user acceptance - never applied automatically

**Conflict Resolution:**
- If multiple rules could apply, higher priority always wins
- Manual assignments are immutable and survive all automated processes
- System logs all genre assignment sources for transparency

**Priority:** P0 (Critical)  
**Dependencies:** spotify_genre_map_base table populated  
**Estimated Effort:** 13 story points

---

### **4.5 Epic 5: AI-Assisted Genre Suggestions**

**User Story:**  
As a user, I want AI to help classify tracks that don't have genre tags so I can complete my organization.

**Acceptance Criteria:**

* **FR-5.1:** System SHALL identify tracks with NULL Spotify genre AND NULL super_genre
* **FR-5.2:** System SHALL provide **track-level** AI genre suggestion interface:
  - Process individual tracks (NOT artist-level bulk processing)
  - Display flat sortable table showing Artist, Album, Track, Super Genre
  - AI trigger button per track for individual suggestions
* **FR-5.3:** For each unclassified track, AI SHALL suggest super genre based on:
  - Track title and artist
  - Existing super_genre assignments for other tracks by the same artist in user's `spotify_liked` table
  - Year and other metadata
* **FR-5.4:** AI SHALL query: `SELECT DISTINCT super_genre FROM spotify_liked WHERE primary_artist = ? AND super_genre IS NOT NULL` to find artist's existing genre mappings
* **FR-5.5:** User SHALL be able to:
  - Accept AI suggestion (inline)
  - Reject and manually select different super genre
  - Skip track
* **FR-5.6:** System SHALL provide "Process Next 10" batch button prioritizing unassigned tracks
* **FR-5.7:** Manual assignments SHALL persist through all sync operations (including interrupted/resumed):
  - Individual track `super_genre` assignments in `spotify_liked` table
  - User genre mapping overrides in `spotify_genre_map_overrides` table
* **FR-5.8:** System SHALL display count of unprocessed tracks
* **FR-5.9:** AI suggestions SHALL NOT use library genre counts as signals
* **FR-5.10:** AI suggestions SHALL emphasize genre consistency when user has other tracks by same artist

**Priority:** P1 (High)
**Dependencies:** Anthropic Claude integration, tracks synced  
**Estimated Effort:** 13 story points

---

### **4.6 Epic 6: Missing Tracks Analysis**

**User Story:**  
As a DJ, I want to see which Spotify tracks are missing from my local collection so I know what to acquire.

**Acceptance Criteria:**

* **FR-6.1:** System SHALL compare Spotify liked tracks against local_mp3s
* **FR-6.2:** Comparison SHALL use normalized title and artist for matching
* **FR-6.3:** System SHALL display missing tracks in table format with:
  - Track title
  - Artist
  - Album
  - Super genre
  - Spotify link (opens in new tab)
* **FR-6.4:** System SHALL provide super genre filter for missing tracks
* **FR-6.5:** System SHALL allow sorting by any column
* **FR-6.6:** System SHALL display total count of missing tracks
* **FR-6.7:** System SHALL provide search within missing tracks
* **FR-6.8:** Track matching SHALL use exact normalized string comparison:
  - Normalize: lowercase, remove special characters, collapse whitespace
  - Match key: `normalized_title + "_" + normalized_primary_artist`
  - Binary match (exact or no match)

**Priority:** P0 (Critical)
**Dependencies:** Both Spotify sync and local scan completed  
**Estimated Effort:** 8 story points

---

### **4.7 Epic 7: Dashboard & Statistics**

**User Story:**  
As a user, I want to see an overview of my library status so I can track my progress.

**Acceptance Criteria:**

* **FR-7.1:** Dashboard SHALL display:
  - Total Spotify liked songs count
  - Total local tracks count
  - Missing tracks count
  - Tracks without genre count
* **FR-7.2:** Dashboard SHALL display super genre distribution chart
* **FR-7.3:** Dashboard SHALL show last sync timestamp
* **FR-7.4:** Dashboard SHALL provide quick actions:
  - Sync Spotify
  - Scan local files
  - View missing tracks
  - Process ungenred tracks

**Priority:** P1 (High)  
**Dependencies:** Data from all epics  
**Estimated Effort:** 5 story points

---

### **4.8 Epic 8: Data Quality Management**

**User Story:**
As a user, I want duplicate tracks automatically detected and managed so that I can maintain a clean, organized library.

**Acceptance Criteria:**

* **FR-8.1:** System SHALL populate normalization fields during sync operations:
  - `normalized_title` and `normalized_artist` fields must be computed for all tracks
  - Normalization: lowercase, remove special characters, collapse whitespace
  - Apply to both Spotify sync and local file scanning
* **FR-8.2:** System SHALL detect duplicate tracks using normalized matching:
  - Match key: `normalized_title + "_" + normalized_primary_artist`
  - Run duplicate detection automatically after sync completion
  - Flag duplicates for user review (do not auto-delete)
* **FR-8.3:** System SHALL provide duplicate management interface:
  - Display duplicate groups with track details (album, year, Spotify ID)
  - Allow user to select preferred version to keep
  - Merge manual genre assignments from deleted duplicates
  - Preserve sync history and user preferences
* **FR-8.4:** System SHALL handle duplicate resolution during sync:
  - If duplicate detected during sync, preserve existing track with manual assignments
  - Update metadata from Spotify but retain user-assigned `super_genre`
  - Log duplicate resolution actions for user review

**Priority:** P1 (High)
**Dependencies:** Normalization service implementation
**Estimated Effort:** 8 story points

---

### **4.9 Epic 9: Error Handling & Recovery**

**User Story:**
As a user, I want clear feedback when operations fail so that I can understand what happened and how to proceed.

**Acceptance Criteria:**

* **FR-9.1:** System SHALL provide user-friendly error messages:
  - Replace technical error codes with plain language explanations
  - Include specific next steps for resolution
  - Differentiate between temporary (retry) and permanent (action required) errors
* **FR-9.2:** System SHALL handle Spotify API failures gracefully:
  - Rate limit errors: Show wait time and auto-retry option
  - Token expiry: Automatic refresh with user notification
  - Network errors: Retry with exponential backoff, show progress
  - Invalid track errors: Skip and continue, report at end
* **FR-9.3:** System SHALL provide operation recovery options:
  - "Retry" button for failed operations
  - "Resume" option for interrupted syncs using `sync_progress` table
  - "Skip and continue" for non-critical failures
* **FR-9.4:** System SHALL preserve user data during errors:
  - Manual genre assignments never lost due to sync failures
  - Partial sync progress saved and resumable
  - Local file scan progress preserved across browser sessions
* **FR-9.5:** System SHALL provide error state UI:
  - Toast notifications for immediate feedback
  - Error banners for persistent issues requiring attention
  - Loading states with timeout and error fallbacks
  - Empty states with clear next actions

**Priority:** P0 (Critical)
**Dependencies:** Error handling service, UI components
**Estimated Effort:** 13 story points

---

### **4.10 Epic 10: slskd Integration for Missing Track Acquisition**

**User Story:**
As a DJ, I want to automatically push missing tracks to my slskd wishlist so that they can be automatically downloaded via Soulseek.

**Acceptance Criteria:**

* **FR-10.1:** System SHALL provide slskd configuration interface allowing users to:
  - Enter slskd API endpoint URL (e.g., `http://localhost:5030`)
  - Enter slskd API key for authentication
  - Test connection to validate credentials
  - Save connection settings per user
  - Display connection status (connected/disconnected/error)
* **FR-10.2:** System SHALL store slskd configuration securely:
  - API endpoint and API key stored in user_preferences table
  - Row Level Security (RLS) enforced for user isolation
  - No encryption required (user responsibility to secure slskd instance)
* **FR-10.3:** Missing Tracks Analyzer SHALL display artist-level selection interface:
  - Grouped missing tracks by artist (existing functionality)
  - Checkbox per artist for multi-select
  - Display track count per artist (e.g., "15 tracks")
  - Show genres associated with artist
* **FR-10.4:** System SHALL provide "Push to slskd Wishlist" button that:
  - Is enabled only when slskd is connected and artists are selected
  - Displays count of tracks to be synced
  - Shows confirmation dialog before syncing
* **FR-10.5:** For each approved missing track, system SHALL:
  - Format search query as: `"[Artist] - [Track Title] 320 MP3"`
  - Check slskd wishlist for existing entries (skip duplicates)
  - POST new search to slskd API endpoint `/api/v0/searches`
  - Track sync status (pending/synced/failed) per track
  - Handle errors gracefully with retry logic
* **FR-10.6:** System SHALL prevent duplicate wishlist entries:
  - Query existing slskd searches via GET `/api/v0/searches`
  - Compare normalized search text before adding
  - Skip tracks already in wishlist
  - Report skipped duplicates to user
* **FR-10.7:** System SHALL display sync progress and results:
  - Progress bar showing X/Y tracks synced
  - Count of successfully added tracks
  - Count of skipped duplicates
  - Count of failed additions with error messages
  - Option to retry failed tracks
* **FR-10.8:** System SHALL handle slskd connectivity issues:
  - Connection timeout: Stop processing, show error, preserve state
  - 401 Unauthorized: Prompt to re-enter credentials
  - 429 Rate Limited: Exponential backoff and retry
  - 500 Server Error: Log error, allow manual retry
  - Network errors: Show user-friendly message and stop
* **FR-10.9:** System SHALL support multi-user scenarios:
  - Each user maintains separate slskd configuration
  - Different users can connect to different slskd instances
* **FR-10.10:** System SHALL handle special characters in track names:
  - Sanitize quotes, dashes, and special characters
  - URL encode query strings for API calls
  - Example: `Artist - "Song" (Remix)` → `Artist - Song (Remix) 320 MP3`

**Priority:** P2 (Medium)
**Dependencies:** Missing Tracks Analysis (Epic 6), slskd instance running
**Estimated Effort:** 21 story points

**Integration Architecture:**
- One-way integration: Mako Sync → slskd only
- No bi-directional sync (download status not tracked)
- REST API communication using fetch/axios
- Retry logic for transient failures
- State persistence in Supabase tables

**Future Enhancements (Out of Scope):**
- Bi-directional sync (import download status from slskd)
- Quality preferences beyond 320 MP3 (FLAC, variable bitrates)
- Download progress monitoring within Mako Sync
- Automatic periodic sync of new missing tracks
- Album-level approval workflow
- Priority queue for track downloads

---

## **5. Technical Requirements**

### **5.0 Data Model Preservation (Critical Constraint)**

**The existing database schema MUST be preserved and reused.** The current data model represents significant personal work in:

* Genre mapping tables (`spotify_genre_map_base`, `spotify_genre_map_overrides`)
* User's track genre assignments in `spotify_liked.super_genre` column
* Normalized field parsing logic (primary_artist, core_title, featured_artists, mix)
* Sync progress and resumability infrastructure

**Any schema changes MUST:**
1. Be additive only (no breaking changes to existing columns)
2. Maintain backward compatibility with existing data
3. Preserve all user-assigned genre mappings and overrides
4. Not require data migration that could lose genre assignments

### **5.1 Data Models**

**Spotify Liked Track:**
```typescript
interface SpotifyLiked {
  id: string;                    // UUID
  user_id: string;               // Foreign key to auth.users
  spotify_id: string;            // Spotify track ID
  title: string;
  artist: string;
  album?: string;
  genre?: string;                // Raw Spotify genre
  super_genre?: SuperGenre;      // Mapped super genre
  year?: number;
  bpm?: number;
  key?: string;
  added_at?: string;             // When added to Spotify
  normalized_title?: string;
  normalized_artist?: string;
  primary_artist?: string;
  featured_artists?: string[];
  mix?: string;
  core_title?: string;
}
```

**Local MP3:**
```typescript
interface LocalMP3 {
  id: string;                    // UUID
  user_id: string;
  file_path: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  bpm?: number;
  key?: string;
  bitrate?: number;
  file_size?: number;
  hash?: string;                 // For duplicate detection
  normalized_title?: string;
  normalized_artist?: string;
  primary_artist?: string;
  featured_artists?: string[];
  mix?: string;
  core_title?: string;
}
```

**Genre Mapping:**
```typescript
interface GenreMapping {
  spotify_genre: string;         // Primary key
  super_genre: SuperGenre | null;
  updated_at: string;
}

interface GenreOverride {
  id: string;
  user_id: string;
  spotify_genre: string;
  super_genre: SuperGenre;
  updated_at: string;
}
```

### **5.1.1 Data Model Semantics**

**Genre Field Meanings:**
- `genre` (spotify_liked.genre): The genre tag provided by Spotify. NULL means Spotify did not provide any genre metadata for that track.
- `super_genre` (spotify_liked.super_genre): The user's own genre classification, either derived from the genre mapping system or manually assigned.

**"Tracks Without Genre" Count Definition:**
The count of tracks needing genre processing is tracks where BOTH conditions are true:
- `genre IS NULL` (Spotify provided no genre)
- `super_genre IS NULL` (user has not assigned a super genre)

This count excludes:
- Tracks with Spotify genre (they get super_genre via mapping)
- Tracks where user manually assigned super_genre (regardless of Spotify genre)

This ensures the "unmapped/unprocessed" count accurately reflects tracks that truly need AI processing or manual assignment.

### **5.2 API Specifications (Edge Functions)**

**spotify-auth**
- GET: Initiate Spotify OAuth flow
- Returns: Redirect URL for Spotify authorization

**spotify-callback**
- GET: Handle OAuth callback
- Stores tokens securely in Vault
- Creates/updates spotify_connections record

**spotify-sync-liked**
- POST: Sync user's liked songs
- Parameters: forceFullSync (boolean)
- Returns: Sync progress and results

**genre-mapping**
- GET: Retrieve effective genre mappings for user
- PUT: Update user genre override

**ai-track-genre-suggest**
- POST: Get AI suggestion for track classification
- Parameters: track metadata
- Returns: Suggested super genre with confidence

**spotify-resync-tracks**
- POST: Re-fetch metadata from Spotify for specific tracks
- Auth: Bearer token required
- Request body:
  ```json
  { "spotifyIds": ["id1", "id2", ...] }
  ```
- Response:
  ```json
  {
    "message": "Resynced 2/3 tracks",
    "results": [
      { "spotifyId": "id1", "success": true, "title": "Track Name", "artist": "Artist" },
      { "spotifyId": "id2", "success": false, "error": "HTTP 404" }
    ]
  }
  ```
- Use case: Update track metadata after Spotify corrects artist/title info

### **5.3 Frontend Technology Stack**

**Required Technologies:**

* **Framework:** React 18+ with TypeScript
* **Build Tool:** Vite
* **Styling:** Tailwind CSS with custom design system
* **State Management:** TanStack React Query
* **Routing:** React Router v6
* **Form Management:** React Hook Form + Zod validation
* **UI Components:** shadcn/ui (customized)
* **Backend:** Supabase (Auth, Database, Edge Functions, Vault)
* **Metadata Parsing:** music-metadata-browser

### **5.4 Component Architecture**

**Core Components:**

1. **App.tsx** - Root component with routing
2. **Index.tsx** - Main dashboard page
3. **NewAuth.tsx** - Authentication page
4. **GenreMapping.tsx** - Genre mapping management
5. **SpotifyHeader.tsx** - Spotify connection status and controls
6. **LibraryHeader.tsx** - Local library controls
7. **TracksTable.tsx** - Spotify tracks display
8. **LocalTracksTable.tsx** - Local files display
9. **MissingTracksAnalyzer.tsx** - Gap analysis view
10. **NoGenreTracksProcessor.tsx** - AI-assisted classification
11. **GenreMappingTable.tsx** - Genre mapping editor

---

## **6. User Interface Requirements**

### **6.1 Design System**

**Color Palette (HSL-based semantic tokens):**

* Primary: Brand color for CTAs and highlights
* Secondary: Supporting UI elements
* Muted: Disabled states, backgrounds
* Accent: Important highlights
* Destructive: Error states, delete actions
* Background/Foreground: Base surface colors

**Typography:**

* Font Family: Custom display + refined body fonts
* Distinct, non-default choices (avoid Inter, Poppins)
* Proper hierarchy for headings and body

**Themes:**

* Dark mode primary (for DJ preference)
* Light mode option

### **6.2 Layout Specifications**

**Desktop (≥1024px):**
* Maximum content width: 1440px
* Card-based dashboard layout
* Side-by-side comparison views
* Data tables with horizontal scroll

**Tablet (768px - 1023px):**
* Stacked card layout
* Collapsible sections
* Touch-friendly targets (44x44px minimum)

**Mobile (<768px):**
* Single column layout
* Bottom navigation consideration
* Simplified table views (key columns only)

### **6.3 Key UI States**

**Loading States:**
* Skeleton loaders for tables
* Progress indicators for sync operations
* Spinner overlays for button actions

**Empty States:**
* No Spotify connection: Prompt to connect
* No local files: Prompt to scan
* No missing tracks: Success celebration
* No ungenred tracks: Completion message

**Error States:**
* API errors: Toast with retry option
* Sync failures: Detailed error message
* Auth failures: Redirect to login

---

## **7. Non-Functional Requirements**

### **7.1 Performance**

* **NFR-1:** Sync operations SHALL handle 10,000+ liked songs
* **NFR-2:** Local file scanning SHALL process 1,000+ files per session
* **NFR-3:** Table rendering SHALL remain responsive with 5,000+ rows (virtualization)
* **NFR-4:** Page load time < 3 seconds on broadband connection
* **NFR-5:** Supabase pagination requirements:
  - Default query limit is 1000 rows (silent truncation if exceeded)
  - All queries potentially returning >1000 rows MUST use explicit limit or pagination
  - Pattern: Loop with `.range(offset, offset + PAGE_SIZE - 1)` until empty result
  - Current implementation uses PAGE_SIZE = 1000 for genre caching
  - spotify_liked queries use limit(50000) to handle large collections
* **NFR-6:** Sync batch sizes:
  - Spotify API fetch: 50 tracks per request (Spotify's maximum per page)
  - Database processing: 500 tracks per chunk (CHUNK_SIZE)
  - Artist genre batching: 50 artists per Spotify /artists API call
* **NFR-7:** Spotify API rate limiting strategy:
  - No explicit delay between requests (rely on natural processing time)
  - Respect `Retry-After` header if 429 received
  - For personal use with ~10k tracks: expect sync to complete in <5 minutes
  - Spotify doesn't publish exact limits; ~1 req/sec sustained is safe

### **7.2 Reliability**

* **NFR-8:** Sync operations SHALL be resumable after interruption
* **NFR-9:** Manual genre assignments SHALL persist through full syncs
* **NFR-10:** Spotify token refresh SHALL happen automatically before expiry

### **7.3 Security**

* **NFR-11:** All Spotify tokens SHALL be stored in Supabase Vault
* **NFR-12:** All user data SHALL be protected by Row Level Security
* **NFR-13:** No sensitive data SHALL be logged to console in production
* **NFR-14:** All API calls SHALL use HTTPS

### **7.4 Usability**

* **NFR-15:** New users SHALL complete first sync within 5 minutes
* **NFR-16:** All actions SHALL provide visual feedback within 200ms
* **NFR-17:** Error messages SHALL be user-friendly, not technical

### **7.5 Browser Support**

* Chrome: Last 2 versions
* Firefox: Last 2 versions
* Safari: Last 2 versions
* Edge: Last 2 versions

### **7.6 Data Retention**

* **NFR-18:** User data SHALL be retained for 2 years from last activity
* **NFR-19:** Users MAY delete their data at any time via account settings
* **NFR-20:** Spotify tokens are refreshed automatically; stale connections (>90 days inactive) MAY be flagged for cleanup
* **NFR-21:** Sync progress records older than 30 days SHALL be automatically purged

### **7.8 Error Handling & Recovery**

* **NFR-22:** System SHALL provide clear error messages with suggested actions within 200ms of error detection
* **NFR-23:** Users SHALL be able to retry failed operations without data loss or duplicate processing
* **NFR-24:** Sync interruptions SHALL preserve progress and allow resume from last successful checkpoint
* **NFR-25:** Error states SHALL not block other application functionality (graceful degradation)
* **NFR-26:** Critical errors SHALL be logged with sufficient detail for debugging while maintaining user privacy
* **NFR-27:** Network timeouts SHALL not exceed 30 seconds with clear progress indication
* **NFR-28:** Failed operations SHALL provide specific next steps rather than generic "try again" messages

---

## **8. Testing Requirements**

### **8.1 Manual Testing Checklist**

**Authentication:**
* [ ] User can register with email/password
* [ ] User can login with existing account
* [ ] User can reset password
* [ ] Protected routes redirect to login

**Spotify Integration:**
* [ ] OAuth flow completes successfully
* [ ] Tokens are stored securely
* [ ] Incremental sync captures new tracks
* [ ] Full sync replaces all tracks
* [ ] Token refresh works automatically
* [ ] Disconnect removes connection

**Local Scanning:**
* [ ] MP3 files are parsed correctly
* [ ] Metadata is extracted accurately
* [ ] Duplicates are detected
* [ ] Large batches complete without timeout

**Genre Mapping:**
* [ ] Base mappings display correctly
* [ ] User overrides are saved
* [ ] Overrides apply to synced tracks
* [ ] Manual assignments persist through sync

**Missing Tracks:**
* [ ] Comparison logic is accurate
* [ ] Filtering by genre works
* [ ] Spotify links open correctly
* [ ] Search finds relevant tracks

---

## **9. Deployment Requirements**

### **9.1 Hosting Environment**

* **Frontend:** Lovable deployment (automatic)
* **Backend:** Supabase (external project)
* **Edge Functions:** Supabase Edge Functions

### **9.2 Environment Variables**

**Required Secrets:**
* `SPOTIFY_CLIENT_ID` - Spotify app client ID
* `SPOTIFY_CLIENT_SECRET` - Spotify app secret
* `ANTHROPIC_API_KEY` - For AI genre suggestions (claude-haiku-4-5-20251001)
* `SUPABASE_SERVICE_ROLE_KEY` - For admin operations

### **9.3 Database Setup**

Required tables:
* `profiles` - User profiles
* `spotify_connections` - OAuth tokens
* `spotify_liked` - Synced Spotify tracks
* `local_mp3s` - Scanned local files
* `spotify_genre_map_base` - Global genre mappings
* `spotify_genre_map_overrides` - User customizations
* `sync_progress` - Sync state tracking

---

## **10. Risk Assessment & Mitigation**

### **10.1 Technical Risks**

| Risk | Probability | Impact | Mitigation |
| :---- | :---- | :---- | :---- |
| Spotify API rate limits | High | Medium | Implement batching, respect rate headers |
| Large library sync timeout | Medium | High | Chunked processing, resumable syncs |
| Browser memory limits (file scanning) | Medium | Medium | Process files in batches, clear memory |
| Genre mapping inaccuracy | High | Medium | User overrides, AI assistance, feedback loop |

### **10.2 User Experience Risks**

| Risk | Probability | Impact | Mitigation |
| :---- | :---- | :---- | :---- |
| Complex onboarding | Medium | High | Setup checklist, guided flow |
| Sync takes too long | High | Medium | Progress indicators, background processing |
| Incorrect match results | Medium | High | Show confidence scores, allow manual review |

---

## **11. Success Criteria & Validation**

### **11.1 Launch Criteria (Public Beta)**

**Must Have:**
* ✅ User authentication working
* ✅ Spotify OAuth and sync functional
* ✅ Local file scanning operational
* ✅ Genre mapping with overrides working
* ✅ Missing tracks analysis accurate
* ✅ Responsive design on all devices

**Should Have:**
* ✅ AI-assisted genre suggestions
* ✅ Resumable sync operations
* ✅ Dashboard with statistics
* ⭕ Comprehensive error handling

**Nice to Have:**
* ⭕ Dark/light theme toggle
* ⭕ Export functionality
* ⭕ Batch operations UI

### **11.2 User Acceptance Criteria**

* Users can complete full workflow (connect → sync → scan → analyze) in under 10 minutes
* 90%+ of users can identify missing tracks without assistance
* Genre classification requires <20% manual override rate

---

## **12. Appendix**

### **12.1 Super Genre Definitions**

| Super Genre | Description | Example Spotify Genres |
| :---- | :---- | :---- |
| House | Electronic dance music, 4/4 beat | deep house, tech house, progressive house |
| Drum & Bass | Fast breakbeat electronic | jungle, liquid funk, neurofunk |
| Hip Hop | Rap and hip hop | hip hop, trap, boom bap |
| Pop | Popular/mainstream | pop, dance pop, indie pop |
| Electronic | Broad electronic music | electro, synthwave, ambient |
| Rock | Guitar-driven music | rock, indie rock, alternative |
| Soul-Funk | Pre-1990 R&B, soul, funk | soul, funk, motown |
| Urban | Post-1990 R&B | r&b, contemporary r&b |
| Unclassified | Unknown or edge cases | (tracks without mapping) |

### **12.2 Glossary**

* **Super Genre:** High-level genre classification used by DJs (vs granular Spotify genres)
* **Gap Analysis:** Comparison between Spotify and local library to find missing tracks
* **Normalized:** Cleaned string (lowercase, no special chars) for matching
* **Override:** User-specific genre mapping that supersedes base mapping

### **12.3 Known Data Quality Findings**

**Duplicate Tracks Analysis (December 2025):**

Database analysis identified approximately 20 duplicate track pairs in `spotify_liked` table with identical `title` AND `artist` values. Total tracks: 4,987.

**Example Duplicates:**
| Title | Artist | Count |
| :---- | :---- | :---- |
| Texas Sun | Khruangbin, Leon Bridges | 2 |
| Cherry-coloured Funk | Cocteau Twins | 2 |
| God Only Knows - Remastered 1996 | The Beach Boys | 2 |
| The Less I Know The Better | Tame Impala | 2 |
| Rhymes Like Dimes | MF DOOM | 2 |
| Life On Mars? - 2015 Remaster | David Bowie | 2 |
| Bizarre Love Triangle | New Order | 2 |
| Fela Kuti | GoldLink, Wale | 2 |

**Root Cause:**
Normalization fields (`normalized_title`, `normalized_artist`) are not populated during sync, preventing effective deduplication.

**Future Considerations:**
- Implement normalization during sync process
- Add unique constraint on normalized fields
- Create cleanup script for existing duplicates
