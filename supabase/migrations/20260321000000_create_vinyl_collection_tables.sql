-- Vinyl Collection: physical_media and discogs_connections tables
-- physical_media stores the user's vinyl records; discogs_connections stores
-- Discogs OAuth tokens via Supabase Vault (mirrors spotify_connections pattern).

-- ============================================================
-- physical_media
-- ============================================================
CREATE TABLE IF NOT EXISTS public.physical_media (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Discogs identifiers (nullable — records can be saved without Discogs confirmation)
  discogs_release_id  INTEGER     NULL,
  discogs_master_id   INTEGER     NULL,

  -- Core release info
  artist              TEXT        NOT NULL,
  title               TEXT        NOT NULL,
  label               TEXT        NULL,
  catalogue_number    TEXT        NULL,
  year                INTEGER     NULL,

  -- Pressing details (used to pin down the exact Discogs release)
  country             TEXT        NULL,
  pressing            TEXT        NULL,  -- 'original' | 'reissue' | 'remaster'
  format              TEXT        NULL,  -- 'LP' | '12"' | '7"' | '10"' | 'EP' | 'Single' | 'Other'
  format_details      TEXT        NULL,  -- colour vinyl, ltd edition, etc.
  condition           TEXT        NULL,  -- M | NM | VG+ | VG | G+ | G | F | P

  -- Media
  cover_image_url     TEXT        NULL,

  -- Tracklist from Discogs: [{position, title, duration}]
  tracklist           JSONB       NULL,

  -- Genre/style tags from Discogs
  genres              TEXT[]      NULL,
  styles              TEXT[]      NULL,

  -- Free-text notes
  notes               TEXT        NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast per-user queries
CREATE INDEX IF NOT EXISTS idx_physical_media_user_id
  ON public.physical_media (user_id);

-- Index for Discogs release lookups
CREATE INDEX IF NOT EXISTS idx_physical_media_discogs_release_id
  ON public.physical_media (discogs_release_id)
  WHERE discogs_release_id IS NOT NULL;

-- RLS
ALTER TABLE public.physical_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own physical media"
  ON public.physical_media FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own physical media"
  ON public.physical_media FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own physical media"
  ON public.physical_media FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own physical media"
  ON public.physical_media FOR DELETE
  USING (auth.uid() = user_id);

-- updated_at trigger (reuses existing function from earlier migrations)
CREATE TRIGGER update_physical_media_updated_at
  BEFORE UPDATE ON public.physical_media
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();


-- ============================================================
-- discogs_connections
-- Mirrors spotify_connections: tokens stored in Vault only,
-- only Vault secret IDs are persisted here.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.discogs_connections (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  discogs_username          TEXT        NULL,

  -- Vault secret IDs — never plaintext tokens
  access_token_secret_id    UUID        NULL,  -- references vault.secrets
  access_secret_secret_id   UUID        NULL,  -- references vault.secrets (OAuth token secret)

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT discogs_connections_user_id_key UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_discogs_connections_user_id
  ON public.discogs_connections (user_id);

-- RLS
ALTER TABLE public.discogs_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own Discogs connection"
  ON public.discogs_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own Discogs connection"
  ON public.discogs_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own Discogs connection"
  ON public.discogs_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own Discogs connection"
  ON public.discogs_connections FOR DELETE
  USING (auth.uid() = user_id);

-- updated_at trigger
CREATE TRIGGER update_discogs_connections_updated_at
  BEFORE UPDATE ON public.discogs_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();


-- ============================================================
-- Vault helper functions for Discogs tokens
-- Mirrors store/get/update functions used for Spotify tokens.
-- ============================================================

CREATE OR REPLACE FUNCTION public.store_discogs_token_in_vault(
  p_user_id    UUID,
  p_token_name TEXT,
  p_token_value TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  INSERT INTO vault.secrets (secret, description)
  VALUES (
    p_token_value,
    format('Discogs %s for user %s', p_token_name, p_user_id)
  )
  RETURNING id INTO v_secret_id;

  RETURN v_secret_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.store_discogs_token_in_vault(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_discogs_token_in_vault(UUID, TEXT, TEXT) TO service_role;


CREATE OR REPLACE FUNCTION public.get_discogs_token_from_vault(p_secret_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_token TEXT;
BEGIN
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE id = p_secret_id;

  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_discogs_token_from_vault(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_discogs_token_from_vault(UUID) TO service_role;


CREATE OR REPLACE FUNCTION public.delete_discogs_token_from_vault(p_secret_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = p_secret_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_discogs_token_from_vault(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_discogs_token_from_vault(UUID) TO service_role;
