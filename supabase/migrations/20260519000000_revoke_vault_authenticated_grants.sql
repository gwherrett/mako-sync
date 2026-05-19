-- Revoke direct authenticated-role access to vault accessor functions.
--
-- These functions are SECURITY DEFINER and accept only a secret UUID — they have
-- no ownership check inside. Any authenticated user could call them via RPC with
-- an arbitrary UUID and retrieve any vault secret.
--
-- Vault access is exclusively via Edge Functions (service_role). There is no
-- legitimate reason for an authenticated user to call these functions directly.

REVOKE EXECUTE ON FUNCTION public.get_spotify_token_from_vault(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.store_spotify_token_in_vault(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_spotify_token_in_vault(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.migrate_connection_to_vault(uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.get_discogs_token_from_vault(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.store_discogs_token_in_vault(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_discogs_token_from_vault(uuid) FROM authenticated;
