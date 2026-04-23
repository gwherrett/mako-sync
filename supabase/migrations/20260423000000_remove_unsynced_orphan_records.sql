-- Remove half-state physical_media rows where discogs_instance_id is null.
-- Under the pull-only model all records must originate from a Discogs pull sync,
-- so any row without a confirmed instance_id is unreachable and should be cleared.
-- Run a Discogs sync after deploying to repopulate correctly.
DELETE FROM public.physical_media
WHERE discogs_instance_id IS NULL;
