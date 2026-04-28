import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const VALID_SUPER_GENRES = [
  'Bass', 'Blues', 'Books & Spoken', 'Country', 'Dance', 'Disco',
  'Drum & Bass', 'Electronic', 'Folk', 'Hip Hop', 'House',
  'Indie-Alternative', 'Jazz', 'Latin', 'Metal', 'Orchestral',
  'Other', 'Pop', 'Reggae-Dancehall', 'Rock', 'Seasonal',
  'Soul-Funk', 'UK Garage', 'Urban', 'World'
] as const;

const overrideSchema = z.object({
  discogs_term: z.string()
    .trim()
    .min(1, 'Term required')
    .max(100, 'Term too long'),
  super_genre: z.enum(VALID_SUPER_GENRES, {
    errorMap: () => ({ message: 'Invalid super genre' })
  })
});

const deleteSchema = z.object({
  discogs_term: z.string()
    .trim()
    .min(1, 'Term required')
    .max(100, 'Term too long')
});

function cleanTerm(raw: string): string {
  return raw
    .trim()
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) throw new Error('No authorization header');

    const userSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userError } = await userSupabase.auth.getUser();
    if (userError || !user) throw new Error('Invalid user token');

    // GET — return effective mapping for user's collection
    if (req.method === 'GET') {
      // Fetch effective mapping (base + overrides) via view
      const { data: mapping, error: mappingError } = await userSupabase
        .from('v_effective_discogs_term_map')
        .select('*')
        .order('term_type')
        .order('discogs_term');

      if (mappingError) throw mappingError;

      // Also find terms in user's collection that aren't in the base table
      const { data: collectionTerms, error: collectionError } = await adminSupabase
        .from('physical_media')
        .select('genres, styles')
        .eq('user_id', user.id);

      if (collectionError) throw collectionError;

      const knownTerms = new Set(mapping?.map(m => m.discogs_term) ?? []);
      const unmapped: Array<{ discogs_term: string; term_type: string; super_genre: null; is_overridden: false }> = [];

      for (const record of collectionTerms ?? []) {
        for (const genre of record.genres ?? []) {
          if (!knownTerms.has(genre)) {
            unmapped.push({ discogs_term: genre, term_type: 'genre', super_genre: null, is_overridden: false });
            knownTerms.add(genre);
          }
        }
        for (const style of record.styles ?? []) {
          if (!knownTerms.has(style)) {
            unmapped.push({ discogs_term: style, term_type: 'style', super_genre: null, is_overridden: false });
            knownTerms.add(style);
          }
        }
      }

      return new Response(JSON.stringify([...(mapping ?? []), ...unmapped]), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST — upsert override or recompute all
    if (req.method === 'POST') {
      const rawBody = await req.json();

      // Special action: recompute all physical_media super_genre for this user
      if (rawBody.action === 'recompute_all') {
        const { error } = await adminSupabase.rpc('recompute_all_discogs_super_genres', {
          p_user_id: user.id
        });
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const result = overrideSchema.safeParse(rawBody);
      if (!result.success) {
        return new Response(
          JSON.stringify({ error: 'Invalid input', details: result.error.issues }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { super_genre } = result.data;
      const discogs_term = cleanTerm(result.data.discogs_term);

      // Upsert override
      const { data, error } = await userSupabase
        .from('discogs_genre_map_overrides')
        .upsert({ user_id: user.id, discogs_term, super_genre }, { onConflict: 'user_id,discogs_term' })
        .select()
        .single();

      if (error) throw error;

      // Recompute super_genre on affected physical_media rows (any record with this term in genres[] or styles[])
      const { error: updateError } = await adminSupabase
        .from('physical_media')
        .update({ super_genre })
        .eq('user_id', user.id)
        .or(`genres.cs.{${discogs_term}},styles.cs.{${discogs_term}}`);

      if (updateError) throw updateError;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // DELETE — remove override and recompute affected rows
    if (req.method === 'DELETE') {
      const rawBody = await req.json();

      const result = deleteSchema.safeParse(rawBody);
      if (!result.success) {
        return new Response(
          JSON.stringify({ error: 'Invalid input', details: result.error.issues }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const discogs_term = cleanTerm(result.data.discogs_term);

      // Remove the override
      const { error: deleteError } = await userSupabase
        .from('discogs_genre_map_overrides')
        .delete()
        .eq('user_id', user.id)
        .eq('discogs_term', discogs_term);

      if (deleteError) throw deleteError;

      // Recompute affected rows using the DB function (which now falls back to base mapping)
      const { data: affected, error: fetchError } = await adminSupabase
        .from('physical_media')
        .select('id, genres, styles')
        .eq('user_id', user.id)
        .or(`genres.cs.{${discogs_term}},styles.cs.{${discogs_term}}`);

      if (fetchError) throw fetchError;

      for (const record of affected ?? []) {
        const { data: resolved } = await adminSupabase.rpc('compute_discogs_super_genre', {
          p_genres: record.genres ?? [],
          p_styles: record.styles ?? [],
          p_user_id: user.id,
        });
        await adminSupabase
          .from('physical_media')
          .update({ super_genre: resolved })
          .eq('id', record.id);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid endpoint or method');

  } catch (error) {
    console.error('Error in discogs-genre-mapping function:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message || 'Internal server error' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
