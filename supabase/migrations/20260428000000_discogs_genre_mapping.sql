-- Discogs Genre Mapping
-- Adds super_genre classification for vinyl records using Discogs genre/style taxonomy.
-- Discogs uses a two-level system: top-level genres (~15) and styles (~500+).
-- Both are stored in a single discogs_term_map_base table with a term_type column.
-- Styles take priority over genres when resolving super_genre.
-- super_genre on physical_media is the key field enabling vinyl gap analysis filtering.

-- ============================================================
-- Add super_genre to physical_media
-- Typed as TEXT (not the super_genre enum) — consistent with local_mp3s.
-- Populated by compute_discogs_super_genre() triggered on insert/update.
-- ============================================================
ALTER TABLE public.physical_media
  ADD COLUMN IF NOT EXISTS super_genre TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_physical_media_super_genre
  ON public.physical_media (user_id, super_genre)
  WHERE super_genre IS NOT NULL;


-- ============================================================
-- discogs_term_map_base
-- Single table mapping any Discogs genre or style string to a super_genre.
-- term_type: 'style' takes priority over 'genre' in resolution.
-- Global (not per-user) — same base data for all users.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discogs_term_map_base (
  discogs_term  TEXT        PRIMARY KEY,
  term_type     TEXT        NOT NULL CHECK (term_type IN ('genre', 'style')),
  super_genre   super_genre NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discogs_term_map_base_type
  ON public.discogs_term_map_base (term_type);

ALTER TABLE public.discogs_term_map_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read discogs term base"
  ON public.discogs_term_map_base FOR SELECT
  USING (auth.role() = 'authenticated');


-- ============================================================
-- discogs_genre_map_overrides
-- Per-user overrides for any Discogs genre or style string.
-- No FK to base table — users can override unmapped terms too.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discogs_genre_map_overrides (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  discogs_term  TEXT        NOT NULL,
  super_genre   super_genre NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, discogs_term)
);

CREATE INDEX IF NOT EXISTS idx_discogs_genre_map_overrides_user_id
  ON public.discogs_genre_map_overrides (user_id);

ALTER TABLE public.discogs_genre_map_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own discogs overrides"
  ON public.discogs_genre_map_overrides FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "insert own discogs overrides"
  ON public.discogs_genre_map_overrides FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update own discogs overrides"
  ON public.discogs_genre_map_overrides FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "delete own discogs overrides"
  ON public.discogs_genre_map_overrides FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- v_effective_discogs_term_map
-- Merges discogs_term_map_base with per-user overrides.
-- Returns every known term with the effective super_genre for
-- the calling user. Used by the Genre Tools Discogs tab.
-- ============================================================
CREATE OR REPLACE VIEW public.v_effective_discogs_term_map AS
SELECT
  b.discogs_term,
  b.term_type,
  COALESCE(o.super_genre, b.super_genre)::TEXT AS super_genre,
  o.user_id IS NOT NULL                        AS is_overridden
FROM public.discogs_term_map_base b
LEFT JOIN public.discogs_genre_map_overrides o
  ON o.discogs_term = b.discogs_term
 AND o.user_id = auth.uid();


-- ============================================================
-- compute_discogs_super_genre()
-- Resolves genres[] + styles[] to a single super_genre TEXT.
-- Resolution order (first non-null match wins):
--   1. User override matching any style
--   2. discogs_term_map_base style match
--   3. User override matching any genre
--   4. discogs_term_map_base genre match
--   5. 'Other'
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_discogs_super_genre(
  p_genres  TEXT[],
  p_styles  TEXT[],
  p_user_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result TEXT;
BEGIN
  -- 1. User override on any style
  SELECT o.super_genre::TEXT INTO v_result
  FROM public.discogs_genre_map_overrides o
  WHERE o.user_id = p_user_id
    AND o.discogs_term = ANY(p_styles)
  LIMIT 1;
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;

  -- 2. Base style mapping
  SELECT b.super_genre::TEXT INTO v_result
  FROM public.discogs_term_map_base b
  WHERE b.term_type = 'style'
    AND b.discogs_term = ANY(p_styles)
  LIMIT 1;
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;

  -- 3. User override on any genre
  SELECT o.super_genre::TEXT INTO v_result
  FROM public.discogs_genre_map_overrides o
  WHERE o.user_id = p_user_id
    AND o.discogs_term = ANY(p_genres)
  LIMIT 1;
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;

  -- 4. Base genre mapping
  SELECT b.super_genre::TEXT INTO v_result
  FROM public.discogs_term_map_base b
  WHERE b.term_type = 'genre'
    AND b.discogs_term = ANY(p_genres)
  LIMIT 1;
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;

  -- 5. Fallback
  RETURN 'Other';
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_discogs_super_genre(TEXT[], TEXT[], UUID)
  TO authenticated, service_role;


-- ============================================================
-- recompute_all_discogs_super_genres()
-- Recomputes super_genre for all physical_media rows for a user.
-- Called by the "Recompute all" button in the Genre Tools Discogs tab.
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_all_discogs_super_genres(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.physical_media
  SET super_genre = public.compute_discogs_super_genre(
    COALESCE(genres, '{}'),
    COALESCE(styles, '{}'),
    p_user_id
  )
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_all_discogs_super_genres(UUID)
  TO authenticated, service_role;


-- ============================================================
-- Trigger: auto-populate physical_media.super_genre on insert/update
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_physical_media_super_genre()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.super_genre := public.compute_discogs_super_genre(
    COALESCE(NEW.genres, '{}'),
    COALESCE(NEW.styles, '{}'),
    NEW.user_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_physical_media_super_genre
  BEFORE INSERT OR UPDATE OF genres, styles
  ON public.physical_media
  FOR EACH ROW
  EXECUTE FUNCTION public.set_physical_media_super_genre();
