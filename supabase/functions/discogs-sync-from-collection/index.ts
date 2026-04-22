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
    service: 'discogs-sync-from-collection',
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
  queryParams: Record<string, string> = {},
): Promise<string> {
  const params: Record<string, string> = {
    ...queryParams,
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
    .filter(([k]) => k.startsWith('oauth_'))
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

// ─── Format mapping ────────────────────────────────────────────────────────

function mapDiscogsFormat(name?: string): string | null {
  if (!name) return null
  const n = name.toLowerCase()
  if (n.includes('7"') || n === '7-inch') return '7"'
  if (n.includes('10"') || n === '10-inch') return '10"'
  if (n.includes('12"') || n === '12-inch') return '12"'
  if (n === 'ep') return 'EP'
  if (n === 'single') return 'Single'
  if (n === 'vinyl') return 'LP'
  return 'Other'
}

// ─── Discogs collection item types ────────────────────────────────────────

interface DiscogsBasicInfo {
  id: number
  master_id: number | null
  title: string
  year: number | null
  artists: Array<{ name: string }>
  labels: Array<{ name: string; catno: string }>
  genres: string[]
  styles: string[]
  formats: Array<{ name: string; descriptions?: string[] }>
  cover_image: string | null
  thumb: string | null
}

interface DiscogsCollectionItem {
  id: number          // instance_id
  rating: number      // 0 = unrated
  basic_information: DiscogsBasicInfo
}

interface DiscogsPagination {
  page: number
  pages: number
  per_page: number
  items: number
}

interface DiscogsCollectionResponse {
  pagination: DiscogsPagination
  releases: DiscogsCollectionItem[]
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

    log('info', 'discogs-sync-from-collection called', { userId: user.id })

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

    // Fetch ALL existing instance IDs to deduplicate — must paginate because
    // Supabase silently truncates .select() results at 1000 rows.
    const EXISTING_PAGE_SIZE = 1000
    const existingInstanceIds = new Set<number>()
    let existingOffset = 0
    while (true) {
      const { data: existingRows, error: existingErr } = await supabaseClient
        .from('physical_media')
        .select('discogs_instance_id')
        .eq('user_id', user.id)
        .not('discogs_instance_id', 'is', null)
        .range(existingOffset, existingOffset + EXISTING_PAGE_SIZE - 1)

      if (existingErr) {
        log('error', 'Failed to fetch existing instance IDs', { error: existingErr.message })
        return new Response(
          JSON.stringify({ error: 'Failed to load existing collection', details: existingErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      for (const r of (existingRows ?? []) as { discogs_instance_id: number }[]) {
        existingInstanceIds.add(r.discogs_instance_id)
      }

      if ((existingRows ?? []).length < EXISTING_PAGE_SIZE) break
      existingOffset += EXISTING_PAGE_SIZE
    }

    log('info', 'Existing instance IDs loaded', { count: existingInstanceIds.size })

    // Paginate through Discogs collection
    const PER_PAGE = 100
    const BUDGET_MS = 120_000
    const syncStartTime = Date.now()
    const baseCollectionUrl = `https://api.discogs.com/users/${connection.discogs_username}/collection/folders/0/releases`
    let page = 1
    let totalPages = 1
    let totalInDiscogs = 0
    const newItems: DiscogsCollectionItem[] = []

    while (page <= totalPages) {
      if (Date.now() - syncStartTime > BUDGET_MS) {
        log('warn', 'Time budget exceeded — returning partial result', { page, totalPages })
        return new Response(
          JSON.stringify({ error: 'Sync timed out mid-collection. Please try again to continue.', code: 'TIMEOUT' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const fetchUrl = `${baseCollectionUrl}?per_page=${PER_PAGE}&page=${page}`
      const authHeader = await buildOAuthHeader(
        'GET',
        baseCollectionUrl,
        consumerKey,
        consumerSecret,
        accessToken,
        accessTokenSecret,
        { per_page: String(PER_PAGE), page: String(page) },
      )

      let resp: Response
      try {
        resp = await fetch(fetchUrl, {
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: authHeader,
            'User-Agent': 'MakoSync/1.0',
            'Accept': 'application/json',
          },
        })
      } catch (fetchErr) {
        const isTimeout = fetchErr instanceof DOMException && fetchErr.name === 'TimeoutError'
        log('error', 'Discogs API fetch failed', { page, timeout: isTimeout, error: String(fetchErr) })
        return new Response(
          JSON.stringify({ error: isTimeout ? 'Discogs API timed out. Please try again.' : 'Failed to reach Discogs API' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      if (resp.status === 429) {
        log('warn', 'Discogs rate limit hit', { page })
        return new Response(
          JSON.stringify({ error: 'Discogs rate limit exceeded. Try again in 60 seconds.', code: 'RATE_LIMITED' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      if (!resp.ok) {
        const errText = await resp.text()
        log('error', 'Discogs collection fetch failed', { status: resp.status, page, body: errText })
        return new Response(
          JSON.stringify({ error: 'Failed to fetch Discogs collection', details: errText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const data = await resp.json() as DiscogsCollectionResponse
      totalPages = data.pagination.pages
      totalInDiscogs = data.pagination.items

      for (const item of data.releases) {
        if (existingInstanceIds.has(item.id)) continue
        newItems.push(item)
      }

      log('info', `Fetched collection page ${page}/${totalPages}`, { newOnPage: newItems.length })
      page++
    }

    const skipped = totalInDiscogs - newItems.length
    log('info', 'Collection pagination complete', { totalInDiscogs, newItems: newItems.length, skipped })

    // Insert new records
    if (newItems.length > 0) {
      const syncedAt = new Date().toISOString()
      const rows = newItems.map(item => ({
        user_id: user.id,
        discogs_instance_id: item.id,
        discogs_release_id: item.basic_information.id ?? null,
        discogs_master_id: item.basic_information.master_id ?? null,
        discogs_synced_at: syncedAt,
        artist: item.basic_information.artists?.[0]?.name ?? 'Unknown Artist',
        title: item.basic_information.title,
        label: item.basic_information.labels?.[0]?.name ?? null,
        catalogue_number: item.basic_information.labels?.[0]?.catno ?? null,
        year: item.basic_information.year ?? null,
        cover_image_url: item.basic_information.cover_image ?? item.basic_information.thumb ?? null,
        genres: item.basic_information.genres?.length ? item.basic_information.genres : null,
        styles: item.basic_information.styles?.length ? item.basic_information.styles : null,
        format: mapDiscogsFormat(item.basic_information.formats?.[0]?.name),
        format_details: item.basic_information.formats?.[0]?.descriptions?.join(', ') ?? null,
        rating: item.rating > 0 ? item.rating : null,
        tracklist: null,
        country: null,
        pressing: null,
        notes: null,
      }))

      const DB_BATCH_SIZE = 100
      for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
        const batch = rows.slice(i, i + DB_BATCH_SIZE)
        const { error: insertError } = await supabaseClient
          .from('physical_media')
          .upsert(batch, { onConflict: 'user_id,discogs_instance_id', ignoreDuplicates: true })

        if (insertError) {
          log('error', 'Failed to upsert batch', { error: insertError.message, batchStart: i })
          return new Response(
            JSON.stringify({ error: 'Failed to save imported records', details: insertError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          )
        }
      }
    }

    log('info', 'Sync complete', { imported: newItems.length, skipped, totalInDiscogs })
    return new Response(
      JSON.stringify({ imported: newItems.length, skipped, total_in_discogs: totalInDiscogs }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log('error', 'Unexpected error in discogs-sync-from-collection', { error: msg })
    return new Response(
      JSON.stringify({ error: 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } finally {
    await pool.end()
  }
})
