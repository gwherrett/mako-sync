import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPER_GENRES = [
  'Bass',
  'Blues',
  'Books & Spoken',
  'Country',
  'Dance',
  'Disco',
  'Drum & Bass',
  'Electronic',
  'Folk',
  'Hip Hop',
  'House',
  'Indie-Alternative',
  'Jazz',
  'Latin',
  'Metal',
  'Orchestral',
  'Other',
  'Pop',
  'Reggae-Dancehall',
  'Rock',
  'Seasonal',
  'Soul-Funk',
  'UK Garage',
  'Urban',
  'World'
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { title, artist, album, libraryContext, sampleTracks, trackCount, year } = body;
    
    // Artist-level mode vs track-level mode
    const isArtistMode = sampleTracks && trackCount;
    
    console.log('AI Track Genre Suggest - Input:', { 
      mode: isArtistMode ? 'artist' : 'track',
      artist, 
      title, 
      trackCount,
      sampleTracksCount: sampleTracks?.length 
    });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Build context message
    let contextMessage = '';
    if (libraryContext) {
      if (libraryContext.sameArtistTracks?.length > 0) {
        contextMessage += `\n\nUser's library context for ${artist}:\n`;
        contextMessage += `- Has ${libraryContext.sameArtistTracks.length} other tracks by this artist\n`;
        
        // Show which genres exist (not counts) - strongly emphasize consistency
        const existingGenres = new Set<string>();
        libraryContext.sameArtistTracks.forEach((track: any) => {
          if (track.super_genre) {
            existingGenres.add(track.super_genre);
          }
        });
        if (existingGenres.size > 0) {
          contextMessage += `- This artist's existing tracks are in: ${Array.from(existingGenres).join(', ')}\n`;
          contextMessage += `- IMPORTANT: Strongly prefer consistency with existing genres for this artist\n`;
        }
      }
      if (libraryContext.libraryPatterns) {
        contextMessage += `\n${libraryContext.libraryPatterns}`;
      }
    }

    const systemPrompt = `You are a music genre classification expert. Your task is to suggest ONE Common Genre from this list:
${SUPER_GENRES.join(', ')}

Analyze the ${isArtistMode ? 'artist' : 'track'} information and user's library patterns to make a personalized, accurate suggestion.

IMPORTANT GENRE RULES:

TIME PERIOD RULES:
- Pre-1970 soul → Soul-Funk
- R&B released ≤ 1990 → Soul-Funk
- R&B released > 1990 → Urban
- 80s synth pop → Pop (not Electronic)

GENRE-SPECIFIC RULES:
- For R&B, Contemporary R&B, and similar urban soul music: Always use "Urban" instead of "Soul-Funk"
- Soul-Funk should be reserved for classic funk and vintage soul from the 60s-80s
- Urban covers modern R&B, contemporary soul, and urban contemporary styles
- For disco with electronic elements → House (not Disco)
- For boom bap hip hop → Hip Hop (not Urban)
- For tracks with alternative or indie feel → Indie-Alternative

TRACK/ALBUM TITLE PATTERNS:
- Tracks with "Remix" in title → try to preserve the original track's genre
- Tracks with "Dub Remix" or "dub mix" → map to original track's genre (if unknown, use AI judgment)
- Live albums → reference studio version genre if known

ARTIST-BASED HINTS:
- Artists with "DJ" prefix → likely Dance/House/Electronic
- Classical composers → Orchestral

REGIONAL PATTERNS:
- UK drill → Hip Hop
- Afrobeats → World (not Hip Hop)

PRIORITY GENRES:
- House is extremely important - be precise with House classifications
- When in doubt between House and similar genres (Dance, Electronic, Disco), favor House if it fits

USER'S COLLECTION CONTEXT:
- Use the user's existing artist genre mappings as strong signals
- If the user has other tracks by this artist, strongly prefer consistency with those genres
- DO NOT use relative genre counts as a signal - only use which genres exist

You must respond with a JSON object in this exact format:
{
  "suggestedGenre": "one of the genres from the list",
  "confidence": number between 0-100,
  "reasoning": "brief explanation of why this genre fits, considering the user's library patterns"
}`;

    let userPrompt = '';
    if (isArtistMode) {
      const tracksList = sampleTracks.slice(0, 10).map((t: any) => `  - "${t.title}"${t.album ? ` (${t.album})` : ''}${t.year ? ` [${t.year}]` : ''}`).join('\n');
      userPrompt = `Artist: ${artist}
Sample tracks (${sampleTracks.length} of ${trackCount} total):
${tracksList}${contextMessage}

Based on this artist's music and the user's library, which ONE Common Genre best represents ${artist}? This will be applied to all ${trackCount} tracks by this artist.`;
    } else {
      userPrompt = `Track: "${title}"
Artist: ${artist}${album ? `\nAlbum: ${album}` : ''}${year ? `\nRelease Year: ${year}` : ''}${contextMessage}

Based on this information, which Common Genre best fits this track?`;
    }

    console.log('Calling Lovable AI...');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits to your Lovable AI workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('Lovable AI error:', response.status, errorText);
      throw new Error(`Lovable AI request failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content in AI response');
    }

    console.log('AI Response:', content);

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON from AI response');
    }

    const suggestion = JSON.parse(jsonMatch[0]);

    // Validate suggestion
    if (!SUPER_GENRES.includes(suggestion.suggestedGenre)) {
      console.warn('Invalid genre suggested, defaulting to Other:', suggestion.suggestedGenre);
      suggestion.suggestedGenre = 'Other';
    }

    return new Response(
      JSON.stringify(suggestion),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ai-track-genre-suggest:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

