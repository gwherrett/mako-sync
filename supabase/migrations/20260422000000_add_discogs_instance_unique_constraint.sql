-- Ensure discogs_instance_id, discogs_synced_at, and rating columns exist on
-- physical_media. These were applied directly to production and are captured
-- here for migration-history completeness.
ALTER TABLE public.physical_media
  ADD COLUMN IF NOT EXISTS discogs_instance_id BIGINT  NULL,
  ADD COLUMN IF NOT EXISTS discogs_synced_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS rating              SMALLINT NULL;

-- Prevent duplicate Discogs collection entries for the same user.
-- The sync edge function uses this constraint as the conflict target for upsert,
-- so re-syncing a collection never creates a second row for the same instance.
CREATE UNIQUE INDEX IF NOT EXISTS uq_physical_media_user_discogs_instance
  ON public.physical_media (user_id, discogs_instance_id)
  WHERE discogs_instance_id IS NOT NULL;
