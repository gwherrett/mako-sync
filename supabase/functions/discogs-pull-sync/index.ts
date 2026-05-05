// deploy v2
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
    service: 'discogs-pull-sync',
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
    const result = await conn.queryObject<{ id: string; decrypted_secret: string }>`
      SELECT id, decrypted_secret FROM vault.decrypted_secrets
      WHERE id IN (${accessTokenSecretId}, ${accessSecretSecretId})
    `
    const byId = Object.fromEntries(result.rows.map(r => [r.id, r.decrypted_secret]))
    const accessToken = byId[accessTokenSecretId]
    const accessTokenSecret = byId[accessSecretSecretId]
    if (!accessToken || !accessTokenSecret) {
      throw new Error('Could not decrypt Discogs tokens from Vault')
    }
    return { accessToken, accessTokenSecret }
  } finally {
    conn.release()
  }
}

// ─── Format mapping ────────────────────────────────────────────────────────

function mapDiscogsFormat(name?: string, descriptions?: string[]): string | null {
  if (!name) return null
  const n = name.toLowerCase()
  if (n.includes('7"') || n === '7-inch') return '7"'
  if (n.includes('10"') || n === '10-inch') return '10"'
  if (n.includes('12"') || n === '12-inch') return '12"'
  if (n === 'ep') return 'EP'
  if (n === 'single') return 'Single'
  if (n === 'vinyl') {
    const desc = (descriptions ?? []).map(d => d.toLowerCase())
    if (desc.some(d => d.includes('12"') || d === '12-inch')) return '12"'
    if (desc.some(d => d.includes('10"') || d === '10-inch')) return '10"'
    if (desc.some(d => d.includes('7"') || d === '7-inch')) return '7"'
    return 'LP'
  }
  return 'Other'
}

// ─── Types ─────────────────────────────────────────────────────────────────

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

interface DiscogsEnrichedItem extends DiscogsCollectionItem {
  _tracklist: Array<{ position: string; title: string }> | null
  _country: string | null
  _lowest_price_cad: number | null
}

interface DiscogsCollectionResponse {
  pagination: { page: number; pages: number; per_page: number; items: number }
  releases: DiscogsCollectionItem[]
}

interface SyncError {
  id: string | number
  reason: string
}

interface SyncResult {
  pulled: number
  partial: boolean
  errors: SyncError[]
}

// ─── Pull: Discogs → Mako ──────────────────────────────────────────────────

