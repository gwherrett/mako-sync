# Mako-Sync Design Brief

## Document Information
- **Version**: 1.1
- **Last Updated**: January 10, 2026
- **Project**: mako-sync
- **Recent Updates**: Added slskd integration design patterns

---

## 1. Brand Identity

### 1.1 Concept
Mako-Sync draws inspiration from the **deep ocean habitat of mako sharks**:
- **The Mako Shark**: Speed, precision, and sleek power - representing efficient music library synchronization
- **Deep Ocean Environment**: Sophisticated blues with warm accent tones, optimized for extended use in low-light environments
- **Professional Depth**: Colors inspired by the depths where mako sharks thrive, providing optimal readability for music library management

### 1.2 Brand Personality
- **Professional**: Tool for serious music collectors and DJs
- **Efficient**: Quick, purposeful interactions
- **Trustworthy**: Reliable data handling and sync operations
- **Modern**: Contemporary dark UI with crisp typography

### 1.3 Logo
- Primary logo: Mako shark silhouette
- Located at: `src/assets/new-mako-shark-logo.png`
- Usage: Header branding, favicon consideration

---

## 2. Color System

### 2.1 Primary Palette (Deep Ocean-Inspired)

| Token | HSL Value | Hex Equivalent | Usage | Contrast Ratio |
|-------|-----------|----------------|-------|----------------|
| `--ocean-deep` | 220 25% 8% | #0F1419 | Primary background | Base |
| `--ocean-surface` | 220 20% 12% | #1A1F26 | Card backgrounds | 1.8:1 |
| `--ocean-elevated` | 220 18% 16% | #242A33 | Elevated surfaces | 2.4:1 |
| `--ocean-blue` | 210 100% 45% | #0080FF | Primary actions, links | 8.2:1 |
| `--ocean-blue-light` | 210 100% 50% | #1A8CFF | Hover states | 9.1:1 |
| `--coral-accent` | 25 85% 55% | #E67E22 | Secondary actions, highlights | 5.8:1 |

### 2.2 Enhanced Semantic Tokens

```css
/* Core Backgrounds */
--background: 220 25% 8%;        /* #0F1419 - Warmer deep navy */
--foreground: 220 15% 92%;       /* #E8EAED - Softer white */

/* Surface Hierarchy */
--card: 220 20% 12%;             /* #1A1F26 - Card backgrounds */
--card-elevated: 220 18% 16%;    /* #242A33 - Modal/dropdown backgrounds */
--popover: 220 18% 16%;          /* #242A33 - Popover backgrounds */

/* Interactive Elements */
--primary: 210 100% 45%;         /* #0080FF - Ocean blue primary */
--primary-hover: 210 100% 50%;   /* #1A8CFF - Hover state */
--secondary: 25 85% 55%;         /* #E67E22 - Coral accent */
--accent: 25 85% 55%;            /* #E67E22 - Highlights */

/* Text Hierarchy (WCAG AA Compliant) */
--text-primary: 220 15% 92%;     /* #E8EAED - Primary text (15.8:1) */
--text-secondary: 220 10% 70%;   /* #A8ACB0 - Secondary text (5.2:1) */
--text-muted: 220 8% 55%;        /* #7D8186 - Muted text (4.6:1) */

/* Structure & Inputs */
--border: 220 15% 25%;           /* #363A42 - Visible borders (3.2:1) */
--border-strong: 220 12% 35%;    /* #4A4F57 - Strong borders (4.1:1) */
--input-bg: 220 22% 10%;         /* #161B22 - Input backgrounds */
--input: 220 15% 25%;            /* #363A42 - Input borders */
--ring: 210 100% 45%;            /* #0080FF - Focus rings */

/* Status Colors */
--success: 140 60% 50%;          /* #4CAF50 - Success states */
--warning: 45 90% 55%;           /* #FF9800 - Warning states */
--destructive: 5 85% 55%;        /* #F44336 - Error states */
--muted: 220 18% 20%;            /* #2A3038 - Disabled backgrounds */
--muted-foreground: 220 8% 55%;  /* #7D8186 - Disabled text */
```

### 2.3 Enhanced Gradient Definitions

