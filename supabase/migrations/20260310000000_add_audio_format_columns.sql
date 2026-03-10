-- Add audio format quality columns to local_mp3s
-- Persists sample rate, duration, and audio format metadata for FLAC, M4A, and MP3 files.

ALTER TABLE public.local_mp3s
  ADD COLUMN IF NOT EXISTS sample_rate INTEGER NULL,
  ADD COLUMN IF NOT EXISTS duration_seconds FLOAT NULL,
  ADD COLUMN IF NOT EXISTS audio_format TEXT NULL; -- 'mp3', 'flac', 'm4a'
