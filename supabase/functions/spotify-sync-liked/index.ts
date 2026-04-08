 // Deployment test - triggering GitHub Actions

 import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0"

import type { SpotifyConnection } from './types.ts'
import { getValidAccessToken, refreshSpotifyToken, validateVaultSecrets } from './spotify-auth.ts'
import { extractUniqueArtistIds, processSongsData } from './data-processing.ts'
import { getArtistGenresWithCache } from './artist-genres.ts'

const CHUNK_SIZE = 500 // Process 500 tracks at a time

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse request body for various flags
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const forceFullSync = body.force_full_sync === true
    const refreshOnly = body.refresh_only === true
    const healthCheck = body.health_check === true
    const validateVault = body.validate_vault === true
    const forceTokenRotation = body.force_token_rotation === true
    
    console.log('=== SPOTIFY SYNC STARTED ===')
    console.log('Request method:', req.method)
    console.log('Force full sync:', forceFullSync)
    console.log('Refresh only:', refreshOnly)
    console.log('Health check:', healthCheck)
    console.log('Validate vault:', validateVault)
    console.log('Force token rotation:', forceTokenRotation)
    
    // Create client for user auth and RLS-protected operations
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // Create admin client for vault operations (needs service_role)
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

    // Get user's Spotify connection using admin client for vault access
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from('spotify_connections')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (connectionError || !connection) {
      return new Response(
        JSON.stringify({ error: 'Spotify not connected' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Connection found:', {
      spotify_user_id: connection.spotify_user_id,
      expires_at: connection.expires_at,
      has_vault_access_token: !!connection.access_token_secret_id,
      has_vault_refresh_token: !!connection.refresh_token_secret_id,
      created_at: connection.created_at
    })

    // Validate vault secrets exist before any operation
    const vaultValidation = await validateVaultSecrets(connection as SpotifyConnection)
    if (!vaultValidation.valid) {
      console.error('🔐 Vault validation failed:', vaultValidation.error)
      return new Response(
        JSON.stringify({
          error: vaultValidation.error,
          code: 'VAULT_SECRETS_INVALID',
          requires_reconnect: true
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    console.log('🔐 Vault secrets validated')

    // Handle Phase 4 special operations first
    if (refreshOnly) {
      console.log('🔄 REFRESH ONLY: Performing token refresh')
      try {
        const refreshResult = await refreshSpotifyToken(connection as SpotifyConnection, supabaseAdmin, user.id)
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Token refreshed successfully',
            access_token_refreshed: true,
            new_expires_at: refreshResult.expiresAt
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (error: any) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    if (healthCheck) {
      console.log('🏥 HEALTH CHECK: Testing API connectivity')
      try {
        const accessToken = await getValidAccessToken(connection as SpotifyConnection, supabaseAdmin, user.id)
        
        // Test Spotify API with a simple call
        const response = await fetch('https://api.spotify.com/v1/me', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          throw new Error(`Spotify API error: ${response.status}`)
        }

        const userData = await response.json()
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Health check passed',
            spotify_user: userData.display_name || userData.id,
            api_response_time: Date.now()
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (error: any) {
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message,
            health_check_failed: true
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    if (validateVault) {
      console.log('🔐 VAULT VALIDATION: Checking vault storage integrity')
      try {
        // Validate that we can retrieve tokens from vault
        const accessToken = await getValidAccessToken(connection as SpotifyConnection, supabaseAdmin, user.id)
        
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Vault validation passed',
            vault_access: true,
            connection_id: body.connection_id || connection.id
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (error: any) {
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message,
            vault_validation_failed: true
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    if (forceTokenRotation) {
      console.log('🔄 FORCE TOKEN ROTATION: Rotating tokens for security')
      try {
        // Force refresh to get new tokens
        const refreshResult = await refreshSpotifyToken(connection as SpotifyConnection, supabaseAdmin, user.id)

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Tokens rotated successfully',
            token_rotation_completed: true,
            new_expires_at: refreshResult.expiresAt
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (error: any) {
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message,
            token_rotation_failed: true
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Get valid access token (refresh if needed) - use admin client for vault access
    let accessToken
    try {
      accessToken = await getValidAccessToken(connection as SpotifyConnection, supabaseAdmin, user.id)
      console.log('Access token obtained successfully')
    } catch (error: any) {
      console.error('Failed to get valid access token:', error)
      if (error.message.includes('refresh token is invalid')) {
        // Clear the invalid connection
        await supabaseAdmin
          .from('spotify_connections')
          .delete()
          .eq('user_id', user.id)
        
        throw new Error('Your Spotify connection has expired. Please disconnect and reconnect your Spotify account to get fresh tokens.')
      }
      throw error
    }

    // Check for existing in-progress sync
    const { data: existingSync } = await supabaseClient
      .from('sync_progress')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'in_progress')
      .maybeSingle()

    let syncId: string
    let startOffset = 0
    let totalTracks: number | null = null
    let lastSyncTime: string | null = null
    let isFullSync = forceFullSync
    let manualGenreMap = new Map<string, string>() // Declare at function scope

    // Genre health-check counters — detect silent removal of artist.genres from Spotify API
    let healthArtistTotal = 0
    let healthArtistWithGenres = 0

    // Cache efficiency stats — measure API calls saved by cache-first strategy
    let totalCacheHits = 0
    let totalApiFetches = 0

    if (existingSync) {
      console.log(`📝 Resuming sync from offset ${existingSync.last_offset}`)
      syncId = existingSync.sync_id
      startOffset = existingSync.last_offset
      totalTracks = existingSync.total_tracks
      isFullSync = existingSync.is_full_sync ?? false
      
      // PHASE 2: Load cached genres from database when resuming
      if (existingSync.cached_genres) {
        const cachedGenresObj = existingSync.cached_genres as Record<string, string>
        manualGenreMap = new Map(Object.entries(cachedGenresObj))
        console.log(`✅ RESUME: Loaded ${manualGenreMap.size} cached genre assignments from database`)
        // PHASE 1: Log sample IDs for verification
        const sampleIds = Array.from(manualGenreMap.keys()).slice(0, 3)
        console.log(`📋 Sample cached spotify_ids:`, sampleIds)
      } else {
        console.log(`⚠️  RESUME: No cached genres found in database (cached_genres is empty)`)
      }
    } else {
      // Check for last track added_at timestamp to determine if incremental is possible
      if (!forceFullSync) {
        const { data: lastTrack } = await supabaseClient
          .from('spotify_liked')
          .select('added_at')
          .eq('user_id', user.id)
          .order('added_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        if (lastTrack?.added_at) {
          lastSyncTime = lastTrack.added_at
          isFullSync = false
          console.log(`🔄 Incremental sync mode - fetching songs added after ${lastSyncTime}`)
        } else {
          isFullSync = true
          console.log('🆕 First sync - will sync all songs')
        }
      } else {
        console.log('🔄 Force full sync requested')
      }

      // Create new sync progress record
      const { data: newSync, error: syncError } = await supabaseClient
        .from('sync_progress')
        .insert({
          user_id: user.id,
          status: 'in_progress',
          last_offset: 0,
          is_full_sync: isFullSync
        })
        .select()
        .single()

      if (syncError || !newSync) {
        throw new Error('Failed to create sync progress record')
      }

      syncId = newSync.sync_id
      console.log(`🆕 Starting new sync with ID: ${syncId}`)

      // Cache manually assigned genres BEFORE deletion (for full sync)
      if (isFullSync) {
        console.log('💾 PHASE 1: Caching manually assigned genres before full sync deletion...')
        
        // Fetch ALL manually overridden genres with pagination (Supabase default limit is 1000)
        let allManualGenres: {spotify_id: string, super_genre: string}[] = []
        let offset = 0
        const PAGE_SIZE = 1000

        while (true) {
          const { data: page, error: pageError } = await supabaseAdmin
            .from('spotify_liked')
            .select('spotify_id, super_genre')
            .eq('user_id', user.id)
            .eq('super_genre_manual_override', true)
            .range(offset, offset + PAGE_SIZE - 1)
            .order('spotify_id')
          
          if (pageError) {
            console.error('❌ Failed to cache genres:', pageError)
            throw new Error(`Failed to cache existing genres: ${pageError.message}`)
          }
          
          if (!page || page.length === 0) break
          
          allManualGenres = allManualGenres.concat(page)
          console.log(`📄 Fetched page at offset ${offset}: ${page.length} genres (total: ${allManualGenres.length})`)
          
          offset += PAGE_SIZE
          if (page.length < PAGE_SIZE) break // Last page
        }
        
        if (allManualGenres.length > 0) {
          allManualGenres.forEach(track => {
            if (track.super_genre) {
              manualGenreMap.set(track.spotify_id, track.super_genre)
            }
          })
          console.log(`✅ PHASE 1: Successfully cached ${manualGenreMap.size} genre assignments (across ${Math.ceil(allManualGenres.length / PAGE_SIZE)} pages)`)
          
          // PHASE 1: Log sample data for verification
          const sampleTracks = allManualGenres.slice(0, 3)
          console.log(`📋 PHASE 1: Sample cached tracks:`)
          sampleTracks.forEach((track, idx) => {
            console.log(`   ${idx + 1}. spotify_id: ${track.spotify_id} -> super_genre: ${track.super_genre}`)
          })
          
          // PHASE 2: Save cached genres to database for resume support
          const cachedGenresObj = Object.fromEntries(manualGenreMap)
          const { error: updateError } = await supabaseClient
            .from('sync_progress')
            .update({ cached_genres: cachedGenresObj })
            .eq('sync_id', syncId)
          
          if (updateError) {
            console.error('⚠️  PHASE 2: Failed to save cached genres to database:', updateError)
          } else {
            console.log(`✅ PHASE 2: Saved ${manualGenreMap.size} cached genres to database for resume support`)
          }
        } else {
          console.log('⚠️  PHASE 1: No existing genres found to cache (all tracks have null super_genre)')
        }
      }

      // Clear existing songs only for full sync
      if (isFullSync) {
        console.log('🗑️ Clearing existing songs for full sync...')
        const { error: deleteError } = await supabaseAdmin
          .from('spotify_liked')
          .delete()
          .eq('user_id', user.id)

        if (deleteError) {
          throw new Error(`Failed to clear existing songs: ${deleteError.message}`)
        }
      }
    }

    // Fetch genre mapping once before the sync loop (stable during sync)
    const { data: genreMappingData } = await supabaseClient
      .from('v_effective_spotify_genre_map')
      .select('spotify_genre, super_genre')
    const genreMapping = new Map<string, string>()
    if (genreMappingData) {
      genreMappingData.forEach(item => {
        if (item.spotify_genre && item.super_genre) {
          genreMapping.set(item.spotify_genre, item.super_genre)
        }
      })
    }
    console.log(`📋 Genre mapping loaded: ${genreMapping.size} entries`)

    // Fetch tracks in chunks
    let currentOffset = startOffset
    let hasMore = true
    let allChunkTracks: any[] = []
    let newTracksCount = 0
    let olderTracksCount = 0 // Count tracks older than last sync to determine when to stop
    const allSpotifyIds = new Set<string>() // Track all Spotify IDs from this sync for deletion detection
    let duplicatesRemoved = 0 // Track duplicates removed during sync
    const syncStartTime = Date.now()
    const BUDGET_MS = 120_000 // Stop at 120s to return before Supabase's 150s hard limit

    while (hasMore) {
      // Time-budget check: exit gracefully before the hard 150s edge-function timeout
      if (Date.now() - syncStartTime > BUDGET_MS) {
        console.log(`⏱️ Approaching time limit at offset ${currentOffset} — saving progress and exiting for resume`)
        await supabaseClient
          .from('sync_progress')
          .update({ last_offset: currentOffset, tracks_fetched: currentOffset })
          .eq('sync_id', syncId)
        return new Response(
          JSON.stringify({ success: true, partial: true, message: 'Sync paused — will resume on next trigger', tracks_processed: newTracksCount, resume_offset: currentOffset }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const url = `https://api.spotify.com/v1/me/tracks?limit=50&offset=${currentOffset}`
      console.log(`📥 Fetching tracks at offset ${currentOffset}`)

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`Failed to fetch tracks: ${response.status} ${response.statusText} - ${errorText}`)
        
        // Update sync status to failed
        await supabaseClient
          .from('sync_progress')
          .update({
            status: 'failed',
            error_message: `Spotify API error: ${response.status} - ${errorText}`
          })
          .eq('sync_id', syncId)

        throw new Error(`Failed to fetch liked songs from Spotify: ${response.status}`)
      }

      const data = await response.json()
      
      // Track all Spotify IDs for deletion detection (only during full sync)
      if (isFullSync) {
        data.items.forEach((item: any) => {
          if (item.track?.id) {
            allSpotifyIds.add(item.track.id)
          }
        })
      }
      
      // For incremental sync, filter out tracks already synced and check if we've gone past our last track
      let newItems = data.items
      if (!isFullSync && lastSyncTime) {
        const lastSyncDate = new Date(lastSyncTime)
        
        // Debug: Log what we're comparing
        console.log(`\n=== INCREMENTAL SYNC DEBUG ===`)
        console.log(`Last track timestamp: ${lastSyncTime}`)
        console.log(`Last track as Date: ${lastSyncDate.toISOString()}`)
        console.log(`Fetched ${data.items.length} tracks from Spotify`)
        
        // Log first 3 tracks for debugging
        if (data.items.length > 0) {
          console.log(`\nFirst 3 tracks from Spotify:`)
          data.items.slice(0, 3).forEach((item: any, idx: number) => {
            const trackAddedAt = new Date(item.added_at)
            const isNewer = trackAddedAt > lastSyncDate
            console.log(`  ${idx + 1}. "${item.track.name}" by ${item.track.artists[0].name}`)
            console.log(`     added_at: ${item.added_at}`)
            console.log(`     as Date: ${trackAddedAt.toISOString()}`)
            console.log(`     > lastTrack? ${isNewer}`)
          })
        }
        
        // Filter for tracks newer than our last synced track
        // Note: Using > (not >=) to avoid duplicate of the last track
        newItems = data.items.filter((item: any) => {
          const addedAt = new Date(item.added_at)
          const isNewer = addedAt > lastSyncDate
          
          // Count tracks that are older/equal to determine when to stop
          if (!isNewer) {
            olderTracksCount++
            if (olderTracksCount <= 5) {
              console.log(`📍 Found track ${olderTracksCount} older/equal to last sync: "${item.track.name}"`)
              console.log(`   added_at: ${item.added_at} <= ${lastSyncTime}`)
            }
          }
          
          return isNewer
        })
        
        console.log(`Filtered result: ${newItems.length} new tracks`)
        console.log(`=== END DEBUG ===\n`)
      }
      
      allChunkTracks = allChunkTracks.concat(newItems)
      
      // Set total on first fetch
      if (totalTracks === null) {
        totalTracks = data.total
        await supabaseClient
          .from('sync_progress')
          .update({ total_tracks: totalTracks })
          .eq('sync_id', syncId)
        console.log(`📊 Total tracks to sync: ${totalTracks}`)
      }

      currentOffset += data.items.length
      hasMore = data.next !== null

      // Process chunk if we have enough tracks or reached the end
      if (allChunkTracks.length >= CHUNK_SIZE || (!hasMore && allChunkTracks.length > 0)) {
        // Deduplicate tracks within chunk by spotify_id (keep first occurrence = most recently added)
        const seenIds = new Set<string>()
        const dedupedChunkTracks = allChunkTracks.filter(item => {
          const spotifyId = item.track?.id
          if (!spotifyId || seenIds.has(spotifyId)) {
            if (spotifyId) duplicatesRemoved++
            return false
          }
          seenIds.add(spotifyId)
          return true
        })
        if (dedupedChunkTracks.length < allChunkTracks.length) {
          console.log(`🔀 Removed ${allChunkTracks.length - dedupedChunkTracks.length} duplicate tracks from chunk`)
        }
        allChunkTracks = dedupedChunkTracks

        console.log(`🔄 Processing chunk of ${allChunkTracks.length} tracks`)

        // Extract artist IDs and fetch genres
        const artistIds = extractUniqueArtistIds(allChunkTracks)
        console.log(`Found ${artistIds.length} unique artists for this chunk`)

        const { genreMap: artistGenreMap, cacheHits: chunkCacheHits, apiFetches: chunkApiFetches } = await getArtistGenresWithCache(accessToken, artistIds, supabaseClient)
        totalCacheHits += chunkCacheHits
        totalApiFetches += chunkApiFetches

        // Accumulate genre health-check stats
        for (const genres of artistGenreMap.values()) {
          healthArtistTotal++
          if (genres.length > 0) healthArtistWithGenres++
        }

        // Process songs data
        const songsToInsert = processSongsData(allChunkTracks, user.id, artistGenreMap, new Map(), genreMapping)
        newTracksCount += songsToInsert.length

        // For incremental sync, fetch existing tracks with manual genre overrides from DB
        // For full sync, use the cached map from before deletion
        if (!isFullSync) {
          const spotifyIds = songsToInsert.map(s => s.spotify_id)
          const { data: existingTracks } = await supabaseClient
            .from('spotify_liked')
            .select('spotify_id, super_genre')
            .eq('user_id', user.id)
            .in('spotify_id', spotifyIds)
            .eq('super_genre_manual_override', true)
          
          // Add to manual genre map
          if (existingTracks) {
            existingTracks.forEach(track => {
              if (track.super_genre) {
                manualGenreMap.set(track.spotify_id, track.super_genre)
              }
            })
          }
        }
        
        // Use the cached/fetched manual genre map to preserve super_genre assignments
        const songsToUpsert = songsToInsert.map(song => {
          if (manualGenreMap.has(song.spotify_id)) {
            // Use the cached manual genre assignment instead of the auto-mapped one
            return {
              ...song,
              super_genre: manualGenreMap.get(song.spotify_id),
              super_genre_manual_override: true
            }
          }
          return song
        })
        
        // PHASE 1: Enhanced logging for genre restoration
        const restoredCount = songsToUpsert.filter(s => manualGenreMap.has(s.spotify_id)).length
        if (restoredCount > 0) {
          console.log(`✅ PHASE 1: Restored ${restoredCount} cached genre assignments in this batch`)
          // Log sample restorations
          const restoredSamples = songsToUpsert
            .filter(s => manualGenreMap.has(s.spotify_id))
            .slice(0, 3)
          console.log(`📋 PHASE 1: Sample restored tracks:`)
          restoredSamples.forEach((track, idx) => {
            console.log(`   ${idx + 1}. "${track.title}" by ${track.artist} -> ${track.super_genre}`)
          })
        } else if (manualGenreMap.size > 0) {
          console.log(`⚠️  PHASE 1: Cache has ${manualGenreMap.size} genres, but 0 restored in this batch`)
        }

        const { error: insertError } = await supabaseAdmin
          .from('spotify_liked')
          .upsert(songsToUpsert, {
            onConflict: 'user_id,spotify_id',
            ignoreDuplicates: false
          })

        if (insertError) {
          console.error('Insert error:', insertError)
          
          // Update sync status to failed
          await supabaseClient
            .from('sync_progress')
            .update({
              status: 'failed',
              error_message: `Database insert error: ${insertError.message}`
            })
            .eq('sync_id', syncId)

          throw new Error(`Failed to insert songs: ${insertError.message}`)
        }

        // Update progress
        await supabaseClient
          .from('sync_progress')
          .update({
            tracks_fetched: currentOffset,
            tracks_processed: currentOffset,
            last_offset: currentOffset,
            new_tracks_added: newTracksCount
          })
          .eq('sync_id', syncId)

        console.log(`✅ Processed ${currentOffset}/${totalTracks} tracks (${newTracksCount} new)`)

        // Clear chunk for next iteration
        allChunkTracks = []
      }
      
      // For incremental sync, stop when we've found enough tracks older than our last synced track
      // This means we've processed all new tracks (stop after finding 50 older tracks to be safe)
      if (!isFullSync && lastSyncTime && olderTracksCount >= 50) {
        console.log(`✅ Reached 50+ tracks older than last sync - all new tracks have been processed`)
        hasMore = false
        break
      }

      // Break if we've processed everything
      if (!hasMore) break
    }

    // Process any remaining tracks that didn't reach CHUNK_SIZE
    if (allChunkTracks.length > 0) {
      // Deduplicate final batch by spotify_id (keep first occurrence = most recently added)
      const seenIds = new Set<string>()
      const dedupedFinalTracks = allChunkTracks.filter(item => {
        const spotifyId = item.track?.id
        if (!spotifyId || seenIds.has(spotifyId)) {
          if (spotifyId) duplicatesRemoved++
          return false
        }
        seenIds.add(spotifyId)
        return true
      })
      if (dedupedFinalTracks.length < allChunkTracks.length) {
        console.log(`🔀 Removed ${allChunkTracks.length - dedupedFinalTracks.length} duplicate tracks from final batch`)
      }
      allChunkTracks = dedupedFinalTracks

      console.log(`🔄 Processing final batch of ${allChunkTracks.length} remaining tracks`)

      // Extract artist IDs and fetch genres
      const artistIds = extractUniqueArtistIds(allChunkTracks)
      console.log(`Found ${artistIds.length} unique artists for final batch`)

      const { genreMap: artistGenreMap, cacheHits: finalCacheHits, apiFetches: finalApiFetches } = await getArtistGenresWithCache(accessToken, artistIds, supabaseClient)
      totalCacheHits += finalCacheHits
      totalApiFetches += finalApiFetches

      // Accumulate genre health-check stats
      for (const genres of artistGenreMap.values()) {
        healthArtistTotal++
        if (genres.length > 0) healthArtistWithGenres++
      }

      // Process songs data
      const songsToInsert = processSongsData(allChunkTracks, user.id, artistGenreMap, new Map(), genreMapping)
      
      // For incremental sync, fetch existing tracks with manual genre overrides from DB
      if (!isFullSync) {
        const spotifyIds = songsToInsert.map(s => s.spotify_id)
        const { data: existingTracks } = await supabaseClient
          .from('spotify_liked')
          .select('spotify_id, super_genre')
          .eq('user_id', user.id)
          .in('spotify_id', spotifyIds)
          .eq('super_genre_manual_override', true)
        
        if (existingTracks) {
          existingTracks.forEach(track => {
            if (track.super_genre) {
              manualGenreMap.set(track.spotify_id, track.super_genre)
            }
          })
        }
      }
      
      // Preserve manual genre assignments
      const songsToUpsert = songsToInsert.map(song => {
        if (manualGenreMap.has(song.spotify_id)) {
          return { ...song, super_genre: manualGenreMap.get(song.spotify_id), super_genre_manual_override: true }
        }
        return song
      })

      // Insert/upsert the final batch
      const { error: insertError } = await supabaseAdmin
        .from('spotify_liked')
        .upsert(songsToUpsert, {
          onConflict: 'user_id,spotify_id',
          ignoreDuplicates: false
        })

      if (insertError) {
        console.error('Insert error for final batch:', insertError)
        throw new Error(`Failed to insert final batch: ${insertError.message}`)
      }

      newTracksCount += songsToUpsert.length
      console.log(`✅ Processed final batch of ${songsToUpsert.length} tracks`)

      // Update final progress
      await supabaseClient
        .from('sync_progress')
        .update({
          tracks_processed: currentOffset,
          new_tracks_added: newTracksCount
        })
        .eq('sync_id', syncId)
    }

    // Deletion detection: Remove tracks that are no longer in Spotify (only for full sync)
    let deletedTracksCount = 0
    if (isFullSync && allSpotifyIds.size > 0) {
      console.log(`🔍 Checking for deleted tracks (full sync with ${allSpotifyIds.size} Spotify tracks)`)
      
      // Get all user's tracks from database
      const { data: dbTracks, error: fetchError } = await supabaseClient
        .from('spotify_liked')
        .select('id, spotify_id, title, artist')
        .eq('user_id', user.id)
      
      if (fetchError) {
        console.error('Error fetching database tracks for deletion check:', fetchError)
      } else if (dbTracks) {
        // Find tracks in DB that are NOT in Spotify anymore
        const tracksToDelete = dbTracks.filter(track => !allSpotifyIds.has(track.spotify_id))
        
        if (tracksToDelete.length > 0) {
          console.log(`🗑️  Found ${tracksToDelete.length} tracks to delete:`)
          tracksToDelete.slice(0, 5).forEach(track => {
            console.log(`   - "${track.title}" by ${track.artist}`)
          })
          if (tracksToDelete.length > 5) {
            console.log(`   ... and ${tracksToDelete.length - 5} more`)
          }
          
          // Delete tracks that are no longer in Spotify
          const idsToDelete = tracksToDelete.map(t => t.id)
          const { error: deleteError } = await supabaseClient
            .from('spotify_liked')
            .delete()
            .in('id', idsToDelete)
          
          if (deleteError) {
            console.error('Error deleting removed tracks:', deleteError)
          } else {
            deletedTracksCount = tracksToDelete.length
            console.log(`✅ Successfully deleted ${deletedTracksCount} tracks that were unliked in Spotify`)
          }
        } else {
          console.log(`✅ No tracks to delete - database is in sync with Spotify`)
        }
      }
    } else if (!isFullSync) {
      console.log(`⏭️  Skipping deletion detection (incremental sync - only checks new tracks)`)
    }

    // PHASE 1: Post-sync verification - check if genres were properly restored
    let verificationWarnings: string[] = []
    if (isFullSync && manualGenreMap.size > 0) {
      console.log(`\n🔍 PHASE 1: POST-SYNC VERIFICATION`)
      console.log(`Expected ${manualGenreMap.size} tracks to have genres restored`)
      
      // Query tracks in batches (PostgREST has a limit on IN clause size)
      const spotifyIdsToCheck = Array.from(manualGenreMap.keys())
      const BATCH_SIZE = 100
      let allVerifyTracks: any[] = []
      
      for (let i = 0; i < spotifyIdsToCheck.length; i += BATCH_SIZE) {
        const batch = spotifyIdsToCheck.slice(i, i + BATCH_SIZE)
        const { data: batchTracks, error: batchError } = await supabaseClient
          .from('spotify_liked')
          .select('spotify_id, super_genre, title, artist')
          .eq('user_id', user.id)
          .in('spotify_id', batch)
        
        if (batchError) {
          console.error(`⚠️  Verification batch ${i / BATCH_SIZE + 1} failed:`, batchError)
        } else if (batchTracks) {
          allVerifyTracks = allVerifyTracks.concat(batchTracks)
        }
      }
      
      const foundSpotifyIds = new Set(allVerifyTracks.map(t => t.spotify_id))
      const notFoundCount = spotifyIdsToCheck.length - allVerifyTracks.length
      
      if (notFoundCount > 0) {
        console.log(`⚠️  ${notFoundCount} cached tracks not found in Spotify (likely unliked)`)
      }
      
      const missingGenres = allVerifyTracks.filter(t => !t.super_genre)
      const hasGenres = allVerifyTracks.filter(t => t.super_genre)
      
      console.log(`✅ Verification: ${hasGenres.length}/${allVerifyTracks.length} genres successfully restored`)
      
      if (missingGenres.length > 0) {
        console.error(`❌ VERIFICATION FAILED: ${missingGenres.length} tracks lost their genre assignments!`)
        console.log(`Missing genre tracks (first 5):`)
        missingGenres.slice(0, 5).forEach((track, idx) => {
          const expectedGenre = manualGenreMap.get(track.spotify_id)
          console.log(`   ${idx + 1}. "${track.title}" by ${track.artist}`)
          console.log(`      spotify_id: ${track.spotify_id}`)
          console.log(`      Expected: ${expectedGenre}, Got: null`)
        })
        verificationWarnings.push(`${missingGenres.length} tracks lost genre assignments`)
      } else {
        console.log(`🎉 All found tracks have their genres restored!`)
      }
    }

    // Log cache efficiency summary
    const totalArtistsLookedUp = totalCacheHits + totalApiFetches
    if (totalArtistsLookedUp > 0) {
      const hitRate = Math.round((totalCacheHits / totalArtistsLookedUp) * 100)
      console.log(`[CACHE STATS] Artist genres: ${totalCacheHits} cache hits, ${totalApiFetches} API calls (${hitRate}% cache hit rate — ${totalApiFetches} Spotify requests saved by cache)`)
    }

    // Genre health-check: warn if all artists returned empty genre arrays across the full run
    const MIN_ARTISTS_FOR_HEALTH_CHECK = 20
    let genreHealthWarning: string | undefined
    if (healthArtistTotal >= MIN_ARTISTS_FOR_HEALTH_CHECK && healthArtistWithGenres === 0) {
      genreHealthWarning = `All ${healthArtistTotal} artists returned empty genre arrays during this sync. The Spotify artist genres field may have been silently removed. Genre auto-mapping will not work until resolved — use AI genre classification as a fallback.`
      console.warn(`[GENRE HEALTH CHECK] ${genreHealthWarning}`)
    } else if (healthArtistTotal > 0) {
      console.log(`[GENRE HEALTH CHECK] ${healthArtistWithGenres}/${healthArtistTotal} artists have genres (${Math.round((healthArtistWithGenres / healthArtistTotal) * 100)}%)`)
    }

    // Mark sync as completed with timestamp
    await supabaseClient
      .from('sync_progress')
      .update({
        status: 'completed',
        tracks_fetched: currentOffset,
        tracks_processed: currentOffset,
        new_tracks_added: newTracksCount,
        last_sync_completed_at: new Date().toISOString()
      })
      .eq('sync_id', syncId)

    const syncType = isFullSync ? 'Full' : 'Incremental'
    const baseMessage = isFullSync 
      ? `${currentOffset} tracks synced`
      : `${newTracksCount} new tracks added`
    
    const deletionMessage = deletedTracksCount > 0
      ? `, ${deletedTracksCount} removed`
      : ''

    const dupsMessage = duplicatesRemoved > 0
      ? `, ${duplicatesRemoved} duplicates skipped`
      : ''

    const message = `${syncType} sync complete: ${baseMessage}${deletionMessage}${dupsMessage}`
    
    console.log(`🎉 ${message}`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        message,
        total_songs: totalTracks,
        processed_songs: currentOffset,
        new_tracks_added: newTracksCount,
        deleted_tracks: deletedTracksCount,
        sync_type: syncType,
        sync_id: syncId,
        duplicates_removed: duplicatesRemoved,
        genres_cached: manualGenreMap.size,
        verification_warnings: verificationWarnings.length > 0 ? verificationWarnings : undefined,
        genre_health_warning: genreHealthWarning,
        genre_cache_stats: {
          cache_hits: totalCacheHits,
          api_fetches: totalApiFetches,
          hit_rate_pct: totalCacheHits + totalApiFetches > 0
            ? Math.round((totalCacheHits / (totalCacheHits + totalApiFetches)) * 100)
            : null
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Spotify sync error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Handle specific Spotify errors with proper status codes
    if (errorMessage.includes('refresh token is invalid') ||
        errorMessage.includes('Spotify connection has expired')) {
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    if (errorMessage.includes('Spotify token invalid') ||
        errorMessage.includes('403')) {
      return new Response(
        JSON.stringify({ error: 'Spotify authentication expired. Please disconnect and reconnect your Spotify account.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})