```css
/* Primary ocean gradient - blue to coral */
.ocean-gradient {
  background: linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--secondary)) 100%);
}

/* Ocean blue gradient - for primary CTAs */
.ocean-blue-gradient {
  background: linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary-hover)) 100%);
}

/* Coral gradient - for accent elements */
.coral-gradient {
  background: linear-gradient(135deg, hsl(var(--secondary)) 0%, #F39C12 100%);
}

/* Spotify integration indicator */
.spotify-gradient {
  background: linear-gradient(135deg, #1DB954 0%, #1ED760 100%);
}

/* Depth gradient - for subtle backgrounds */
.depth-gradient {
  background: linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--card-elevated)) 100%);
}
```

### 2.4 Enhanced Glass Effect

```css
.glass-card {
  background: rgba(0, 128, 255, 0.08);  /* Ocean blue-tinted glass */
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 128, 255, 0.2);
}

.glass-card-elevated {
  background: rgba(0, 128, 255, 0.12);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(0, 128, 255, 0.3);
}
```

---

## 3. Enhanced Typography

### 3.1 Font Family
- **Primary**: Inter (Google Fonts)
- **Fallback**: system-ui, -apple-system, sans-serif
- **Weights Used**: 300 (Light), 400 (Regular), 500 (Medium), 600 (Semi-bold), 700 (Bold)

### 3.2 Enhanced Type Scale
Following Tailwind CSS defaults with improved line-height for data density:

| Element | Class | Size | Weight | Line Height | Usage |
|---------|-------|------|--------|-------------|-------|
| H1 | `text-4xl` | 36px | 700 | 1.25 | Page titles |
| H2 | `text-2xl` | 24px | 600 | 1.3 | Section headers |
| H3 | `text-xl` | 20px | 600 | 1.4 | Subsection headers |
| H4 | `text-lg` | 18px | 500 | 1.4 | Component titles |
| Body | `text-base` | 16px | 400 | 1.5 | Standard text |
| Small | `text-sm` | 14px | 400 | 1.5 | Secondary info |
| Caption | `text-xs` | 12px | 400 | 1.4 | Labels, metadata |

### 3.3 Typography Tokens

```css
/* Line Height Standards */
--line-height-tight: 1.25;      /* Headings, compact layouts */
--line-height-normal: 1.5;      /* Body text, comfortable reading */
--line-height-relaxed: 1.75;    /* Dense data tables, extended reading */

/* Letter Spacing */
--tracking-tight: -0.025em;     /* Large headings */
--tracking-normal: 0;           /* Body text */
--tracking-wide: 0.025em;       /* Small caps, labels */
```

### 3.4 Enhanced Text Colors
- **Primary text**: `text-primary` (high contrast white)
- **Secondary text**: `text-secondary` (medium contrast gray)
- **Muted text**: `text-muted` (low contrast gray)
- **On primary surfaces**: `text-primary-foreground`
- **Links**: `text-primary` with `hover:text-primary-hover`
- **Interactive text**: `text-secondary` with `hover:text-foreground`

---

## 4. Spacing & Layout

### 4.1 Border Radius
```css
--radius: 0.5rem;  /* 8px base */
/* Variants */
border-radius-lg: var(--radius);           /* 8px */
border-radius-md: calc(var(--radius) - 2px); /* 6px */
border-radius-sm: calc(var(--radius) - 4px); /* 4px */
```

### 4.2 Container
- Max width: 1400px (`2xl` breakpoint)
- Horizontal padding: 2rem (32px)
- Center aligned

### 4.3 Spacing Scale
Following Tailwind defaults (4px base unit):
- `gap-1`: 4px
- `gap-2`: 8px
- `gap-4`: 16px
- `gap-6`: 24px
- `gap-8`: 32px

---

## 5. Enhanced Component Patterns

### 5.1 Enhanced Buttons

**Variants:**
| Variant | Usage | Styling | Contrast Ratio |
|---------|-------|---------|----------------|
| `default` | Primary actions | Ocean blue background, white text | 8.2:1 |
| `secondary` | Secondary actions | Coral background, white text | 5.8:1 |
| `outline` | Tertiary actions | Border only, transparent bg | 8.2:1 |
| `ghost` | Minimal emphasis | No border, hover shows accent | 5.2:1 |
| `destructive` | Dangerous actions | Error red background | 6.1:1 |
| `link` | Inline links | Underlined text, ocean blue | 8.2:1 |

