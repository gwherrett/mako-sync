-- Backfill physical_media.super_genre for all existing records.
-- Runs after schema (20260428000000) and seed data (20260428000001) are applied.
-- New records are handled automatically by trg_physical_media_super_genre.

UPDATE public.physical_media
SET super_genre = public.compute_discogs_super_genre(
  COALESCE(genres, '{}'),
  COALESCE(styles, '{}'),
  user_id
)
WHERE super_genre IS NULL;
