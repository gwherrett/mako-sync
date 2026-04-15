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
    service: 'discogs-search-edge-function',
    message,
    ...context,
  }))
}

// ─── OAuth 1.0a helpers (same as discogs-auth) ─────────────────────────────

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

// ─── Fetch plaintext tokens from Vault ────────────────────────────────────

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

    const dbUrl = Deno.env.get('SUPABASE_DB_URL')
    if (!dbUrl) {
      return new Response(
        JSON.stringify({ error: 'Database connection not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Fetch user's Discogs connection + vault IDs
    const { data: connection, error: connError } = await supabaseClient
      .from('discogs_connections')
      .select('access_token_secret_id, access_secret_secret_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (connError || !connection) {
      return new Response(
        JSON.stringify({ error: 'Discogs not connected', code: 'NOT_CONNECTED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const pool = new Pool(dbUrl, 1)
    let accessToken: string
    let accessTokenSecret: string
    try {
      const tokens = await getTokensFromVault(pool, connection.access_token_secret_id, connection.access_secret_secret_id)
      accessToken = tokens.accessToken
      accessTokenSecret = tokens.accessTokenSecret
    } finally {
      await pool.end()
    }

    const body = await req.json()
    const { action } = body
    log('info', `discogs-search called`, { action, userId: user.id })

    // ── MODE A: search ────────────────────────────────────────────────────
    if (action === 'search') {
      const { artist, title } = body
      if (!artist && !title) {
        return new Response(
          JSON.stringify({ error: 'artist or title is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const q = [artist, title].filter(Boolean).join(' ')
      const searchUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&per_page=20`
      const authHeader = await buildOAuthHeader('GET', 'https://api.discogs.com/database/search', consumerKey, consumerSecret, accessToken, accessTokenSecret)

      const resp = await fetch(searchUrl, {
        headers: { Authorization: authHeader, 'User-Agent': 'MakoSync/1.0' },
      })

      if (!resp.ok) {
        const errText = await resp.text()
        log('error', 'Discogs search failed', { status: resp.status, body: errText })
        return new Response(
          JSON.stringify({ error: 'Discogs search failed', details: errText }),
          { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const data = await resp.json()

      // Map to simplified shape
      const results = (data.results || []).map((r: Record<string, unknown>) => ({
        id: r.id,
        master_id: r.master_id ?? null,
        title: r.title,
        year: r.year ?? null,
        label: r.label ?? null,
        country: r.country ?? null,
        format: r.format ?? null,
        catno: r.catno ?? null,
        thumb: r.thumb ?? null,
        cover_image: r.cover_image ?? null,
        resource_url: r.resource_url,
      }))

      return new Response(
        JSON.stringify({ results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── MODE B: release ───────────────────────────────────────────────────
    if (action === 'release') {
      const { release_id } = body
      if (!release_id) {
        return new Response(
          JSON.stringify({ error: 'release_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const releaseUrl = `https://api.discogs.com/releases/${release_id}`
      const authHeader = await buildOAuthHeader('GET', releaseUrl, consumerKey, consumerSecret, accessToken, accessTokenSecret)

      const resp = await fetch(releaseUrl, {
        headers: { Authorization: authHeader, 'User-Agent': 'MakoSync/1.0' },
      })

      if (!resp.ok) {
        const errText = await resp.text()
        log('error', 'Discogs release fetch failed', { status: resp.status, releaseId: release_id })
        return new Response(
          JSON.stringify({ error: 'Discogs release fetch failed', details: errText }),
          { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const release = await resp.json()
      return new Response(
        JSON.stringify({ release }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log('error', 'Unexpected error in discogs-search', { error: msg })
    return new Response(
      JSON.stringify({ error: 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