**Enhanced Sizes:**
- `default`: h-10, px-4, text-sm
- `sm`: h-9, px-3, text-xs
- `lg`: h-11, px-8, text-base
- `icon`: h-10, w-10 (square)

**Focus States:**
```css
.focus-ring {
  outline: 2px solid hsl(var(--primary));
  outline-offset: 2px;
  border-radius: calc(var(--radius) - 2px);
}
```

### 5.2 Enhanced Cards
- Background: `bg-card` (elevated surface)
- Border: `border-border` (visible contrast)
- Border radius: `rounded-lg`
- Shadow: None (rely on color contrast)
- **Elevation variants:**
  - `card-flat`: Standard card background
  - `card-elevated`: Higher contrast for modals/dropdowns

### 5.3 Enhanced Tables

**Density Options:**
```css
/* Table Density Variants */
.table-compact {
  line-height: 1.25;
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
}
.table-normal {
  line-height: 1.5;
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
}
.table-relaxed {
  line-height: 1.75;
  padding: 0.75rem 1rem;
  font-size: 1rem;
}
```

**Enhanced Styling:**
- Header: `bg-muted` background with `text-secondary`
- Rows: Alternating with `hover:bg-card-elevated`
- Borders: Enhanced `border-border` for clear structure
- Sort indicators: Ocean blue for active columns

### 5.4 Enhanced Forms
- Input background: `bg-input-bg` (distinct from background)
- Border: `border-input` (improved visibility)
- Focus ring: Enhanced `ring-ring` with better contrast
- Labels: `text-secondary` with `font-medium`
- **Error states:** `border-destructive` with `text-destructive`
- **Success states:** `border-success` with `text-success`

### 5.5 Data Visualization Components

**Genre Badges:**
```css
.badge-genre {
  background: hsl(var(--card-elevated));
  border: 1px solid hsl(var(--border));
  color: hsl(var(--text-secondary));
}

.badge-genre-active {
  background: hsl(var(--primary) / 0.2);
  border: 1px solid hsl(var(--primary));
  color: hsl(var(--primary));
}
```

**Progress Indicators:**
- Sync progress: Ocean blue gradient
- Error states: Destructive red with clear messaging
- Success states: Success green with completion feedback

---

## 6. Animation & Motion

### 6.1 Transitions
- Default: `transition-colors` (color changes)
- Duration: 200ms ease-out (shadcn default)

### 6.2 Custom Animations

**Tail Splash** (Mako branding):
```css
@keyframes tail-splash {
  0%, 100% {
    opacity: 0;
    transform: translateX(0) translateY(-50%) scale(0.8);
  }
  50% {
    opacity: 1;
    transform: translateX(8px) translateY(-50%) scale(1.2);
  }
}
/* Duration: 2s, ease-in-out, infinite */
```

**Swim Shake** (Loading/processing):
```css
@keyframes swim-shake {
  0%, 100% { transform: translateX(0); }
  10% { transform: translateX(-3px); }
  20% { transform: translateX(3px); }
  30% { transform: translateX(-3px); }
  40% { transform: translateX(3px); }
  50% { transform: translateX(0); }
}
/* Duration: 0.6s, ease-in-out */
```

**Accordion** (Content expansion):
- `accordion-down`: 0.2s ease-out
- `accordion-up`: 0.2s ease-out

---

## 7. Iconography

### 7.1 Icon Library
- **Primary**: Lucide React (`lucide-react`)
- **Size Default**: 16px (via `[&_svg]:size-4` in buttons)
- **Color**: Inherits from text color

### 7.2 Common Icons
| Action | Icon |
|--------|------|
| Sync | `RefreshCw` |
| Settings | `Settings` |
| Search | `Search` |
| Filter | `Filter` |
| Success | `Check` |
| Error | `X` |
| Info | `Info` |
| Music | `Music` |

---

## 8. Dark Mode

Mako-Sync is **dark-mode only** by design:
- Optimized for extended use (DJ environments, late-night music sessions)
- Reduces eye strain when managing large music libraries
- Aligns with professional music software aesthetics (Spotify, Rekordbox, Serato)

