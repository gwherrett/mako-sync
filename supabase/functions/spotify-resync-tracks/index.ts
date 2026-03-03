// Deployment test - triggering GitHub Actions

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string; id: string }>;
  album: {
    id: string;
    name: string;
    release_date: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { spotifyIds } = await req.json();
    
    if (!spotifyIds || !Array.isArray(spotifyIds) || spotifyIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'spotifyIds array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Resyncing tracks:', spotifyIds);

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      console.error('User error:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's Spotify connection with decrypted tokens
    const { data: connection, error: connError } = await supabaseClient
      .from('spotify_connections')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', user.id)
      .single();

    if (connError || !connection) {
      console.error('Connection error:', connError);
      return new Response(
        JSON.stringify({ error: 'Spotify not connected' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if token is expired and refresh if needed
    let accessToken = connection.access_token;
    const expiresAt = new Date(connection.expires_at);
    const now = new Date();

    if (expiresAt <= now) {
      console.log('Token expired, refreshing...');
      
      const refreshResponse = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${btoa(`${Deno.env.get('SPOTIFY_CLIENT_ID')}:${Deno.env.get('SPOTIFY_CLIENT_SECRET')}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: connection.refresh_token,
        }),
      });

      if (!refreshResponse.ok) {
        throw new Error('Failed to refresh token');
      }

      const refreshData = await refreshResponse.json();
      accessToken = refreshData.access_token;

      // Update connection with new token
      await supabaseClient
        .from('spotify_connections')
        .update({
          access_token: refreshData.access_token,
          expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
        })
        .eq('user_id', user.id);
    }

    // Fetch track details from Spotify API.
    // NOTE: GET /v1/tracks (batch) has been removed by Spotify. This intentionally
    // uses the single-track endpoint GET /v1/tracks/{id} for each track.
    const results = [];

    for (const spotifyId of spotifyIds) {
      try {
        console.log('Fetching track:', spotifyId);

        const trackResponse = await fetch(
          `https://api.spotify.com/v1/tracks/${spotifyId}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          }
        );

        if (!trackResponse.ok) {
          console.error(`Failed to fetch track ${spotifyId}:`, trackResponse.status);
          results.push({ spotifyId, success: false, error: `HTTP ${trackResponse.status}` });
          continue;
        }

        const track: SpotifyTrack = await trackResponse.json();

        // Update the track in database
        const { error: updateError } = await supabaseClient
          .from('spotify_liked')
          .update({
            title: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            album: track.album.name,
            year: track.album.release_date ? parseInt(track.album.release_date.substring(0, 4)) : null,
          })
          .eq('spotify_id', spotifyId)
          .eq('user_id', user.id);

        if (updateError) {
          console.error(`Failed to update track ${spotifyId}:`, updateError);
          results.push({ spotifyId, success: false, error: updateError.message });
        } else {
          console.log(`Successfully updated track: ${track.name} by ${track.artists[0].name}`);
          results.push({ 
            spotifyId, 
            success: true, 
            title: track.name, 
            artist: track.artists[0].name 
          });
        }
      } catch (error) {
        console.error(`Error processing track ${spotifyId}:`, error);
        results.push({ 
          spotifyId, 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`Resync complete: ${successCount}/${spotifyIds.length} tracks updated`);

    return new Response(
      JSON.stringify({ 
        message: `Resynced ${successCount}/${spotifyIds.length} tracks`,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in spotify-resync-tracks:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
