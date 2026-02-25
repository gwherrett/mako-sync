-- Add super_genre column to local_mp3s
-- Stores the Grouping (TIT1) ID3 tag value set by MediaMonkey during file scanning.
-- Typed as text (not the super_genre enum) since values come raw from ID3 tags
-- and may not exactly match enum values.

ALTER TABLE public.local_mp3s
  ADD COLUMN IF NOT EXISTS super_genre text NULL;
