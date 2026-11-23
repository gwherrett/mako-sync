-- Widen the Discogs id columns on physical_media from INTEGER to BIGINT.
--
-- 20260422000000 declared discogs_instance_id as BIGINT, but the column already
-- existed in production as INTEGER, so ADD COLUMN IF NOT EXISTS left it alone.
-- Discogs collection instance ids have passed the INTEGER limit (2,147,483,647),
-- so linking or inserting newer copies failed with
-- "value out of range for type integer".
--
-- Release and master ids are far below the limit today; widen them too so the
-- same failure can't happen later. JavaScript numbers hold these values exactly.

ALTER TABLE public.physical_media
  ALTER COLUMN discogs_instance_id TYPE BIGINT,
  ALTER COLUMN discogs_release_id  TYPE BIGINT,
  ALTER COLUMN discogs_master_id   TYPE BIGINT;
