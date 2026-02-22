-- Export unmatched Spotify tracks for a super genre alongside candidate local matches.
-- Run in Supabase SQL Editor. Replace $USER_ID and $SUPER_GENRE with actual values.
--
-- Output: JSON with two arrays:
--   spotify_tracks: Spotify tracks with no exact normalized match in local_mp3s
--   candidate_local_matches: Local tracks by the same artist that might be the expected match
--
-- Usage:
--   1. Run this query in Supabase SQL Editor
--   2. Copy the JSON output
--   3. Run: npx ts-node scripts/format-eval-export.ts --input raw.json --output src/services/__tests__/fixtures/eval-cases.json

WITH unmatched_spotify AS (
  SELECT
    sl.id,
    sl.title,
    sl.artist,
    sl.primary_artist,
    sl.album,
    sl.genre,
    sl.super_genre
  FROM spotify_liked sl
  WHERE sl.user_id = '$USER_ID'
    AND sl.super_genre = '$SUPER_GENRE'
    AND NOT EXISTS (
      SELECT 1 FROM local_mp3s lm
      WHERE lm.user_id = sl.user_id
        AND lower(regexp_replace(coalesce(lm.title, ''), '[^\w\s]', '', 'g'))
          = lower(regexp_replace(coalesce(sl.title, ''), '[^\w\s]', '', 'g'))
        AND lower(regexp_replace(
              coalesce(lm.primary_artist, lm.artist, ''), '[^\w\s]', '', 'g'))
          = lower(regexp_replace(
              coalesce(sl.primary_artist, sl.artist, ''), '[^\w\s]', '', 'g'))
    )
),
candidate_locals AS (
  SELECT
    lm.id AS local_id,
    lm.title AS local_title,
    lm.artist AS local_artist,
    lm.primary_artist AS local_primary_artist,
    lm.album AS local_album,
    lm.genre AS local_genre,
    lm.file_path AS local_file_path,
    us.id AS spotify_id
  FROM local_mp3s lm
  INNER JOIN unmatched_spotify us ON
    lower(regexp_replace(
      coalesce(lm.primary_artist, lm.artist, ''), '[^\w\s]', '', 'g'))
    = lower(regexp_replace(
      coalesce(us.primary_artist, us.artist, ''), '[^\w\s]', '', 'g'))
  WHERE lm.user_id = '$USER_ID'
)
SELECT json_build_object(
  'exportedAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'superGenre', '$SUPER_GENRE',
  'spotify_tracks', (
    SELECT coalesce(json_agg(json_build_object(
      'id', us.id,
      'title', us.title,
      'artist', us.artist,
      'primary_artist', us.primary_artist,
      'album', us.album,
      'genre', us.genre,
      'super_genre', us.super_genre
    )), '[]'::json)
    FROM unmatched_spotify us
  ),
  'candidate_local_matches', (
    SELECT coalesce(json_agg(json_build_object(
      'spotify_id', cl.spotify_id,
      'local_id', cl.local_id,
      'local_title', cl.local_title,
      'local_artist', cl.local_artist,
      'local_primary_artist', cl.local_primary_artist,
      'local_album', cl.local_album,
      'local_genre', cl.local_genre,
      'local_file_path', cl.local_file_path
    )), '[]'::json)
    FROM candidate_locals cl
  )
) AS export_data;
