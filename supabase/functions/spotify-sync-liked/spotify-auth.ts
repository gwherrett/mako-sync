import type { SpotifyConnection } from './types.ts'
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts"

// Result type for refresh operation - includes new expiry for callers to update their state
export interface TokenRefreshResult {
  accessToken: string
  expiresAt: string
}

export async function refreshSpotifyToken(connection: SpotifyConnection, supabaseAdmin: any, userId: string): Promise<TokenRefreshResult> {
  console.log('🎵 SPOTIFY TOKEN refresh starting', { token_type: 'SPOTIFY_API' })
  
  // Get refresh token from vault using Postgres driver
  if (!connection.refresh_token_secret_id) {
    console.error('No refresh token vault reference found')
    throw new Error('No refresh token available - please reconnect Spotify')
  }
  
  console.log('Retrieving refresh token from vault using Postgres driver')
  
  // Use connection string for internal socket connection
  const pool = new Pool(
    Deno.env.get('SUPABASE_DB_URL')!,
    1
  )

  let refreshToken: string
  
  try {
    const connection_pg = await pool.connect()
    
    try {
      const result = await connection_pg.queryObject<{ decrypted_secret: string }>`
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE id = ${connection.refresh_token_secret_id}
      `
      
      if (!result.rows[0]?.decrypted_secret) {
        throw new Error('Failed to retrieve refresh token from vault')
      }
      
      refreshToken = result.rows[0].decrypted_secret
      console.log('Refresh token retrieved from vault')
      
    } finally {
      connection_pg.release()
    }
  } catch (vaultError: any) {
    await pool.end()
    console.error('Failed to retrieve refresh token from vault:', vaultError)
    throw new Error('Failed to retrieve refresh token from vault - please reconnect Spotify')
  }

  // Validate client credentials exist
  const clientId = Deno.env.get('SPOTIFY_CLIENT_ID')
  const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')
  
  if (!clientId || !clientSecret) {
    console.error('Missing Spotify client credentials')
    throw new Error('Spotify client credentials not configured')
  }

  console.log('Requesting token refresh from Spotify')

  const refreshResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  console.log('Refresh response received', { status: refreshResponse.status })

  if (!refreshResponse.ok) {
    const errorText = await refreshResponse.text()
    console.error('Token refresh failed', { status: refreshResponse.status })
    
    // If refresh token is invalid (400) or forbidden (403), we need a fresh connection
    if (refreshResponse.status === 400 || refreshResponse.status === 403) {
      // Clear the invalid connection using admin client to bypass RLS
      await supabaseAdmin
        .from('spotify_connections')
        .delete()
        .eq('user_id', userId)
      
      throw new Error('Spotify refresh token is invalid. Please disconnect and reconnect your Spotify account to get fresh tokens.')
    }
    
    throw new Error('Failed to refresh Spotify token')
  }

  const refreshData = await refreshResponse.json()
  console.log('Token refresh successful')
  
  const newAccessToken = refreshData.access_token
  const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString()

  console.log('Updating tokens in vault using Postgres driver')

  if (!connection.access_token_secret_id) {
    await pool.end()
    console.error('No access token vault reference found')
    throw new Error('Invalid connection state - please reconnect Spotify')
  }

  try {
    const connection_pg = await pool.connect()

    try {
      // Update access token in vault and verify it succeeded
      console.log('Updating access token secret in vault')
      const accessUpdateResult = await connection_pg.queryObject<{ update_secret: string }>`
        SELECT vault.update_secret(
          ${connection.access_token_secret_id},
          ${newAccessToken},
          NULL,
          NULL
        )
      `

      // Verify the update returned the secret ID (indicates success)
      if (!accessUpdateResult.rows[0]?.update_secret) {
        console.error('Vault update_secret returned null - secret may not exist', {
          secret_id: connection.access_token_secret_id
        })
        throw new Error('Failed to update access token in vault - secret not found')
      }
      console.log('Access token updated in vault successfully')

      // If Spotify provided a new refresh token, update it too
      if (refreshData.refresh_token) {
        if (!connection.refresh_token_secret_id) {
          throw new Error('No refresh token vault reference found')
        }

        console.log('Updating refresh token secret in vault (Spotify issued new refresh token)')
        const refreshUpdateResult = await connection_pg.queryObject<{ update_secret: string }>`
          SELECT vault.update_secret(
            ${connection.refresh_token_secret_id},
            ${refreshData.refresh_token},
            NULL,
            NULL
          )
        `

        // Verify the refresh token update succeeded
        if (!refreshUpdateResult.rows[0]?.update_secret) {
          console.error('Vault update_secret for refresh token returned null', {
            secret_id: connection.refresh_token_secret_id
          })
          throw new Error('Failed to update refresh token in vault - secret not found')
        }
        console.log('Refresh token updated in vault successfully')
      } else {
        console.log('Spotify did not issue new refresh token (using existing)')
      }

    } finally {
      connection_pg.release()
    }
  } catch (vaultError: any) {
    await pool.end()
    console.error('Failed to update tokens in vault:', vaultError.message)
    throw new Error('Failed to update tokens in vault - please reconnect Spotify')
  } finally {
    await pool.end()
  }

  // Update connection metadata using admin client to bypass RLS
  const updateData = {
    expires_at: newExpiresAt,
    updated_at: new Date().toISOString()
  }

  const { error: updateError } = await supabaseAdmin
    .from('spotify_connections')
    .update(updateData)
    .eq('user_id', userId)

  if (updateError) {
    console.error('Failed to update connection metadata:', updateError.message)
    throw new Error('Failed to update connection metadata')
  }

  console.log('🎵 SPOTIFY TOKEN refreshed successfully', {
    new_expires_at: newExpiresAt
  })

  // Return both token and expiry so callers can update their state
  return {
    accessToken: newAccessToken,
    expiresAt: newExpiresAt
  }
}

