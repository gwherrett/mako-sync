import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Validation schemas
const VALID_SUPER_GENRES = [
  'Bass', 'Blues', 'Books & Spoken', 'Country', 'Dance', 'Disco',
  'Drum & Bass', 'Electronic', 'Folk', 'Hip Hop', 'House',
  'Indie-Alternative', 'Jazz', 'Latin', 'Metal', 'Orchestral',
  'Other', 'Pop', 'Reggae-Dancehall', 'Rock', 'Seasonal',
  'Soul-Funk', 'UK Garage', 'Urban', 'World'
] as const;

const genreMappingSchema = z.object({
  spotify_genre: z.string()
    .trim()
    .min(1, 'Genre name required')
    .max(100, 'Genre name too long')
    .regex(/^[a-zA-Z0-9\s\-&'.,()!]+$/, 'Invalid characters in genre name'),
  super_genre: z.enum(VALID_SUPER_GENRES, { 
    errorMap: () => ({ message: 'Invalid super genre' }) 
  })
});

const deleteSchema = z.object({
  spotify_genre: z.string()
    .trim()
    .min(1, 'Genre name required')
    .max(100, 'Genre name too long')
});

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Create user-scoped client for user operations
    const userSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Create admin client for base table operations (bypasses RLS)
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get the user from the auth header
    const { data: { user }, error: userError } = await userSupabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Invalid user token');
    }

    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();

    // GET /export - export effective mapping as CSV (check this BEFORE regular GET)
    if (req.method === 'GET' && url.searchParams.get('export') === 'csv') {
      const { data, error } = await userSupabase
        .from('v_effective_spotify_genre_map')
        .select('*')
        .order('spotify_genre');

      if (error) {
        console.error('Error fetching mapping for export:', error);
        throw error;
      }

      // Convert to CSV
      const csvHeader = 'spotify_genre,super_genre,is_overridden\n';
      const csvRows = data.map(row => 
        `"${row.spotify_genre}","${row.super_genre}",${row.is_overridden}`
      ).join('\n');
      const csv = csvHeader + csvRows;

      return new Response(csv, {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="spotify-genre-mapping.csv"'
        },
      });
    }

    // GET /mapping - returns effective mapping for current user
    if (req.method === 'GET' && path === 'genre-mapping') {
      const { data, error } = await userSupabase
        .from('v_effective_spotify_genre_map')
        .select('*')
        .order('spotify_genre');

      if (error) {
        console.error('Error fetching mapping:', error);
        throw error;
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /override - upsert user override
    if (req.method === 'POST') {
      const rawBody = await req.json();
      
      // Validate input
      const validationResult = genreMappingSchema.safeParse(rawBody);
      
      if (!validationResult.success) {
        console.error('Validation failed:', validationResult.error.issues);
        return new Response(
          JSON.stringify({ 
            error: 'Invalid input', 
            details: validationResult.error.issues 
          }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      const { spotify_genre, super_genre } = validationResult.data;

      // Normalize and clean the spotify_genre to handle UTF characters and whitespace
      const cleanedGenre = String(spotify_genre)
        .trim()
        .normalize('NFC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width and BOM characters
        .replace(/\s+/g, ' '); // Normalize multiple spaces to single space

      console.log(`Genre normalization: "${spotify_genre}" (${spotify_genre.length}) -> "${cleanedGenre}" (${cleanedGenre.length})`);

      // Ensure the cleaned spotify_genre exists in the base table first
      const { data: existingGenre, error: checkError } = await adminSupabase
        .from('spotify_genre_map_base')
        .select('spotify_genre')
        .eq('spotify_genre', cleanedGenre)
        .maybeSingle();

      if (checkError) {
        console.error('Error checking existing genre:', checkError);
        throw checkError;
      }

      // If genre doesn't exist in base table, insert it with "Other" as default
      if (!existingGenre) {
        console.log(`Inserting base row for cleaned genre: "${cleanedGenre}"`);
        const { error: baseInsertError } = await adminSupabase
          .from('spotify_genre_map_base')
          .insert({
            spotify_genre: cleanedGenre,
            super_genre: 'Other' // Default value since base table requires non-null
          });

        if (baseInsertError && baseInsertError.code !== '23505') { // Ignore duplicate key errors
          console.error('Error inserting base genre:', baseInsertError);
          throw baseInsertError;
        }
      }

      // Now create/update the user override using the cleaned genre
      const { data, error } = await userSupabase
        .from('spotify_genre_map_overrides')
        .upsert({
          user_id: user.id,
          spotify_genre: cleanedGenre,
          super_genre,
        }, {
          onConflict: 'user_id,spotify_genre'
        })
        .select()
        .single();

      if (error) {
        console.error(`Error upserting override for "${cleanedGenre}":`, error);
        throw error;
      }

      // Propagate the new super_genre to all existing tracks with this genre
      const { error: updateError } = await adminSupabase
        .from('spotify_liked')
        .update({ super_genre })
        .eq('user_id', user.id)
        .eq('genre', cleanedGenre);

      if (updateError) {
        console.error(`Error propagating super_genre update for "${cleanedGenre}":`, updateError);
        throw updateError;
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // DELETE /override - remove user override
    if (req.method === 'DELETE') {
      const rawBody = await req.json();
      
      // Validate input
      const validationResult = deleteSchema.safeParse(rawBody);
      
      if (!validationResult.success) {
        console.error('Validation failed:', validationResult.error.issues);
        return new Response(
          JSON.stringify({ 
            error: 'Invalid input', 
            details: validationResult.error.issues 
          }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      const { spotify_genre } = validationResult.data;

      // Normalize the genre for deletion to match how it was stored
      const cleanedGenre = String(spotify_genre)
        .trim()
        .normalize('NFC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ');

      console.log(`Deleting override for cleaned genre: "${cleanedGenre}"`);

      const { error } = await userSupabase
        .from('spotify_genre_map_overrides')
        .delete()
        .eq('user_id', user.id)
        .eq('spotify_genre', cleanedGenre);

      if (error) {
        console.error(`Error deleting override for "${cleanedGenre}":`, error);
        throw error;
      }

      // Revert tracks to the base mapping's super_genre
      const { data: baseGenre, error: baseError } = await adminSupabase
        .from('spotify_genre_map_base')
        .select('super_genre')
        .eq('spotify_genre', cleanedGenre)
        .maybeSingle();

      if (baseError) {
        console.error(`Error fetching base genre for "${cleanedGenre}":`, baseError);
        throw baseError;
      }

      if (baseGenre) {
        const { error: updateError } = await adminSupabase
          .from('spotify_liked')
          .update({ super_genre: baseGenre.super_genre })
          .eq('user_id', user.id)
          .eq('genre', cleanedGenre);

        if (updateError) {
          console.error(`Error reverting super_genre for "${cleanedGenre}":`, updateError);
          throw updateError;
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid endpoint or method');

  } catch (error) {
    console.error('Error in genre-mapping function:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({
      error: errorMessage || 'Internal server error'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});