No light mode variant is implemented or planned.

---

## 9. Third-Party Integration Styling

### 9.1 Spotify
- Use `spotify-gradient` for Spotify-related CTAs
- Spotify green: `#1DB954` to `#1ED760`
- Maintain Spotify brand guidelines for integration points

---

## 10. Enhanced Accessibility Considerations

### 10.1 WCAG AA Compliant Color Contrast
- **Primary text**: 15.8:1 contrast ratio (exceeds WCAG AAA)
- **Secondary text**: 5.2:1 contrast ratio (meets WCAG AA)
- **Muted text**: 4.6:1 contrast ratio (meets WCAG AA)
- **Interactive elements**: Minimum 4.5:1 for all states
- **Borders and structure**: Minimum 3:1 for non-text elements

### 10.2 Enhanced Focus States
```css
.focus-visible {
  outline: 2px solid hsl(var(--primary));
  outline-offset: 2px;
  border-radius: calc(var(--radius) - 2px);
}

.focus-within {
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.2);
}
```

### 10.3 Keyboard Navigation
- All interactive elements accessible via Tab navigation
- Skip links for main content areas
- Arrow key navigation for data tables
- Escape key closes modals and dropdowns

### 10.4 Screen Reader Support
- Semantic HTML structure with proper headings
- ARIA labels for complex interactions
- Live regions for dynamic content updates
- Alternative text for all meaningful images

### 10.5 Motion and Animation
- Respects `prefers-reduced-motion` media query
- Essential animations only (loading, state changes)
- No auto-playing animations that could cause distraction
- Smooth transitions with appropriate timing (200ms default)

### 10.6 Data Table Accessibility
- Proper table headers with scope attributes
- Caption elements for table descriptions
- Sortable column indicators
- Row/column count announcements for screen readers

---

## 11. File Structure

```
src/
├── index.css              # CSS variables, base styles, utilities
├── components/ui/         # shadcn/ui components (customized)
├── assets/
│   └── new-mako-shark-logo.png
└── ...

tailwind.config.ts         # Tailwind configuration with design tokens
```

---

## 12. Enhanced Design Principles

1. **Accessibility First**: All design decisions prioritize WCAG AA compliance and inclusive design
2. **Consistency**: Use semantic tokens exclusively, never hardcode colors
3. **Hierarchy**: Clear visual hierarchy through typography, spacing, and contrast
4. **Efficiency**: Minimize clicks, maximize information density for power users
5. **Feedback**: Every action should have visible feedback (loading, success, error)
6. **Restraint**: Dark, professional aesthetic - avoid unnecessary decoration
7. **Legibility**: Optimized for extended use in music library management scenarios
8. **Performance**: Design choices support fast rendering and smooth interactions

---

## 13. Implementation Guidelines

### 13.1 Color Migration Strategy
1. **Phase 1**: Update CSS custom properties in `src/index.css`
2. **Phase 2**: Test contrast ratios across all components
3. **Phase 3**: Update component variants and states
4. **Phase 4**: Validate accessibility compliance

### 13.2 Component Enhancement Priority
1. **Critical**: Tables, forms, buttons (data interaction)
2. **High**: Cards, navigation, status indicators
3. **Medium**: Animations, decorative elements
4. **Low**: Advanced visual effects, non-essential styling

### 13.3 Testing Requirements
- **Contrast testing**: Use tools like WebAIM Contrast Checker
- **Keyboard navigation**: Test all interactive flows
- **Screen reader testing**: Validate with NVDA/JAWS
- **Color blindness**: Test with color vision simulators

---

## 14. slskd Integration UI Patterns

### 14.1 Configuration Section (Settings Page)

**Location**: Add to existing Security/Settings page

**Visual Design**:
```
┌─────────────────────────────────────────────────────┐
│ slskd Integration                           [badge] │
├─────────────────────────────────────────────────────┤
│                                                     │
│ API Endpoint                                        │
│ ┌──────────────────────────────────────────────┐  │
│ │ http://localhost:5030                        │  │
│ └──────────────────────────────────────────────┘  │
│                                                     │
│ API Key                                             │
│ ┌──────────────────────────────────────────────┐  │
│ │ ••••••••••••••••••••                        │  │
│ └──────────────────────────────────────────────┘  │
│                                                     │
│ [Test Connection]    [Save]                         │
│                                                     │
│ Status: ● Connected                                 │
└─────────────────────────────────────────────────────┘
```

