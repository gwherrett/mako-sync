-- MAK-152: full Spotify sync no longer deletes and re-inserts spotify_liked rows, so
-- row ids stay stable (track_matches.spotify_track_id cascades on delete).
--
-- Every sync upsert stamps the row with its sync_progress.sync_id. At the end of a full
-- sync, the user's rows not stamped by that sync are no longer liked on Spotify and are
-- deleted. The stamp is persisted, so this works across any number of resumed invocations
-- (the previous in-memory id set only held tracks fetched since the last resume).
--
-- No index: the end-of-sync queries filter on user_id first, which is already indexed by
-- the (user_id, spotify_id) unique constraint.

ALTER TABLE public.spotify_liked
  ADD COLUMN IF NOT EXISTS last_seen_sync_id uuid NULL;

COMMENT ON COLUMN public.spotify_liked.last_seen_sync_id IS
  'sync_progress.sync_id of the last sync that upserted this row. A full sync deletes the user''s rows not stamped with its own sync_id.';

-- A sync left in_progress by the old code must not be resumed by the new code: its rows were
-- inserted without a stamp, so the new end-of-sync deletion pass would remove them.
UPDATE public.sync_progress
  SET status = 'failed',
      error_message = 'Abandoned by MAK-152 migration: started before sync ids were stamped on spotify_liked'
  WHERE status = 'in_progress';