// Validate that vault secrets exist for a connection (call on connection load)
export async function validateVaultSecrets(connection: SpotifyConnection): Promise<{ valid: boolean; error?: string }> {
  if (!connection.access_token_secret_id || !connection.refresh_token_secret_id) {
    return {
      valid: false,
      error: 'Missing vault secret references - please reconnect Spotify'
    }
  }

  const pool = new Pool(
    Deno.env.get('SUPABASE_DB_URL')!,
    1
  )

  try {
    const connection_pg = await pool.connect()

    try {
      // Check both secrets exist in vault
      const result = await connection_pg.queryObject<{ id: string }>`
        SELECT id FROM vault.secrets
        WHERE id IN (${connection.access_token_secret_id}, ${connection.refresh_token_secret_id})
      `

      const foundIds = new Set(result.rows.map((r: { id: string }) => r.id))
      const missingSecrets: string[] = []

      if (!foundIds.has(connection.access_token_secret_id)) {
        missingSecrets.push('access_token')
      }
      if (!foundIds.has(connection.refresh_token_secret_id)) {
        missingSecrets.push('refresh_token')
      }

      if (missingSecrets.length > 0) {
        console.error('🔐 Vault secrets missing:', missingSecrets)
        return {
          valid: false,
          error: `Missing vault secrets (${missingSecrets.join(', ')}) - please reconnect Spotify`
        }
      }

      console.log('🔐 Vault secrets validated successfully')
      return { valid: true }

    } finally {
      connection_pg.release()
    }
  } catch (error: any) {
    console.error('Failed to validate vault secrets:', error.message)
    return {
      valid: false,
      error: 'Failed to validate vault secrets - please try again'
    }
  } finally {
    await pool.end()
  }
}

export async function getValidAccessToken(connection: SpotifyConnection, supabaseAdmin: any, userId: string): Promise<string> {
  const now = new Date()
  const expiresAt = new Date(connection.expires_at)
  const timeUntilExpiry = expiresAt.getTime() - now.getTime()
  const minutesUntilExpiry = Math.round(timeUntilExpiry / (1000 * 60))

  console.log('🎵 SPOTIFY TOKEN validity check', {
    token_type: 'SPOTIFY_API',
    time_until_expiry_minutes: minutesUntilExpiry,
    is_expired: now >= expiresAt,
    expires_at: expiresAt.toISOString()
  })

  // Refresh if token is expired or expires within 5 minutes
  if (now >= expiresAt || timeUntilExpiry < 5 * 60 * 1000) {
    console.log('🎵 SPOTIFY TOKEN needs refresh', {
      token_type: 'SPOTIFY_API',
      reason: now >= expiresAt ? 'expired' : 'expiring_within_5_minutes',
      minutes_until_expiry: minutesUntilExpiry
    })
    const refreshResult = await refreshSpotifyToken(connection, supabaseAdmin, userId)
    return refreshResult.accessToken
  }

  // Get access token from vault using Postgres driver
  if (!connection.access_token_secret_id) {
    console.error('No access token vault reference found')
    throw new Error('No access token available - please reconnect Spotify')
  }

  console.log('Retrieving access token from vault using Postgres driver')

  // Use connection string for internal socket connection
  const pool = new Pool(
    Deno.env.get('SUPABASE_DB_URL')!,
    1
  )

  try {
    const connection_pg = await pool.connect()

    try {
      const result = await connection_pg.queryObject<{ decrypted_secret: string }>`
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE id = ${connection.access_token_secret_id}
      `

      if (!result.rows[0]?.decrypted_secret) {
        console.error('Access token not found in vault - secret may have been deleted', {
          secret_id: connection.access_token_secret_id
        })
        throw new Error('Access token not found in vault - please reconnect Spotify')
      }

      console.log('Access token retrieved from vault')
      return result.rows[0].decrypted_secret

    } finally {
      connection_pg.release()
    }
  } catch (vaultError: any) {
    console.error('Failed to retrieve access token from vault:', vaultError.message)
    throw new Error('Failed to retrieve access token from vault - please reconnect Spotify')
  } finally {
    await pool.end()
  }
}