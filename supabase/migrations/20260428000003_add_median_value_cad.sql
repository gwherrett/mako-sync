-- Add Discogs Marketplace median value (CAD) to physical_media
-- Populated during Discogs sync from marketplace/stats API; null until first sync after this migration.
ALTER TABLE public.physical_media
  ADD COLUMN IF NOT EXISTS median_value_cad NUMERIC(10, 2) DEFAULT NULL;
