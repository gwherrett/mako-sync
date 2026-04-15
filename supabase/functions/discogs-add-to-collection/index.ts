// deploy
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0"
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const log = (level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    service: 'discogs-add-to-collection',
    message,
    ...context,
  }))
}

// ─── OAuth 1.0a helpers ────────────────────────────────────────────────────

function pct(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A')
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function buildOAuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string,
): Promise<string> {
  const params: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  }

  const normalisedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${pct(k)}=${pct(v)}`)
    .join('&')

  const baseString = `${method.toUpperCase()}&${pct(url)}&${pct(normalisedParams)}`
  const signingKey = `${pct(consumerSecret)}&${pct(accessTokenSecret)}`
  params.oauth_signature = await hmacSha1(signingKey, baseString)

  const header = Object.entries(params)
    .map(([k, v]) => `${k}="${pct(v)}"`)
    .join(', ')
  return `OAuth ${header}`
}

// ─── Vault token decryption ────────────────────────────────────────────────

async function getTokensFromVault(
  pool: Pool,
  accessTokenSecretId: string,
  accessSecretSecretId: string,
): Promise<{ accessToken: string; accessTokenSecret: string }> {
  const conn = await pool.connect()
  try {
    const tokenResult = await conn.queryObject<{ decrypted_secret: string }>`
      SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = ${accessTokenSecretId}
    `
    const secretResult = await conn.queryObject<{ decrypted_secret: string }>`
      SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = ${accessSecretSecretId}
    `
    const accessToken = tokenResult.rows[0]?.decrypted_secret
    const accessTokenSecret = secretResult.rows[0]?.decrypted_secret
    if (!accessToken || !accessTokenSecret) {
      throw new Error('Could not decrypt Discogs tokens from Vault')
    }
    return { accessToken, accessTokenSecret }
  } finally {
    conn.release()
  }
}

// ─── Main handler ──────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const pool = new Pool(Deno.env.get('SUPABASE_DB_URL') ?? '', 1)

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const consumerKey = Deno.env.get('DISCOGS_CONSUMER_KEY')
    const consumerSecret = Deno.env.get('DISCOGS_CONSUMER_SECRET')
    if (!consumerKey || !consumerSecret) {
      return new Response(
        JSON.stringify({ error: 'Discogs credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!Deno.env.get('SUPABASE_DB_URL')) {
      return new Response(
        JSON.stringify({ error: 'Database connection not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Parse and validate input
    const body = await req.json()
    const { physicalMediaId } = body
    if (!physicalMediaId || typeof physicalMediaId !== 'string') {
      return new Response(
        JSON.stringify({ error: 'physicalMediaId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    log('info', 'discogs-add-to-collection called', { physicalMediaId, userId: user.id })

    // Fetch the physical media record (RLS ensures user owns it)
    const { data: record, error: recordError } = await supabaseClient
      .from('physical_media')
      .select('discogs_release_id, discogs_instance_id, rating')
      .eq('id', physicalMediaId)
      .maybeSingle()

    if (recordError || !record) {
      return new Response(
        JSON.stringify({ error: 'Record not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (record.discogs_instance_id !== null) {
      return new Response(
        JSON.stringify({ error: 'Already synced', code: 'ALREADY_SYNCED' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!record.discogs_release_id) {
      return new Response(
        JSON.stringify({ error: 'No Discogs release linked to this record' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Fetch Discogs connection
    const { data: connection, error: connError } = await supabaseClient
      .from('discogs_connections')
      .select('discogs_username, access_token_secret_id, access_secret_secret_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (connError || !connection) {
      return new Response(
        JSON.stringify({ error: 'Discogs not connected', code: 'NOT_CONNECTED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Decrypt tokens from Vault
    const { accessToken, accessTokenSecret } = await getTokensFromVault(
      pool,
      connection.access_token_secret_id,
      connection.access_secret_secret_id,
    )

    // Build Discogs API URL
    const discogsUrl = `https://api.discogs.com/users/${connection.discogs_username}/collection/folders/1/releases/${record.discogs_release_id}`
    const authHeader = await buildOAuthHeader('POST', discogsUrl, consumerKey, consumerSecret, accessToken, accessTokenSecret)

    // POST to Discogs
    const discogsResp = await fetch(discogsUrl, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        'User-Agent': 'MakoSync/1.0',
      },
      body: JSON.stringify({ rating: record.rating ?? 0 }),
    })

    if (discogsResp.status === 404) {
      return new Response(
        JSON.stringify({ error: 'Release not found on Discogs', code: 'RELEASE_NOT_FOUND' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (discogsResp.status === 401 || discogsResp.status === 403) {
      return new Response(
        JSON.stringify({ error: 'Discogs authentication failed', code: 'DISCOGS_AUTH_FAILED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (discogsResp.status === 429) {
      const errBody = await discogsResp.text()
      return new Response(errBody, {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (discogsResp.status !== 201) {
      const errText = await discogsResp.text()
      log('error', 'Discogs add-to-collection failed', { status: discogsResp.status, body: errText })
      return new Response(
        JSON.stringify({ error: 'Discogs request failed', details: errText }),
        { status: discogsResp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { instance_id, resource_url } = await discogsResp.json()
    const syncedAt = new Date().toISOString()

    // Update physical_media with instance_id and sync timestamp
    const { error: updateError } = await supabaseClient
      .from('physical_media')
      .update({ discogs_instance_id: instance_id, discogs_synced_at: syncedAt })
      .eq('id', physicalMediaId)

    if (updateError) {
      log('error', 'Failed to update physical_media after Discogs sync', { error: updateError.message })
      return new Response(
        JSON.stringify({ error: 'Synced to Discogs but failed to save state', code: 'UPDATE_FAILED' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    log('info', 'Successfully added to Discogs collection', { physicalMediaId, instance_id })
    return new Response(
      JSON.stringify({ instance_id, resource_url, synced_at: syncedAt }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log('error', 'Unexpected error in discogs-add-to-collection', { error: msg })
    return new Response(
      JSON.stringify({ error: 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } finally {
    await pool.end()
  }
})
