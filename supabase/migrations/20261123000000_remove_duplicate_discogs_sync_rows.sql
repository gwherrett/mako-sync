-- Remove duplicate physical_media rows created by the Discogs pull sync.
--
-- The sync stored the Discogs RELEASE id (item.id) as discogs_instance_id, and
-- its dedup check only looked at rows that had an instance id. Rows without one
-- were invisible to it, so each sync inserted a fresh copy of up to ~18 records
-- that were already in the collection. Every such copy has
-- discogs_instance_id = discogs_release_id and an older twin with no instance id.
--
-- Keep the older rows (original created_at, tracklists, prices) and delete the
-- copies. The fixed sync then links the older rows to their real instance ids
-- by release id. Apply this only after the fixed discogs-pull-sync is deployed.

-- 1. Delete copies that duplicate an existing row of the same release
DELETE FROM public.physical_media dup
WHERE dup.discogs_instance_id IS NOT NULL
  AND dup.discogs_instance_id = dup.discogs_release_id
  AND EXISTS (
    SELECT 1 FROM public.physical_media orig
    WHERE orig.user_id = dup.user_id
      AND orig.discogs_release_id = dup.discogs_release_id
      AND orig.discogs_instance_id IS NULL
  );

-- 2. Clear any remaining wrong instance ids (release id stored by mistake) so
--    the next sync links these rows to their real instance ids
UPDATE public.physical_media
SET discogs_instance_id = NULL,
    discogs_synced_at = NULL
WHERE discogs_instance_id = discogs_release_id;
