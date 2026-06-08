-- Add 'Soundtrack' super genre

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