async function pullFromDiscogs(
  supabaseClient: ReturnType<typeof createClient>,
  userId: string,
  username: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string,
): Promise<SyncResult> {
  // Load existing instance IDs for deduplication — paginate to handle collections > 1000
  const DEDUP_PAGE_SIZE = 1000
  const existingInstanceIds = new Set<number>()
  let dedupOffset = 0
  while (true) {
    const { data: existingRows } = await supabaseClient
      .from('physical_media')
      .select('discogs_instance_id')
      .eq('user_id', userId)
      .not('discogs_instance_id', 'is', null)
      .range(dedupOffset, dedupOffset + DEDUP_PAGE_SIZE - 1)
    const rows = existingRows ?? []
    for (const r of rows as Array<{ discogs_instance_id: number }>) {
      existingInstanceIds.add(r.discogs_instance_id)
    }
    if (rows.length < DEDUP_PAGE_SIZE) break
    dedupOffset += DEDUP_PAGE_SIZE
  }

  log('info', 'Pull: existing instance IDs', { count: existingInstanceIds.size })

  const PER_PAGE = 100
  const BUDGET_MS = 100_000
  const startTime = Date.now()
  const baseUrl = `https://api.discogs.com/users/${username}/collection/folders/0/releases`
  let page = 1
  let totalPages = 1
  const newItems: DiscogsCollectionItem[] = []

  while (page <= totalPages) {
    if (Date.now() - startTime > BUDGET_MS) {
      log('warn', 'Pull: time budget exceeded', { page, totalPages })
      break
    }

    const fetchUrl = `${baseUrl}?per_page=${PER_PAGE}&page=${page}`
    const authHeader = await buildOAuthHeader(
      'GET', baseUrl, consumerKey, consumerSecret, accessToken, accessTokenSecret,
      { per_page: String(PER_PAGE), page: String(page) },
    )

    let resp: Response
    try {
      resp = await fetch(fetchUrl, {
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: authHeader,
          'User-Agent': 'MakoSync/1.0',
          Accept: 'application/json',
        },
      })
    } catch (fetchErr) {
      throw new Error(`Failed to fetch Discogs collection page ${page}: ${fetchErr}`)
    }

    if (resp.status === 429) throw new Error('RATE_LIMITED')
    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`Discogs collection fetch failed (${resp.status}): ${body}`)
    }

    const data = await resp.json() as DiscogsCollectionResponse
    totalPages = data.pagination.pages

    for (const item of data.releases) {
      if (!existingInstanceIds.has(item.id)) newItems.push(item)
    }

    log('info', `Pull: fetched page ${page}/${totalPages}`, { newSoFar: newItems.length })
    page++
  }

  if (newItems.length === 0) {
    return { pulled: 0, partial: false, errors: [] }
  }

  // Enrich items sequentially, checking the budget before each one.
  // Sequential processing lets us stop cleanly when time runs low and insert
  // what's been enriched so far. The next sync call resumes automatically
  // because the dedup set skips already-inserted instance IDs.
  // Rate limit: 2 API calls per item, staggered to stay under Discogs 60 req/min.
  log('info', 'Pull: enriching items with release data + marketplace stats', { count: newItems.length })
  const enriched: DiscogsEnrichedItem[] = []
  let partial = false

  for (let i = 0; i < newItems.length; i++) {
    if (Date.now() - startTime > BUDGET_MS) {
      log('warn', 'Pull: enrichment budget exceeded — stopping early', { processed: i, total: newItems.length })
      partial = true
      break
    }

    const item = newItems[i]
    const itemStart = Date.now()
    const releaseId = item.basic_information.id
    const releaseUrl = `https://api.discogs.com/releases/${releaseId}`
    const statsBaseUrl = `https://api.discogs.com/marketplace/stats/${releaseId}`

    try {
      const [releaseAuth, statsAuth] = await Promise.all([
        buildOAuthHeader('GET', releaseUrl, consumerKey, consumerSecret, accessToken, accessTokenSecret),
        buildOAuthHeader('GET', statsBaseUrl, consumerKey, consumerSecret, accessToken, accessTokenSecret, { currency: 'CAD' }),
      ])

      const [releaseResp, statsResp] = await Promise.all([
        fetch(releaseUrl, {
          signal: AbortSignal.timeout(10000),
          headers: { Authorization: releaseAuth, 'User-Agent': 'MakoSync/1.0', Accept: 'application/json' },
        }),
        fetch(`${statsBaseUrl}?currency=CAD`, {
          signal: AbortSignal.timeout(10000),
          headers: { Authorization: statsAuth, 'User-Agent': 'MakoSync/1.0', Accept: 'application/json' },
        }),
      ])

      let tracklist: Array<{ position: string; title: string }> | null = null
      let country: string | null = null
      if (releaseResp.ok) {
        const full = await releaseResp.json()
        tracklist = full.tracklist?.map((t: { position: string; title: string }) => ({
          position: t.position,
          title: t.title,
        })) ?? null
        country = full.country ?? null
      } else {
        log('warn', 'Pull: release fetch failed, inserting without tracklist', { releaseId, status: releaseResp.status })
      }

      let lowestPriceCad: number | null = null
      if (statsResp.ok) {
        const stats = await statsResp.json()
        lowestPriceCad = stats.lowest_price?.value ?? null
      } else {
        log('warn', 'Pull: marketplace stats fetch failed', { releaseId, status: statsResp.status })
      }

      enriched.push({ ...item, _tracklist: tracklist, _country: country, _lowest_price_cad: lowestPriceCad })
    } catch (err) {
      log('warn', 'Pull: enrichment error, inserting without enrichment', { releaseId, error: String(err) })
      enriched.push({ ...item, _tracklist: null, _country: null, _lowest_price_cad: null })
    }

    // Maintain ~2.2 s between request starts to stay within Discogs 60 req/min limit
    const itemElapsed = Date.now() - itemStart
    const waitMs = Math.max(0, 2200 - itemElapsed)
    if (waitMs > 0 && i < newItems.length - 1) {
      await new Promise(r => setTimeout(r, waitMs))
    }
  }

  // Insert in batches of 100
  const syncedAt = new Date().toISOString()
  const rows = enriched.map(item => ({
    user_id: userId,
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
    format: mapDiscogsFormat(item.basic_information.formats?.[0]?.name, item.basic_information.formats?.[0]?.descriptions),
    format_details: item.basic_information.formats?.[0]?.descriptions?.join(', ') ?? null,
    rating: item.rating > 0 ? item.rating : null,
    tracklist: item._tracklist,
    country: item._country,
    lowest_price_cad: item._lowest_price_cad,
    pressing: null,
    notes: null,
  }))

  const errors: SyncError[] = []
  const DB_BATCH_SIZE = 100
  let pulled = 0

  for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
    const batch = rows.slice(i, i + DB_BATCH_SIZE)
    const { error: insertError } = await supabaseClient
      .from('physical_media')
      .insert(batch)

    if (insertError) {
      log('error', 'Pull: batch insert failed', { batchStart: i, error: insertError.message })
      errors.push({ id: `batch-${i}`, reason: insertError.message })
    } else {
      pulled += batch.length
    }
  }

  return { pulled, partial, errors }
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

    log('info', 'discogs-pull-sync called', { userId: user.id })

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

    const { accessToken, accessTokenSecret } = await getTokensFromVault(
      pool,
      connection.access_token_secret_id,
      connection.access_secret_secret_id,
    )

    const result = await pullFromDiscogs(
      supabaseClient, user.id, connection.discogs_username,
      consumerKey, consumerSecret, accessToken, accessTokenSecret,
    )

    log('info', 'Pull sync complete', result)
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg === 'RATE_LIMITED') {
      return new Response(
        JSON.stringify({ error: 'Discogs rate limit hit. Wait 60 seconds and try again.', code: 'RATE_LIMITED' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    log('error', 'Unexpected error in discogs-pull-sync', { error: msg })
    return new Response(
      JSON.stringify({ error: 'Server error', details: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } finally {
    await pool.end()
  }
})
