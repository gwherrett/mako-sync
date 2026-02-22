# UI Changes Plan

## Overview
This plan covers four UI improvements to the Mako-Sync dashboard.

---

## 1. Reorder Tabs: Local → Spotify → Matching

**Current Order:** Spotify | Local | Matching
**New Order:** Local | Spotify | Matching

### Files to Modify
- [Index.tsx:84-99](src/pages/Index.tsx#L84-L99) - Reorder `TabsTrigger` elements
- [Index.tsx:56](src/pages/Index.tsx#L56) - Change default `activeTab` from `'spotify'` to `'local'`

### Changes
```tsx
// Before (line 84-99)
<TabsTrigger value="spotify">...</TabsTrigger>
<TabsTrigger value="local">...</TabsTrigger>
<TabsTrigger value="sync">...</TabsTrigger>

// After
<TabsTrigger value="local">...</TabsTrigger>
<TabsTrigger value="spotify">...</TabsTrigger>
<TabsTrigger value="sync">...</TabsTrigger>
```

---

## 2. Rename "Common Genre" → "Supergenre"

**Current terminology:** "Common Genre", "common genres", "super_genre"
**New terminology:** "Supergenre" (user-facing only, database fields unchanged)

### Files to Modify

| File | Location | Current Text | New Text |
|------|----------|--------------|----------|
| [TrackFilters.tsx](src/components/common/TrackFilters.tsx) | Lines 146, 149 | "All common genres" | "All Supergenres" |
| [TracksTable.tsx](src/components/TracksTable.tsx) | Line 455 | "Common Genre" | "Supergenre" |
| [TracksTable.tsx](src/components/TracksTable.tsx) | Line 398 | superGenreLabel prop | "All Supergenres" |
| [LocalTracksTable.tsx](src/components/LocalTracksTable.tsx) | Line 455 | "All Common genres" | "All Supergenres" |
| [GenreMappingTable.tsx](src/components/GenreMapping/GenreMappingTable.tsx) | Line 216 | "Common Genre" | "Supergenre" |
| [MissingTracksAnalyzer.tsx](src/components/MissingTracksAnalyzer.tsx) | Lines 126, 184, 191 | "Common Genre" references | "Supergenre" |

### Scope Note
Only UI labels change. Database column names (`super_genre`), TypeScript types, and variable names remain unchanged.

---

## 3. Unify Filters Across Tabs

**Current State:**
- **Spotify tab:** Search, Date filters, Supergenre, Spotify Genre, Artist, Unmapped toggle
- **Local tab:** Search, Genre, Artist + Advanced filters (Year, Album, Format, Size, Metadata)
- **Matching tab:** Separate filter implementation

### Approach: Persistent Shared Filter State

Lift shared filter state to Index.tsx so filters persist when switching tabs. This architecture is future-proofed for when **both Local and Spotify tracks will have Supergenre mappings**.

#### Core Shared Filters (all tabs)
- **Search** (tracks/artists)
- **Supergenre** dropdown - Will apply to both Spotify and Local tracks once local genre mapping is implemented
- **Artist** dropdown

#### Tab-Specific Filters (remain in child components)
| Tab | Additional Filters |
|-----|-------------------|
| Spotify | Date filters (Last Week/Month), Spotify Genre, Unmapped toggle |
| Local | Genre (from file metadata), Advanced filters (Year range, Album, Format, Size, Metadata) |
| Matching | (uses shared Supergenre filter) |

#### Future State
When local files gain Supergenre mapping:
- Supergenre filter will work identically across Local and Spotify tabs
- Seamless filtering experience regardless of source

### Files to Modify
- [Index.tsx](src/pages/Index.tsx) - Add shared filter state, pass to children
- [TracksTable.tsx](src/components/TracksTable.tsx) - Accept filter props from parent
- [LocalTracksTable.tsx](src/components/LocalTracksTable.tsx) - Accept filter props from parent
- [SyncAnalysis.tsx](src/components/SyncAnalysis.tsx) - Accept filter props from parent
- [TrackFilters.tsx](src/components/common/TrackFilters.tsx) - Already reusable, may need minor updates

---

## 4. Add Sorting to All Columns

**Current Sorting:**
| Tab | Sortable Columns | Non-Sortable Columns |
|-----|------------------|---------------------|
| Spotify | Added Date, Year, Artist | Title, Album, Supergenre, Spotify Genre |
| Local | Modified Date, Year, Artist | Title, Album, Genre, Bitrate, File Size |
| Genre Mapping | Spotify Genre, Supergenre, Reviewed | — |

### Recommendation: Enable Sorting on All Data Columns

#### Spotify Tab ([TracksTable.tsx](src/components/TracksTable.tsx))
Add sorting for:
- **Title** - Alphabetical (A-Z, Z-A)
- **Album** - Alphabetical
- **Supergenre** - Alphabetical (nulls last)
- **Spotify Genre** - Alphabetical (nulls last)

#### Local Tab ([LocalTracksTable.tsx](src/components/LocalTracksTable.tsx))
Add sorting for:
- **Title** - Alphabetical
- **Album** - Alphabetical
- **Genre** - Alphabetical (nulls last)
- **Bitrate** - Numeric (high/low)
- **File Size** - Numeric (large/small)

#### Implementation Pattern
Both tables already have sorting infrastructure:
```tsx
// Existing pattern in TracksTable.tsx (lines 60-61, 320-328)
const [sortField, setSortField] = useState<string>('added_at');
const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

const handleSort = (field: string) => {
  if (sortField === field) {
    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
  } else {
    setSortField(field);
    setSortDirection('asc');
  }
  setCurrentPage(1);
};
```

### Changes Required

1. **Add click handlers to non-sortable column headers**
2. **Add sort icons (ChevronUp/Down) to new sortable columns**
3. **Update database queries** to handle new sort fields
4. **Handle null values** - Sort nulls to end regardless of direction

### Query Considerations
- Sorting happens server-side via Supabase queries
- Need to add `.order()` clauses for new fields
- Consider index implications for large datasets

---

## Implementation Order (Suggested)

1. **Tab reorder** - Quick win, low risk
2. **Supergenre rename** - Text-only changes, low risk
3. **Sorting expansion** - Medium effort, contained to table components
4. **Filter unification** - Largest effort, requires architectural decision

---

## Decisions

1. **Filter unification:** Option A - Persistent filters with shared state. Future-proofed for when both Local and Spotify genres map to Supergenres.

2. **Default tab:** Change to "Local"

3. **Sorting:** Implement all sortable columns together

---

## Implementation Checklist

### Phase 1: Tab Reorder + Default Change
- [x] Reorder TabsTrigger elements: Local → Spotify → Matching
- [x] Change default activeTab to 'local'

### Phase 2: Supergenre Rename
- [x] TrackFilters.tsx - "All common genres" → "All Supergenres"
- [x] TracksTable.tsx - Column header + label prop
- [x] LocalTracksTable.tsx - Filter label
- [x] GenreMappingTable.tsx - Column header
- [x] MissingTracksAnalyzer.tsx - CSV headers and labels
- [x] GenreMapping.tsx - Page description

### Phase 3: Unified Persistent Filters
- [x] Add shared filter state to Index.tsx (search, supergenre)
- [x] Update TracksTable to accept filter props from parent
- [x] Update LocalTracksTable to accept filter props from parent
- [x] Update SyncAnalysis to accept filter props from parent
- [x] Extract shared filter bar to render above tabs
- [x] Tab-specific filters remain in their components

### Phase 4: Sorting Expansion
**Spotify Tab (TracksTable.tsx):**
- [x] Add sorting for Title column
- [x] Add sorting for Album column
- [x] Add sorting for Supergenre column
- [x] Add sorting for Spotify Genre column

**Local Tab (LocalTracksTable.tsx):**
- [x] Add sorting for Title column
- [x] Add sorting for Album column
- [x] Add sorting for Genre column
- [x] Add sorting for Bitrate column
- [x] Add sorting for File Size column

### Phase 5: Testing
- [x] Build passes without errors
- [ ] Manual testing: Verify tab order and default
- [ ] Manual testing: Verify Supergenre terminology throughout
- [ ] Manual testing: Test filter persistence across tab switches
- [ ] Manual testing: Test all sorting columns (ascending/descending, null handling)
