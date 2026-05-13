-- Remove 'UK Garage' super genre — merged into 'Bass'

-- Step 1: Migrate all data before touching the enum
UPDATE public.spotify_genre_map_base    SET super_genre = 'Bass' WHERE super_genre = 'UK Garage';
UPDATE public.spotify_liked             SET super_genre = 'Bass' WHERE super_genre = 'UK Garage';
UPDATE public.spotify_genre_map_overrides SET super_genre = 'Bass' WHERE super_genre = 'UK Garage';
UPDATE public.discogs_term_map_base     SET super_genre = 'Bass' WHERE super_genre = 'UK Garage';
UPDATE public.discogs_genre_map_overrides SET super_genre = 'Bass' WHERE super_genre = 'UK Garage';
-- TEXT columns — no cast needed
UPDATE public.local_mp3s               SET super_genre = 'Bass' WHERE super_genre = 'UK Garage';
UPDATE public.physical_media           SET super_genre = 'Bass' WHERE super_genre = 'UK Garage';

-- Step 2: Recreate the enum without 'UK Garage'
ALTER TYPE super_genre RENAME TO super_genre_old;

CREATE TYPE super_genre AS ENUM (
  'Bass', 'Blues', 'Books & Spoken', 'Country', 'Dance', 'Disco',
  'Drum & Bass', 'Electronic', 'Folk', 'Hip Hop', 'House',
  'Indie-Alternative', 'Jazz', 'Latin', 'Metal', 'Orchestral',
  'Other', 'Pop', 'Reggae-Dancehall', 'Rock', 'Seasonal',
  'Soul-Funk', 'Urban', 'World'
);

-- Step 3: Migrate enum columns to the new type
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

-- Step 4: Clean up old type
DROP TYPE super_genre_old;
