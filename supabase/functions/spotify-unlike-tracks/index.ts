import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SPOTIFY_BATCH_SIZE = 50

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { spotifyIds } = await req.json()

    if (!Array.isArray(spotifyIds) || spotifyIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'spotifyIds must be a non-empty array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Auth client for user identity (RLS)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // Admin client for vault access (service_role bypasses RLS on vault)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Load Spotify connection
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from('spotify_connections')
      .select('access_token_secret_id, expires_at, refresh_token_secret_id')
      .eq('user_id', user.id)
      .single()

    if (connectionError || !connection) {
      return new Response(
        JSON.stringify({ error: 'Spotify not connected' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!connection.access_token_secret_id) {
      return new Response(
        JSON.stringify({ error: 'No vault token reference - please reconnect Spotify', code: 'VAULT_SECRETS_INVALID', requires_reconnect: true }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Retrieve access token from vault
    const pool = new Pool(Deno.env.get('SUPABASE_DB_URL')!, 1)
    let accessToken: string

    try {
      const conn = await pool.connect()
      try {
        const result = await conn.queryObject<{ decrypted_secret: string }>`
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE id = ${connection.access_token_secret_id}
        `
        if (!result.rows[0]?.decrypted_secret) {
          throw new Error('Access token not found in vault - please reconnect Spotify')
        }
        accessToken = result.rows[0].decrypted_secret
      } finally {
        conn.release()
      }
    } finally {
      await pool.end()
    }

    // Batch DELETE calls to Spotify (max 50 per request)
    const errors: string[] = []
    let removed = 0

    for (let i = 0; i < spotifyIds.length; i += SPOTIFY_BATCH_SIZE) {
      const batch = spotifyIds.slice(i, i + SPOTIFY_BATCH_SIZE)
      try {
        const res = await fetch('https://api.spotify.com/v1/me/tracks', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids: batch }),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          errors.push(`Spotify API error (${res.status}): ${text}`)
        } else {
          removed += batch.length
        }
      } catch (err: unknown) {
        errors.push(`Spotify API request failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return new Response(
      JSON.stringify({ removed, errors }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: unknown) {
    console.error('spotify-unlike-tracks error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
