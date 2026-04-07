import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0"
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Enhanced logging for unified system integration
const logWithContext = (level: 'info' | 'warn' | 'error', message: string, context?: any) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level: level.toUpperCase(),
    service: 'spotify-auth-edge-function',
    message,
    ...(context && { context })
  };
  console.log(JSON.stringify(logEntry));
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    logWithContext('info', 'Spotify auth edge function called', {
      method: req.method,
      url: req.url,
      userAgent: req.headers.get('user-agent')
    });
    
    // Client for user authentication
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // Admin client for vault operations (requires service_role key)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    
    if (!user) {
      logWithContext('warn', 'Authentication failed: No user found');
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          code: 'AUTH_REQUIRED',
          timestamp: new Date().toISOString()
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logWithContext('info', 'User authenticated successfully', {
      userId: user.id,
      userEmail: user.email
    });

    const requestBody = await req.json()
    logWithContext('info', 'Authorization code received', {
      hasCode: !!requestBody.code,
      hasState: !!requestBody.state,
      hasRedirectUri: !!requestBody.redirect_uri
    });
    
    const { code, state, redirect_uri } = requestBody

    // Use the redirect_uri from the request - must be provided by client
    const redirectUri = redirect_uri;
    
    if (!redirectUri) {
      logWithContext('error', 'Missing redirect_uri in request body');
      return new Response(
        JSON.stringify({
          error: 'redirect_uri is required',
          code: 'MISSING_REDIRECT_URI',
          timestamp: new Date().toISOString()
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logWithContext('info', 'Processing Spotify token exchange', {
      redirectUri,
      userId: user.id
    });
    
    const clientId = Deno.env.get('SPOTIFY_CLIENT_ID')
    const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')
    
    logWithContext('info', 'Environment check', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      clientIdPreview: clientId?.substring(0, 8) + '...',
      redirectUri
    });
    
    if (!clientId || !clientSecret) {
      logWithContext('error', 'Spotify credentials not configured', {
        SPOTIFY_CLIENT_ID: !!clientId,
        SPOTIFY_CLIENT_SECRET: !!clientSecret
      });
      return new Response(
        JSON.stringify({
          error: 'Spotify credentials not configured in edge function environment',
          code: 'MISSING_SPOTIFY_CREDENTIALS',
          timestamp: new Date().toISOString(),
          debug: {
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret
          }
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Exchange code for access token
    const tokenRequestBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    })

    logWithContext('info', 'Requesting tokens from Spotify', {
      grantType: 'authorization_code',
      redirectUri,
      userId: user.id
    });
    
    const authHeader = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
    
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': authHeader,
      },
      body: tokenRequestBody,
    })

    const tokenData = await tokenResponse.json()
    logWithContext('info', 'Token exchange response received', {
      success: !tokenData.error,
      status: tokenResponse.status,
      userId: user.id
    });

    if (tokenData.error) {
      logWithContext('error', 'Token exchange failed', {
        error: tokenData.error,
        error_description: tokenData.error_description,
        status: tokenResponse.status,
        userId: user.id,
        requestBody: {
          grant_type: 'authorization_code',
          code: code?.substring(0, 10) + '...',
          redirect_uri: redirectUri
        }
      });
      return new Response(
        JSON.stringify({
          error: `Spotify auth failed: ${tokenData.error}`,
          code: 'SPOTIFY_TOKEN_EXCHANGE_FAILED',
          details: tokenData.error_description,
          timestamp: new Date().toISOString(),
          debug: {
            status: tokenResponse.status,
            redirect_uri: redirectUri
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logWithContext('info', 'Access token received successfully', {
      userId: user.id,
      tokenType: tokenData.token_type,
      scope: tokenData.scope,
      expiresIn: tokenData.expires_in
    });

    // Get user profile from Spotify
    logWithContext('info', 'Fetching Spotify user profile', {
      userId: user.id
    });
    const profileResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    })

    const profileData = await profileResponse.json()
    
    if (profileResponse.status !== 200) {
      logWithContext('error', 'Failed to get Spotify profile', {
        status: profileResponse.status,
        error: profileData.error?.message,
        userId: user.id
      });
      return new Response(
        JSON.stringify({
          error: `Failed to get Spotify profile: ${profileData.error?.message || 'Unknown error'}`,
          code: 'SPOTIFY_PROFILE_FETCH_FAILED',
          timestamp: new Date().toISOString()
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logWithContext('info', 'Spotify profile retrieved successfully', {
      userId: user.id,
      spotifyUserId: profileData.id,
      displayName: profileData.display_name,
    });

    // Store tokens securely in Vault using Postgres driver for direct SQL access
    logWithContext('info', 'Storing tokens in vault using Postgres driver', {
      userId: user.id,
      spotifyUserId: profileData.id
    });

    const dbUrl = Deno.env.get('SUPABASE_DB_URL')
    logWithContext('info', 'Database connection check', {
      hasDbUrl: !!dbUrl,
      dbUrlPreview: dbUrl?.substring(0, 20) + '...'
    });

    if (!dbUrl) {
      logWithContext('error', 'SUPABASE_DB_URL not configured');
      return new Response(
        JSON.stringify({
          error: 'Database connection not configured in edge function environment',
          code: 'MISSING_DATABASE_URL',
          timestamp: new Date().toISOString(),
          debug: 'SUPABASE_DB_URL missing'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Postgres connection pool - use connection string for internal socket connection
    const pool = new Pool(dbUrl, 1)

    let accessTokenSecretId: string
    let refreshTokenSecretId: string
    // Track old secret IDs for cleanup after upsert removes FK references
    let oldAccessSecretId: string | null = null
    let oldRefreshSecretId: string | null = null

    try {
      const connection = await pool.connect()

      try {
        // Step 1: Get existing secret IDs from spotify_connections (if any)
        logWithContext('info', 'Checking for existing spotify connection', {
          userId: user.id
        });

        const existingConnection = await connection.queryObject<{
          access_token_secret_id: string | null,
          refresh_token_secret_id: string | null
        }>`
          SELECT access_token_secret_id, refresh_token_secret_id
          FROM spotify_connections
          WHERE user_id = ${user.id}
        `;

        oldAccessSecretId = existingConnection.rows[0]?.access_token_secret_id || null;
        oldRefreshSecretId = existingConnection.rows[0]?.refresh_token_secret_id || null;

        if (oldAccessSecretId || oldRefreshSecretId) {
          logWithContext('info', 'Found existing connection, will clean up old secrets after upsert', {
            userId: user.id,
            oldAccessSecretId,
            oldRefreshSecretId
          });
        }

        // Step 2: Create new secrets in vault (with unique names to avoid conflicts)
        const timestamp = Date.now();
        const accessTokenName = `spotify_access_token_${user.id}_${timestamp}`;
        const refreshTokenName = `spotify_refresh_token_${user.id}_${timestamp}`;

        logWithContext('info', 'Creating access token secret in vault', {
          userId: user.id,
          secretName: accessTokenName
        });
        const accessTokenResult = await connection.queryObject<{ id: string }>`
          SELECT vault.create_secret(
            ${tokenData.access_token},
            ${accessTokenName},
            ${'Spotify access_token for user ' + user.id}
          ) as id
        `

        if (!accessTokenResult.rows[0]?.id) {
          throw new Error('Failed to create access token secret')
        }

        accessTokenSecretId = accessTokenResult.rows[0].id
        logWithContext('info', 'Access token stored in vault successfully', {
          userId: user.id,
          secretId: accessTokenSecretId
        });

        logWithContext('info', 'Creating refresh token secret in vault', {
          userId: user.id,
          secretName: refreshTokenName
        });
        const refreshTokenResult = await connection.queryObject<{ id: string }>`
          SELECT vault.create_secret(
            ${tokenData.refresh_token},
            ${refreshTokenName},
            ${'Spotify refresh_token for user ' + user.id}
          ) as id
        `

        if (!refreshTokenResult.rows[0]?.id) {
          throw new Error('Failed to create refresh token secret')
        }

        refreshTokenSecretId = refreshTokenResult.rows[0].id
        logWithContext('info', 'Refresh token stored in vault successfully', {
          userId: user.id,
          secretId: refreshTokenSecretId
        });

      } finally {
        connection.release()
      }
    } catch (vaultError: any) {
      logWithContext('error', 'Failed to store tokens in vault', {
        userId: user.id,
        error: vaultError.message,
        stack: vaultError.stack
      });
      await pool.end()
      return new Response(
        JSON.stringify({
          error: 'Failed to securely store tokens. Please try again.',
          code: 'VAULT_STORAGE_FAILED',
          timestamp: new Date().toISOString(),
          debug: vaultError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Store connection with vault references only (no plain text fallback)
    const connectionData = {
      user_id: user.id,
      spotify_user_id: profileData.id,
      access_token_secret_id: accessTokenSecretId,
      refresh_token_secret_id: refreshTokenSecretId,
      // Always use placeholder - tokens only stored in vault
      access_token: '***ENCRYPTED_IN_VAULT***',
      refresh_token: '***ENCRYPTED_IN_VAULT***',
      expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      scope: tokenData.scope,
      token_type: tokenData.token_type || 'Bearer',
      display_name: profileData.display_name,
      email: user.email ?? null,
    }

    logWithContext('info', 'Storing connection in database', {
      userId: user.id,
      spotifyUserId: profileData.id,
      displayName: profileData.display_name,
      accessTokenSecretId,
      refreshTokenSecretId
    });

    const { error: dbError } = await supabaseClient
      .from('spotify_connections')
      .upsert(connectionData, { onConflict: 'user_id' })

    if (dbError) {
      logWithContext('error', 'Database error storing connection', {
        userId: user.id,
        error: dbError.message,
        code: dbError.code
      });
      await pool.end()
      return new Response(
        JSON.stringify({
          error: `Database error: ${dbError.message}`,
          code: 'DATABASE_STORAGE_FAILED',
          timestamp: new Date().toISOString()
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logWithContext('info', 'Spotify connection created successfully', {
      userId: user.id,
      spotifyUserId: profileData.id,
      connectionId: connectionData.user_id
    });

    // Step 4: Clean up old secrets now that FK references have been updated
    if (oldAccessSecretId || oldRefreshSecretId) {
      logWithContext('info', 'Cleaning up old vault secrets', {
        userId: user.id,
        oldAccessSecretId,
        oldRefreshSecretId
      });

      try {
        const cleanupConnection = await pool.connect()
        try {
          if (oldAccessSecretId) {
            await cleanupConnection.queryObject`
              DELETE FROM vault.secrets WHERE id = ${oldAccessSecretId}
            `;
            logWithContext('info', 'Deleted old access token secret', {
              userId: user.id,
              secretId: oldAccessSecretId
            });
          }
          if (oldRefreshSecretId) {
            await cleanupConnection.queryObject`
              DELETE FROM vault.secrets WHERE id = ${oldRefreshSecretId}
            `;
            logWithContext('info', 'Deleted old refresh token secret', {
              userId: user.id,
              secretId: oldRefreshSecretId
            });
          }
        } finally {
          cleanupConnection.release()
        }
      } catch (cleanupError: any) {
        // Log but don't fail - old secrets will be orphaned but connection is valid
        logWithContext('warn', 'Failed to clean up old vault secrets (non-fatal)', {
          userId: user.id,
          error: cleanupError.message
        });
      }
    }

    // Close the pool
    await pool.end()

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Spotify connected successfully',
        timestamp: new Date().toISOString(),
        data: {
          spotifyUserId: profileData.id,
          displayName: profileData.display_name
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    logWithContext('error', 'Spotify auth failed with unexpected error', {
      error: error.message,
      stack: error.stack,
      name: error.name
    });
    return new Response(
      JSON.stringify({
        error: 'Server error occurred',
        code: 'UNEXPECTED_ERROR',
        timestamp: new Date().toISOString()
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