**Component Specifications**:
- **Card**: Use `<Card>` with `bg-card` background
- **Badge**: Connection status indicator
  - Green (`bg-success`) when connected
  - Red (`bg-destructive`) when disconnected
  - Yellow (`bg-warning`) when testing
- **Inputs**: Use `<Input>` components
  - API Endpoint: `type="url"` with validation
  - API Key: `type="password"` for security
- **Buttons**:
  - Test Connection: `variant="outline"` with loading spinner
  - Save: `variant="default"` (primary ocean blue)
- **Status**: Small text with colored dot indicator

### 14.2 Artist Selection Interface (Missing Tracks Analyzer)

**Enhancement**: Add checkboxes to existing artist groups

**Visual Design**:
```
┌─────────────────────────────────────────────────────┐
│ Missing Tracks by Artist                            │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ☑ Pink Floyd                             12 tracks │
│   ◦ House  ◦ Rock                                  │
│   Comfortably Numb                                  │
│   Time                                              │
│   Money                                             │
│   [+ 9 more tracks]                                 │
│                                                     │
│ ☐ Radiohead                               8 tracks │
│   ◦ Alternative  ◦ Electronic                       │
│   Karma Police                                      │
│   Paranoid Android                                  │
│   [+ 6 more tracks]                                 │
│                                                     │
│ Selected: 12 tracks from 1 artist                   │
│                                                     │
│ [Push to slskd]                                     │
└─────────────────────────────────────────────────────┘
```

**Component Specifications**:
- **Checkbox**: Use `<Checkbox>` from Shadcn/ui
  - Position: Left of artist name
  - Hover: Show subtle background highlight
  - State: Indeterminate if partially selected (future)
- **Artist Group**: Existing card design with added checkbox
  - Hover: `hover:bg-accent/50` for entire row
  - Selected: Subtle border or background change
- **Track Count Badge**: `<Badge variant="secondary">`
- **Genre Pills**: `<Badge variant="outline" className="text-xs">`
- **Action Button**:
  - Label: "Push to slskd"
  - Style: Primary button with icon
  - Disabled state: When no slskd config or no artists selected
  - Icon: Download or arrow icon from lucide-react

### 14.3 Sync Progress Modal

**Trigger**: When user clicks "Push to slskd"

**Visual Design**:
```
┌─────────────────────────────────────────────────────┐
│ Syncing to slskd                          [X Close] │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Progress: 47/120 tracks                             │
│ ████████████░░░░░░░░░░░░░░░░░░░░░░ 39%             │
│                                                     │
│ ✓ Added: 42                                         │
│ ⊘ Skipped (duplicates): 5                          │
│ ✗ Failed: 0                                         │
│                                                     │
│ Currently processing:                               │
│ Pink Floyd - Comfortably Numb                      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Component Specifications**:
- **Modal**: `<Dialog>` component
- **Progress Bar**: `<Progress>` component
  - Color: Primary ocean blue
  - Height: 8px for visibility
- **Status Counts**:
  - Success: Green text with checkmark
  - Skipped: Yellow/orange text with skip icon
  - Failed: Red text with error icon
- **Current Track**: Muted text, updates in real-time
- **Close Button**: Disabled while syncing, enabled after completion

### 14.4 Results Summary

**Display**: After sync completes (same modal, updated)

**Visual Design**:
```
┌─────────────────────────────────────────────────────┐
│ Push complete                             [X Close] │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ✓ Successfully Added: 115 tracks                    │
│ ⊘ Skipped (duplicates): 5 tracks                   │
│ ✗ Failed: 0 tracks                                  │
│                                                     │
│ Each added track is now a search in slskd.          │
│ Download the results from slskd's Searches page.    │
│                                                     │
│ [Close]                                             │
└─────────────────────────────────────────────────────┘
```

**With Errors**:
```
┌─────────────────────────────────────────────────────┐
│ Sync Completed with Errors                [X Close] │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ✓ Successfully Added: 112 tracks                    │
│ ⊘ Skipped (duplicates): 5 tracks                   │
│ ✗ Failed: 3 tracks                                  │
│                                                     │
│ Errors:                                             │
│ • Pink Floyd - Echoes                               │
│   Network timeout                                   │
│ • Radiohead - Creep                                 │
│   Connection refused                                │
│ • The Beatles - Let It Be                           │
│   Rate limited                                      │
│                                                     │
│ [Retry Failed Tracks]    [Close]                    │
└─────────────────────────────────────────────────────┘
```

**Component Specifications**:
- **Alert/Banner**: Use appropriate color for status
  - Success: `bg-success/10` border `border-success`
  - Warning: `bg-warning/10` border `border-warning`
- **Error List**: Scrollable if many errors, max-height 200px
- **Retry Button**: `variant="default"` only shown if failures exist
- **Close Button**: `variant="outline"`

### 14.5 Connection Status Indicator

**Location**: In MissingTracksAnalyzer header (top right)

**Visual Design**:
```
Small badge:  [● slskd: Connected]

