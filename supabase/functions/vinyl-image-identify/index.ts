// deploy
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `You are analyzing a photograph of a vinyl record label — the paper label at the centre of the record.

Extract the following fields from the label:
- artist: The recording artist or band name
- title: The album or release title
- label: The record label name (e.g. ffrr, Factory, Warp)
- catalogue_number: The catalogue or matrix number (often near the centre hole or at the top/bottom of the label)
- year: The year of release or copyright (e.g. from "© 1996" or a pressing date)
- format_hints: Any format or side information visible (e.g. "Side 1", "A", "2xLP", "45 RPM")

Return a JSON object with exactly these keys. Use null for any field you cannot read. Provide a confidence integer (0–100) reflecting overall extraction confidence.

Example output:
{
  "artist": "Orbital",
  "title": "In Sides",
  "label": "ffrr",
  "catalogue_number": "828 727-1",
  "year": 1996,
  "format_hints": "2xLP",
  "confidence": 87
}

If the image is not a vinyl record label, still return the JSON structure with all fields as null and confidence 0.`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

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

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    let body: { image_base64?: string; mime_type?: string }
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { image_base64, mime_type } = body
    if (!image_base64 || !mime_type) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: image_base64, mime_type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!supportedTypes.includes(mime_type)) {
      return new Response(
        JSON.stringify({ error: `Unsupported mime_type. Use one of: ${supportedTypes.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mime_type,
                  data: image_base64,
                },
              },
              {
                type: 'text',
                text: 'Please extract the release information from this vinyl record label.',
              },
            ],
          },
        ],
      }),
    })

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text()
      console.error('Anthropic API error:', anthropicResponse.status, errText)
      let detail = `Anthropic API ${anthropicResponse.status}`
      try {
        const errJson = JSON.parse(errText)
        if (errJson?.error?.message) detail = errJson.error.message
      } catch { /* not JSON */ }
      return new Response(
        JSON.stringify({ error: 'AI identification failed', detail }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const anthropicData = await anthropicResponse.json()
    const content = anthropicData.content?.[0]?.text ?? ''

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('Could not parse JSON from response:', content)
      return new Response(
        JSON.stringify({ error: 'Could not parse AI response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const result = JSON.parse(jsonMatch[0])

    return new Response(
      JSON.stringify({
        artist: result.artist ?? null,
        title: result.title ?? null,
        label: result.label ?? null,
        catalogue_number: result.catalogue_number ?? null,
        year: result.year ?? null,
        format_hints: result.format_hints ?? null,
        confidence: typeof result.confidence === 'number' ? result.confidence : 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (error) {
    console.error('Error in vinyl-image-identify:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
