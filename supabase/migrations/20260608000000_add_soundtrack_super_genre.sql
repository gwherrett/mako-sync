-- Add 'Soundtrack' super genre

-- Step 0: Drop views that depend on super_genre columns
DROP VIEW IF EXISTS v_effective_spotify_genre_map;
DROP VIEW IF EXISTS public.v_effective_discogs_term_map;

-- Step 1: Recreate the enum with 'Soundtrack' added
ALTER TYPE super_genre RENAME TO super_genre_old;

CREATE TYPE super_genre AS ENUM (
  'Bass', 'Blues', 'Books & Spoken', 'Country', 'Dance', 'Disco',
  'Drum & Bass', 'Electronic', 'Folk', 'Hip Hop', 'House',
  'Indie-Alternative', 'Jazz', 'Latin', 'Metal', 'Orchestral',
  'Other', 'Pop', 'Reggae-Dancehall', 'Rock', 'Seasonal',
  'Soul-Funk', 'Soundtrack', 'Urban', 'World'
);

-- Step 2: Migrate enum columns to the new type
ALTER TABLE public.spotify_genre_map_base
  ALTER COLUMN super_genre TYPE super_genre USING super_genre::text::super_genre;

ALTER TABLE public.spotify_liked
  ALTER COLUMN super_genre TYPE super_genre USING super_genre::text::super_genre;

ALTER TABLE public.spotify_genre_map_overrides
  ALTER COLUMN super_genre DROP NOT NULL;
ALTER TABLE public.spotify_genre_map_overrides
  ALTER COLUMN super_genre TYPE super_genre USING super_genre::text::super_genre;
ALTER TABLE public.spotify_genre_map_overrides
  ALTER COLUMN super_genre SET NOT NULL;

ALTER TABLE public.discogs_term_map_base
  ALTER COLUMN super_genre TYPE super_genre USING super_genre::text::super_genre;

ALTER TABLE public.discogs_genre_map_overrides
  ALTER COLUMN super_genre DROP NOT NULL;
ALTER TABLE public.discogs_genre_map_overrides
  ALTER COLUMN super_genre TYPE super_genre USING super_genre::text::super_genre;
ALTER TABLE public.discogs_genre_map_overrides
  ALTER COLUMN super_genre SET NOT NULL;

-- Step 3: Clean up old type
DROP TYPE super_genre_old;

-- Step 4: Recreate the view (matches definition in 20251117042332_*.sql)
CREATE OR REPLACE VIEW v_effective_spotify_genre_map
WITH (security_invoker = true)
AS
SELECT
  COALESCE(o.spotify_genre, b.spotify_genre) AS spotify_genre,
  COALESCE(o.super_genre, b.super_genre) AS super_genre,
  CASE
    WHEN o.spotify_genre IS NOT NULL THEN true
    ELSE false
  END AS is_overridden
FROM spotify_genre_map_base b
FULL JOIN spotify_genre_map_overrides o ON b.spotify_genre = o.spotify_genre;

-- Step 5: Recreate the discogs view (matches definition in 20260428000000_*.sql)
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