Or if disconnected:  [⊘ slskd: Not configured]
```

**Component Specifications**:
- **Badge**: Small, subtle, top-right of Missing Tracks card
- **States**:
  - Connected: Green dot + "Connected"
  - Disconnected: Red dot + "Not configured"
  - Error: Yellow dot + "Connection error"
- **Tooltip**: Show endpoint on hover
- **Click**: Navigate to settings (optional)

### 14.6 Accessibility Requirements

**Keyboard Navigation**:
- Tab through artist checkboxes
- Space to toggle checkbox
- Enter to activate "Push to slskd" button
- Esc to close modal

**Screen Reader**:
- Checkbox: "Select Pink Floyd, 12 tracks"
- Progress: "Syncing 47 of 120 tracks, 39 percent"
- Status: "Successfully added 115 tracks"

**ARIA Labels**:
```tsx
<Checkbox
  aria-label={`Select ${artist}, ${trackCount} tracks`}
  aria-describedby={`genres-${artistId}`}
/>

<Button
  aria-label="Push selected tracks to slskd as searches"
  aria-disabled={!canSync}
>
  Push to slskd
</Button>
```

### 14.7 Color Usage for slskd Integration

- **Primary Action**: Ocean blue (`--primary`) for sync button
- **Success States**: Use `--success` for added tracks
- **Warning States**: Use `--warning` for skipped/rate limited
- **Error States**: Use `--destructive` for failed syncs
- **Neutral States**: Use `--muted` for disabled states

### 14.8 Responsive Behavior

**Desktop (≥1024px)**:
- Full width artist groups with all tracks visible
- Side-by-side buttons in sync modal
- Wide progress bar

**Tablet (768px - 1023px)**:
- Collapsible track lists (show first 3, "+ X more")
- Stack buttons in sync modal
- Maintain progress bar width

**Mobile (<768px)**:
- Artist name + track count only
- Expandable track list on tap
- Full-width buttons
- Progress bar fills container

---

## 15. Component Checklist for slskd Integration

**New Files to Create**:
- [ ] `src/components/SlskdConfigSection.tsx` - Settings UI
- [ ] `src/components/SlskdSyncProgress.tsx` - Progress modal
- [ ] `src/components/SlskdConnectionBadge.tsx` - Status indicator
- [ ] `src/services/slskdClient.service.ts` - API client
- [ ] `src/hooks/useSlskdConfig.ts` - Config management
- [ ] `src/hooks/useSlskdSync.ts` - Sync operations
- [ ] `src/types/slskd.ts` - TypeScript interfaces

**Files to Modify**:
- [ ] `src/components/MissingTracksAnalyzer.tsx` - Add checkboxes + sync button
- [ ] `src/pages/Security.tsx` - Add slskd config section

**Design System Components to Use**:
- `<Card>`, `<CardHeader>`, `<CardContent>` - Container structure
- `<Input>` - API endpoint and key inputs
- `<Button>` - Actions (test, save, sync)
- `<Checkbox>` - Artist selection
- `<Badge>` - Status indicators, genre pills
- `<Dialog>` - Sync progress modal
- `<Progress>` - Sync progress bar
- `<Alert>` - Error/success messages
- `<Tooltip>` - Contextual help

---

**End of Document**
