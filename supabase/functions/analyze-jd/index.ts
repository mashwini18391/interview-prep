/// <reference path="../deno.d.ts" />
// ============================================
// Edge Function: analyze-jd
// Analyzes a Job Description using OpenRouter LLM
// Extracts skills, experience level, responsibilities
// ============================================

// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req: Request) => {
  console.log(`analyze-jd: Received ${req.method} request`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Verify auth - Soft check to handle clock skew
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    const fallbackUserId = req.headers.get('x-user-id');
    let userId: string | null = null;

    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const payload = JSON.parse(atob(token.split('.')[1]));
        userId = payload.sub;
        console.log(`analyze-jd: Authenticated user ${userId}`);
      } catch (e) {
        console.warn('analyze-jd: Failed to parse token but proceeding anyway (probable clock skew)');
      }
    }

    if (!userId && fallbackUserId) {
      console.log(`analyze-jd: Using fallback userId from header: ${fallbackUserId}`);
      userId = fallbackUserId;
    }

    if (!userId && !authHeader) {
      console.log('analyze-jd: No auth header found - proceeding as guest (permitted for analysis)');
    }

    // Parse request
    const { jd_text } = await req.json();

    if (!jd_text || typeof jd_text !== 'string' || jd_text.trim().length < 20) {
      return new Response(JSON.stringify({ error: 'Please provide a valid job description (at least 20 characters)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sanitize and truncate JD text
    const sanitizedJD = String(jd_text).replace(/<[^>]*>/g, '').substring(0, 5000);

    // Build analysis prompt
    const prompt = `Analyze the following Job Description and extract structured information.

**Job Description:**
${sanitizedJD}

Extract the following:
1. **required_skills**: List of specific technical and soft skills mentioned or implied (max 10 skills)
2. **experience_level**: One of "entry", "junior", "mid", "mid-senior", "senior", "lead", "principal"
3. **key_responsibilities**: List of main job responsibilities (max 6 items, brief)
4. **role_type**: The closest matching role from this list: "frontend", "backend", "fullstack", "data-analyst", "data-scientist", "devops", "product-manager", "ui-ux", "mobile", "ml-engineer". Pick the best match.
5. **suggested_difficulty**: Based on experience level — "easy" for entry/junior, "medium" for mid/mid-senior, "hard" for senior/lead/principal
6. **company_type**: Based on the tone and content — "startup" or "mnc"

Return a JSON object with these exact fields.`;

    // Call OpenRouter API
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      return new Response(JSON.stringify({ error: 'OpenRouter API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const MODELS = [
      'google/gemini-2.0-flash-001',
      'google/gemini-flash-1.5-8b',
      'openai/gpt-4o-mini',
      'anthropic/claude-3-haiku'
    ];

    async function callOpenRouter(modelId: string) {
      console.log(`analyze-jd: Attempting analysis with model: ${modelId}`);
      return await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': Deno.env.get('SUPABASE_URL') || '',
          'X-Title': 'InterviewAI',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: 'You are an expert HR analyst. Always respond with valid JSON.' },
            { role: 'user', content: prompt }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'jd_analysis',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  required_skills: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of required skills'
                  },
                  experience_level: {
                    type: 'string',
                    description: 'Experience level: entry, junior, mid, mid-senior, senior, lead, principal'
                  },
                  key_responsibilities: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Key job responsibilities'
                  },
                  role_type: {
                    type: 'string',
                    description: 'Closest matching role type'
                  },
                  suggested_difficulty: {
                    type: 'string',
                    description: 'Suggested difficulty: easy, medium, hard'
                  },
                  company_type: {
                    type: 'string',
                    description: 'Company type: startup or mnc'
                  }
                },
                required: ['required_skills', 'experience_level', 'key_responsibilities', 'role_type', 'suggested_difficulty', 'company_type'],
                additionalProperties: false
              }
            }
          },
          temperature: 0.3,
          max_tokens: 1500
        })
      });
    }

    let llmResponse;
    let lastError = '';

    for (const model of MODELS) {
      try {
        llmResponse = await callOpenRouter(model);
        if (llmResponse.ok) {
          console.log(`analyze-jd: Successfully analyzed with ${model}`);
          break;
        }
        
        const errText = await llmResponse.text();
        lastError = `Model ${model} failed: ${errText}`;
        console.warn(lastError);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        lastError = `Model ${model} threw: ${errorMsg}`;
        console.error(lastError);
      }
    }

    if (!llmResponse || !llmResponse.ok) {
      return new Response(JSON.stringify({ 
        error: 'Failed to analyze job description after multiple attempts',
        details: lastError 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const llmData = await llmResponse.json();
    const content = llmData.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(JSON.stringify({ error: 'Empty response from AI' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    /**
     * Helper to robustly extract JSON from AI response, removing markdown wrappers if present
     */
    function extractJson(text: string) {
      try {
        return JSON.parse(text);
      } catch (e) {
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          try { return JSON.parse(jsonMatch[1]); } catch (e2) { console.error('Failed to parse extracted JSON:', e2); }
        }
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          try { return JSON.parse(text.substring(start, end + 1)); } catch (e3) { console.error('Failed to parse braced JSON:', e3); }
        }
        throw e;
      }
    }

    let analysis;
    try {
      analysis = extractJson(content);

      // Validate and sanitize fields
      analysis.required_skills = Array.isArray(analysis.required_skills)
        ? analysis.required_skills.slice(0, 10).map((s: string) => String(s).substring(0, 100))
        : [];
      analysis.experience_level = String(analysis.experience_level || 'mid').substring(0, 20);
      analysis.key_responsibilities = Array.isArray(analysis.key_responsibilities)
        ? analysis.key_responsibilities.slice(0, 6).map((r: string) => String(r).substring(0, 200))
        : [];
      analysis.role_type = String(analysis.role_type || 'fullstack').substring(0, 30);
      analysis.suggested_difficulty = ['easy', 'medium', 'hard'].includes(analysis.suggested_difficulty)
        ? analysis.suggested_difficulty : 'medium';
      analysis.company_type = ['startup', 'mnc'].includes(analysis.company_type)
        ? analysis.company_type : 'mnc';
    } catch (e) {
      console.error('Parse error:', e, content);
      return new Response(JSON.stringify({ error: 'Failed to parse JD analysis' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(analysis), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

export {};
