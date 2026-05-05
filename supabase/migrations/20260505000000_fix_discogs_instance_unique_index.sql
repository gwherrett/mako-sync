-- Replace the partial unique index on (user_id, discogs_instance_id) with a
-- full unique index. The partial index (WHERE discogs_instance_id IS NOT NULL)
-- cannot be used as an ON CONFLICT target in PostgREST upserts — PostgreSQL
-- requires the WHERE clause to be included in the conflict specification, which
-- PostgREST does not support.
--
-- A full unique index is safe here: PostgreSQL treats NULLs as distinct in
-- unique index evaluation, so multiple rows with discogs_instance_id IS NULL
-- (manually-added records) are still permitted.

DROP INDEX IF EXISTS uq_physical_media_user_discogs_instance;

CREATE UNIQUE INDEX uq_physical_media_user_discogs_instance
  ON public.physical_media (user_id, discogs_instance_id);
