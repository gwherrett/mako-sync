import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const log = (level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    service: 'discogs-auth-edge-function',
    message,
    ...context,
  }))
}

// ─── OAuth 1.0a helpers ────────────────────────────────────────────────────

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
function pct(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A')
}

/** HMAC-SHA1 via Deno's Web Crypto API — returns base64 digest. */
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

/**
 * Build an OAuth 1.0a Authorization header with HMAC-SHA1 signature.
 *
 * @param method          HTTP method (GET / POST)
 * @param url             Request URL (no query string)
 * @param consumerKey     Discogs consumer key
 * @param consumerSecret  Discogs consumer secret
 * @param oauthToken      Temporary / access token (null for request_token step)
 * @param oauthTokenSecret Token secret matching oauthToken (empty string when absent)
 * @param extraParams     Additional OAuth params to include in signature (e.g. oauth_verifier)
 */
async function buildOAuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  oauthToken: string | null,
  oauthTokenSecret: string,
  extraParams: Record<string, string> = {},
): Promise<string> {
  const params: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
    ...extraParams,
  }
  if (oauthToken) params.oauth_token = oauthToken

  // Normalised parameter string: sorted, percent-encoded key=value pairs
  const normalisedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${pct(k)}=${pct(v)}`)
    .join('&')

  // Signature base string
  const baseString = `${method.toUpperCase()}&${pct(url)}&${pct(normalisedParams)}`

  // Signing key: consumerSecret&tokenSecret (tokenSecret may be empty on first step)
  const signingKey = `${pct(consumerSecret)}&${pct(oauthTokenSecret)}`
  params.oauth_signature = await hmacSha1(signingKey, baseString)

  const header = Object.entries(params)
    .map(([k, v]) => `${k}="${pct(v)}"`)
    .join(', ')
  return `OAuth ${header}`
}

/** Parse a URL-encoded response body into a plain object. */
function parseUrlEncoded(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body))
}

// ─── Main handler ──────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth: every action requires a valid Supabase session ──────────────
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Credentials ───────────────────────────────────────────────────────
    const consumerKey = Deno.env.get('DISCOGS_CONSUMER_KEY')
    const consumerSecret = Deno.env.get('DISCOGS_CONSUMER_SECRET')
    if (!consumerKey || !consumerSecret) {
      log('error', 'Discogs credentials not configured')
      return new Response(
        JSON.stringify({ error: 'Discogs credentials not configured', code: 'MISSING_DISCOGS_CREDENTIALS' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const body = await req.json()
    const { action } = body
    log('info', `discogs-auth called`, { action, userId: user.id })

    // ── ACTION: request_token ─────────────────────────────────────────────
    //   Step 1 of OAuth 1.0a: obtain a temporary request token from Discogs.
    //   The client will store oauth_token_secret in sessionStorage, then
    //   redirect the user to the Discogs authorise URL.
    if (action === 'request_token') {
      const callbackUrl = body.callback_url
      if (!callbackUrl) {
        return new Response(
          JSON.stringify({ error: 'callback_url is required', code: 'MISSING_CALLBACK_URL' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const REQUEST_TOKEN_URL = 'https://api.discogs.com/oauth/request_token'
      const authHeader = await buildOAuthHeader(
        'GET',
        REQUEST_TOKEN_URL,
        consumerKey,
        consumerSecret,
        null,
        '',
        { oauth_callback: callbackUrl },
      )

      const response = await fetch(REQUEST_TOKEN_URL, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'MakoSync/1.0',
        },
      })

      const responseText = await response.text()
      if (!response.ok) {
        log('error', 'Discogs request_token failed', { status: response.status, body: responseText })
        return new Response(
          JSON.stringify({ error: 'Failed to get Discogs request token', details: responseText }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const parsed = parseUrlEncoded(responseText)
      log('info', 'Request token obtained', { userId: user.id })

      return new Response(
        JSON.stringify({
          oauth_token: parsed.oauth_token,
          oauth_token_secret: parsed.oauth_token_secret,
          authorize_url: `https://www.discogs.com/oauth/authorize?oauth_token=${parsed.oauth_token}`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── ACTION: access_token ──────────────────────────────────────────────
    //   Step 3 of OAuth 1.0a: exchange verifier for permanent access tokens,
    //   store them in Vault, upsert discogs_connections.
    if (action === 'access_token') {
      const { oauth_token, oauth_verifier, oauth_token_secret } = body
      if (!oauth_token || !oauth_verifier || !oauth_token_secret) {
        return new Response(
          JSON.stringify({ error: 'oauth_token, oauth_verifier and oauth_token_secret are required', code: 'MISSING_OAUTH_PARAMS' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      // Exchange for permanent access token
      const ACCESS_TOKEN_URL = 'https://api.discogs.com/oauth/access_token'
      const authHeader = await buildOAuthHeader(
        'POST',
        ACCESS_TOKEN_URL,
        consumerKey,
        consumerSecret,
        oauth_token,
        oauth_token_secret,
        { oauth_verifier },
      )

      const tokenResponse = await fetch(ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'MakoSync/1.0',
        },
      })

      const tokenText = await tokenResponse.text()
      if (!tokenResponse.ok) {
        log('error', 'Discogs access_token exchange failed', { status: tokenResponse.status, body: tokenText })
        return new Response(
          JSON.stringify({ error: 'Failed to exchange Discogs access token', details: tokenText }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const tokens = parseUrlEncoded(tokenText)
      const accessToken = tokens.oauth_token
      const accessTokenSecret = tokens.oauth_token_secret

      // Fetch Discogs identity (username)
      const IDENTITY_URL = 'https://api.discogs.com/oauth/identity'
      const identityAuthHeader = await buildOAuthHeader(
        'GET',
        IDENTITY_URL,
        consumerKey,
        consumerSecret,
        accessToken,
        accessTokenSecret,
      )

      const identityResponse = await fetch(IDENTITY_URL, {
        headers: {
          Authorization: identityAuthHeader,
          'User-Agent': 'MakoSync/1.0',
        },
      })

      const identityData = await identityResponse.json()
      if (!identityResponse.ok) {
        log('error', 'Failed to fetch Discogs identity', { status: identityResponse.status })
        return new Response(
          JSON.stringify({ error: 'Failed to fetch Discogs identity', code: 'IDENTITY_FETCH_FAILED' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const discogsUsername = identityData.username as string
      log('info', 'Discogs identity fetched', { userId: user.id, discogsUsername })

      // ── Vault storage (mirrors spotify-auth pattern exactly) ─────────────
      const dbUrl = Deno.env.get('SUPABASE_DB_URL')
      if (!dbUrl) {
        log('error', 'SUPABASE_DB_URL not configured')
        return new Response(
          JSON.stringify({ error: 'Database connection not configured', code: 'MISSING_DATABASE_URL' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const pool = new Pool(dbUrl, 1)
      let accessTokenSecretId: string
      let accessSecretSecretId: string
      let oldAccessTokenSecretId: string | null = null
      let oldAccessSecretSecretId: string | null = null

      try {
        const connection = await pool.connect()
        try {
          // Capture old secret IDs for cleanup after upsert
          const existing = await connection.queryObject<{
            access_token_secret_id: string | null
            access_secret_secret_id: string | null
          }>`
            SELECT access_token_secret_id, access_secret_secret_id
            FROM discogs_connections
            WHERE user_id = ${user.id}
          `
          oldAccessTokenSecretId = existing.rows[0]?.access_token_secret_id ?? null
          oldAccessSecretSecretId = existing.rows[0]?.access_secret_secret_id ?? null

          // Store new tokens in Vault
          const ts = Date.now()

          const accessTokenResult = await connection.queryObject<{ id: string }>`
            SELECT vault.create_secret(
              ${accessToken},
              ${'discogs_access_token_' + user.id + '_' + ts},
              ${'Discogs access_token for user ' + user.id}
            ) as id
          `
          if (!accessTokenResult.rows[0]?.id) throw new Error('Failed to create Discogs access token secret')
          accessTokenSecretId = accessTokenResult.rows[0].id

          const accessSecretResult = await connection.queryObject<{ id: string }>`
            SELECT vault.create_secret(
              ${accessTokenSecret},
              ${'discogs_access_secret_' + user.id + '_' + ts},
              ${'Discogs access_token_secret for user ' + user.id}
            ) as id
          `
          if (!accessSecretResult.rows[0]?.id) throw new Error('Failed to create Discogs access token secret key')
          accessSecretSecretId = accessSecretResult.rows[0].id

          log('info', 'Tokens stored in Vault', { userId: user.id })
        } finally {
          connection.release()
        }
      } catch (vaultError: unknown) {
        const msg = vaultError instanceof Error ? vaultError.message : String(vaultError)
        log('error', 'Vault storage failed', { userId: user.id, error: msg })
        await pool.end()
        return new Response(
          JSON.stringify({ error: 'Failed to securely store tokens', code: 'VAULT_STORAGE_FAILED', debug: msg }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      // Upsert discogs_connections (vault IDs only — no plaintext tokens)
      const { error: dbError } = await supabaseClient
        .from('discogs_connections')
        .upsert(
          {
            user_id: user.id,
            discogs_username: discogsUsername,
            access_token_secret_id: accessTokenSecretId,
            access_secret_secret_id: accessSecretSecretId,
          },
          { onConflict: 'user_id' },
        )

      if (dbError) {
        log('error', 'DB upsert failed', { userId: user.id, error: dbError.message })
        await pool.end()
        return new Response(
          JSON.stringify({ error: `Database error: ${dbError.message}`, code: 'DATABASE_STORAGE_FAILED' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      // Clean up old Vault secrets (best-effort — non-fatal if it fails)
      if (oldAccessTokenSecretId || oldAccessSecretSecretId) {
        try {
          const cleanupConn = await pool.connect()
          try {
            if (oldAccessTokenSecretId) {
              await cleanupConn.queryObject`DELETE FROM vault.secrets WHERE id = ${oldAccessTokenSecretId}`
            }
            if (oldAccessSecretSecretId) {
              await cleanupConn.queryObject`DELETE FROM vault.secrets WHERE id = ${oldAccessSecretSecretId}`
            }
            log('info', 'Old Vault secrets cleaned up', { userId: user.id })
          } finally {
            cleanupConn.release()
          }
        } catch (cleanupErr: unknown) {
          log('warn', 'Non-fatal: failed to clean up old Vault secrets', {
            userId: user.id,
            error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          })
        }
      }

      await pool.end()

      return new Response(
        JSON.stringify({ success: true, discogs_username: discogsUsername }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── ACTION: disconnect ────────────────────────────────────────────────
    //   Delete discogs_connections row and clean up Vault secrets.
    if (action === 'disconnect') {
      const dbUrl = Deno.env.get('SUPABASE_DB_URL')
      if (!dbUrl) {
        return new Response(
          JSON.stringify({ error: 'Database connection not configured', code: 'MISSING_DATABASE_URL' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      // Fetch secret IDs before deleting the row
      const { data: existing } = await supabaseClient
        .from('discogs_connections')
        .select('access_token_secret_id, access_secret_secret_id')
        .eq('user_id', user.id)
        .maybeSingle()

      // Delete the connection row
      await supabaseClient
        .from('discogs_connections')
        .delete()
        .eq('user_id', user.id)

      // Clean up Vault secrets
      if (existing?.access_token_secret_id || existing?.access_secret_secret_id) {
        try {
          const pool = new Pool(dbUrl, 1)
          const conn = await pool.connect()
          try {
            if (existing.access_token_secret_id) {
              await conn.queryObject`DELETE FROM vault.secrets WHERE id = ${existing.access_token_secret_id}`
            }
            if (existing.access_secret_secret_id) {
              await conn.queryObject`DELETE FROM vault.secrets WHERE id = ${existing.access_secret_secret_id}`
            }
          } finally {
            conn.release()
          }
          await pool.end()
          log('info', 'Disconnected — Vault secrets deleted', { userId: user.id })
        } catch (e: unknown) {
          log('warn', 'Non-fatal: failed to delete Vault secrets on disconnect', {
            userId: user.id,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}`, code: 'UNKNOWN_ACTION' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log('error', 'Unexpected error in discogs-auth', { error: msg })
    return new Response(
      JSON.stringify({ error: 'Server error', code: 'UNEXPECTED_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
