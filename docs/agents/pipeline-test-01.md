# Pipeline Test 01 — MAK-68: Spotify Unlike button

**Date:** 2026-04-08
**Input:** MAK-68 — "Unlike button for Spotify is either not working or not implemented"
**Pipeline stages used:** Architect Agent → Dev Agent (Debug Agent not needed — no bug investigation)
**Issues created:** MAK-76, MAK-77

---

## Stage 1 — Debug Agent

Not invoked. MAK-68 is a missing feature, not a bug report with a symptom to diagnose. Proceeding directly to Architect Agent.

---

## Stage 2 — Architect Agent

Full output recorded in [architect-agent-prompt.md](architect-agent-prompt.md) under "Validation test case — MAK-68".

**Summary:**
- Pre-flight found `docs/plans/remove-spotify-duplicates.md` (related, but shipped — not an existing plan for this feature)
- Two options proposed
- **Selected:** Option 1 — thin wrapper on `DuplicateDetectionService` + Unlike button in `MissingTracksAnalyzer`
- **Invariant caught:** Pattern 2 live violation at `duplicateDetection.service.ts:176` — `supabase.functions.invoke` called without `withTimeout`. Flagged as mandatory co-change.

**Handoff to Dev Agent:**
```
Decision: Option 1 — unlikeTrack() wrapper on DuplicateDetectionService + Unlike button in MissingTracksAnalyzer
Affected files: src/services/duplicateDetection.service.ts, src/components/MissingTracksAnalyzer.tsx
DB schema changes: none
Eval run required: no
Sequencing note: withTimeout fix on duplicateDetection.service.ts:176 must land in same issue as unlikeTrack()
Flag: Pattern 2 fix required; no migration; no eval; edge-function-deploy not needed
```

---

## Stage 3 — Dev Agent

### Applying sequencing rules

- Rule 1 (first issue = smallest observable slice): the button must be visible and functional in the first issue — cannot ship a service method with no UI
- Rule 2 (independently shippable): first issue ships the core feature end-to-end; second issue extends to a second surface
- Rule 3 (no pure infrastructure): Pattern 2 fix must land alongside the feature, not as a standalone issue
- Rule 4 (flag before scoping): Pattern 2 flagged in Issue 1 before any AC is written
- Rule 5 (batch size): not applicable — single-track unlike
- Rule 6 (eval issues): not applicable — no matching/normalization changes

### Dev Agent output → Issues

---

**[MAK-76] Fix withTimeout on unlike edge function call and add Unlike button to MissingTracksAnalyzer**

**Description:**
The `spotify-unlike-tracks` Edge Function is already built and working, but `DuplicateDetectionService.resolveSpotifyDuplicate` calls `supabase.functions.invoke` at line 176 without a `withTimeout` wrapper (Pattern 2 violation). This issue fixes that, adds a single-track `unlikeTrack()` wrapper method, and wires an Unlike button into `MissingTracksAnalyzer` so users can remove individual tracks from their Spotify library. First observable slice of the Spotify Unlike feature.

**Acceptance criteria:**
- [ ] `DuplicateDetectionService.unlikeTrack(spotifyId, userId)` method added; calls `spotify-unlike-tracks` edge function with `withTimeout` at 30s
- [ ] Existing `resolveSpotifyDuplicate` updated to use the same `withTimeout`-wrapped call (no longer bare `supabase.functions.invoke` at line 176)
- [ ] Unlike button visible on each track row in `MissingTracksAnalyzer`; clicking it unliked the track on Spotify and removes it from the `spotify_liked` table
- [ ] Button shows a loading state while the edge function call is in-flight; shows a toast on success and on error
- [ ] Unit tests updated in `src/services/__tests__/duplicateDetection.service.test.ts` to cover `unlikeTrack()` and the updated `resolveSpotifyDuplicate` call
- [ ] No regressions in existing tests (`npx vitest run`)

**Dependencies:** none

**Flags:** Pattern 2 fix (withTimeout on `duplicateDetection.service.ts:176`)

---

**[MAK-77] Extend Unlike button to TracksTable**

**Description:**
Extends the Unlike button introduced in MAK-76 to the `TracksTable` component, giving users access to the unlike action from the main Spotify tracks view in addition to the Missing Tracks Analyzer. Reuses `DuplicateDetectionService.unlikeTrack()` with no new service logic.

**Acceptance criteria:**
- [ ] Unlike button visible on each row in `TracksTable`; same loading and toast behaviour as `MissingTracksAnalyzer`
- [ ] Button only renders when the user has an active Spotify connection (check via `SpotifyAuthManager.getInstance()`)
- [ ] No regressions in existing tests (`npx vitest run`)

**Dependencies:** MAK-76 must be merged first

**Flags:** none

---

## Stage 4 — Verification against Dev Agent ACs

| Check | MAK-76 | MAK-77 |
|-------|--------|--------|
| Has title, description, ACs, dependencies, flags | ✅ | ✅ |
| First issue is smallest observable slice | ✅ service + button in one issue | n/a |
| Each issue independently shippable | ✅ | ✅ (MAK-76 merged first) |
| Migration/eval/schema flagged | ✅ Pattern 2 flag | ✅ none |
| Last AC is `npx vitest run` | ✅ | ✅ |
| No pure infrastructure issues | ✅ | ✅ |

---

## Gaps found

None. The pipeline ran cleanly. One observation: the Dev Agent rules correctly forced the Pattern 2 fix into MAK-76 rather than allowing it to be deferred — this is the intended behaviour and confirms Rule 3 (no pure infrastructure issues) is working as written.

---

## Repeatability check

A second run was performed using a different input: the `genreMapping.service.ts:9` unprotected edge function call (live Pattern 2 violation flagged in MAK-75).

- **Debug Agent input:** "Genre mapping fails to load intermittently, no error shown, sometimes takes 30+ seconds"
- **Debug Agent output:** Pattern 2, `src/services/genreMapping.service.ts:9`, violation type: missing (`supabase.functions.invoke` with no `withTimeout`)
- **Architect Agent:** single-option (fix is unambiguous — add withTimeout); still produced the option + recommendation + handoff format correctly
- **Dev Agent:** produced one issue (single-track fix, no sequencing needed)
- **Result:** consistent format and quality ✅
