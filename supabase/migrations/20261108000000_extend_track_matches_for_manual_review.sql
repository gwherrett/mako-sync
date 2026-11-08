-- MAK-153: Manual Match Review Phase 1. Let track_matches store every review outcome:
-- confirmed match, rejected candidate, unreviewed engine suggestion, and "confirmed: no
-- local copy exists". Written against the live schema recorded in MAK-151
-- (docs/plans/manual-match-review.md, Phase 0). Keys and FKs are unchanged.
--
-- Row semantics (is_confirmed is tri-state):
--   true  = confirmed match, or confirmed missing when mp3_id IS NULL
--   false = explicitly rejected candidate (kept as training signal)
--   null  = suggested by the engine, not yet reviewed
--
-- spotify_track_id is spotify_liked.id (uuid), not Spotify's spotify_id.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.track_matches
  -- mp3_id = NULL with is_confirmed = true means "confirmed: no local copy exists".
  ALTER COLUMN mp3_id DROP NOT NULL,
  -- The live default is false, which would save an insert that leaves the column out
  -- as a rejection.
  ALTER COLUMN is_confirmed DROP DEFAULT,
  -- The live default 'auto' isn't one of the planned values; the service always sets it.
  ALTER COLUMN match_method DROP DEFAULT,
  ADD COLUMN reviewed_at timestamptz NULL,
  ADD COLUMN failure_category text NULL,
  ADD COLUMN notes text NULL,
  ADD COLUMN source text NOT NULL DEFAULT 'engine',
  ADD CONSTRAINT track_matches_source_check CHECK (source IN ('engine', 'human'));

COMMENT ON COLUMN public.track_matches.mp3_id IS
  'local_mp3s.id of the candidate. NULL with is_confirmed = true means confirmed missing: no local copy exists.';
COMMENT ON COLUMN public.track_matches.is_confirmed IS
  'true = confirmed match (or confirmed missing when mp3_id IS NULL), false = rejected candidate, null = engine suggestion not yet reviewed.';
COMMENT ON COLUMN public.track_matches.match_method IS
  'Free text. Convention: tier1_exact, tier2_core, tier3_fuzzy, manual.';
COMMENT ON COLUMN public.track_matches.matched_at IS
  'When the row was created.';
COMMENT ON COLUMN public.track_matches.reviewed_at IS
  'When a person last confirmed or rejected this row. NULL if never reviewed.';
COMMENT ON COLUMN public.track_matches.failure_category IS
  'Why the engine got this wrong. Same vocabulary as FailureCategory in src/services/__tests__/fixtures/eval-types.ts.';
COMMENT ON COLUMN public.track_matches.source IS
  'Who created the row: engine or human.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- At most one confirmed outcome (match or confirmed missing) per Spotify track.
CREATE UNIQUE INDEX track_matches_one_confirmed_per_spotify_track
  ON public.track_matches (spotify_track_id)
  WHERE is_confirmed = true;

-- No duplicate candidate rows across repeated review sessions. This is a plain unique
-- constraint rather than a partial index WHERE mp3_id IS NOT NULL: NULLs are distinct by
-- default, so rows with mp3_id = NULL never conflict and the behaviour is the same. Unlike a
-- partial index, a plain constraint can be the target of a supabase-js
-- upsert({ onConflict: 'spotify_track_id,mp3_id' }), because PostgREST's ON CONFLICT has no
-- WHERE clause to match a partial index predicate. Its leading column also covers the
-- spotify_liked delete cascade.
ALTER TABLE public.track_matches
  ADD CONSTRAINT track_matches_spotify_track_id_mp3_id_key UNIQUE (spotify_track_id, mp3_id);

-- Postgres doesn't index FK columns, and every local_mp3s delete cascades into this table.
CREATE INDEX track_matches_mp3_id_idx
  ON public.track_matches (mp3_id);

-- ---------------------------------------------------------------------------
-- RLS (policies created in 20250903233328_3afc72eb-9374-4718-8414-30ff4d72e8d8.sql)
-- SELECT and DELETE are unchanged: their OR logic still works when mp3_id is NULL.
-- ---------------------------------------------------------------------------

-- INSERT: the old check required the MP3 to belong to the user, which rejects mp3_id IS NULL.
DROP POLICY IF EXISTS "Users can create their own track matches" ON public.track_matches;
CREATE POLICY "Users can create their own track matches"
ON public.track_matches
FOR INSERT
WITH CHECK (
  spotify_track_id IN (
    SELECT id FROM public.spotify_liked WHERE user_id = auth.uid()
  )
  AND (
    mp3_id IS NULL
    OR mp3_id IN (
      SELECT id FROM public.local_mp3s WHERE user_id = auth.uid()
    )
  )
);

-- UPDATE: the old policy had no WITH CHECK, so Postgres reused the USING (OR) expression,
-- which let an update point mp3_id at an MP3 owned by another user. USING is unchanged.
DROP POLICY IF EXISTS "Users can update their own track matches" ON public.track_matches;
CREATE POLICY "Users can update their own track matches"
ON public.track_matches
FOR UPDATE
USING (
  spotify_track_id IN (
    SELECT id FROM public.spotify_liked WHERE user_id = auth.uid()
  )
  OR mp3_id IN (
    SELECT id FROM public.local_mp3s WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  spotify_track_id IN (
    SELECT id FROM public.spotify_liked WHERE user_id = auth.uid()
  )
  AND (
    mp3_id IS NULL
    OR mp3_id IN (
      SELECT id FROM public.local_mp3s WHERE user_id = auth.uid()
    )
  )
);
