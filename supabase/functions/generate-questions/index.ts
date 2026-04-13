/// <reference path="../deno.d.ts" />
// ============================================
// Edge Function: generate-questions
// Generates multi-round interview questions using OpenRouter LLM
// Supports: Aptitude (MCQ), Technical, Coding, HR rounds
// Uses JD text + wizard round config for tailored generation
// ============================================

// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req: Request) => {
  console.log(`generate-questions: Received ${req.method} request`);

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
        console.log(`generate-questions: Authenticated user ${userId}`);
      } catch (e) {
        console.warn('generate-questions: Failed to parse token but proceeding anyway (probable clock skew)');
      }
    }

    if (!userId && fallbackUserId) {
      console.log(`generate-questions: Using fallback userId from header: ${fallbackUserId}`);
      userId = fallbackUserId;
    }

    if (!userId) {
      console.log('generate-questions: No valid userId found - using guest fallback');
      userId = 'guest';
    }

    // Parse request
    const { session_id, job_role, company_type, difficulty, count, jd_text, jd_analysis, include_coding, rounds } = await req.json();

    if (!session_id || !job_role || !difficulty) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use admin client to verify session belongs to user
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .select('id, user_id')
      .eq('id', session_id)
      .eq('user_id', userId)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Sanitize inputs ──
    const sanitizedRole = String(job_role).replace(/<[^>]*>/g, '').substring(0, 100);
    const sanitizedCompany = company_type === 'mnc' ? 'MNC/Enterprise'
      : company_type === 'faang' ? 'FAANG/Big Tech'
      : 'Startup';
    const sanitizedDifficulty = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';

    // ── Determine round structure from wizard config ──
    // Frontend sends: rounds: [{ id: 'aptitude', questionCount: 4 }, ...]
    // Fallback to defaults if not provided
    const defaultRounds = [
      { id: 'aptitude', label: 'Aptitude', questionCount: 4, type: 'mcq' },
      { id: 'technical', label: 'Technical', questionCount: 3, type: 'text' },
      ...(include_coding !== false ? [{ id: 'coding', label: 'Coding', questionCount: 2, type: 'code' }] : []),
      { id: 'hr', label: 'HR', questionCount: 2, type: 'text' },
    ];
    const activeRounds: { id: string; label?: string; questionCount: number; type?: string; isCustom?: boolean }[] = Array.isArray(rounds) && rounds.length > 0
      ? rounds
      : defaultRounds;

    console.log('generate-questions: Active rounds:', JSON.stringify(activeRounds));

    // ── Build JD context ──
    let skillsContext = '';
    if (jd_analysis && jd_analysis.required_skills && jd_analysis.required_skills.length > 0) {
      skillsContext = `\n### Required Skills from JD:\n${jd_analysis.required_skills.join(', ')}`;
    }
    let jdContext = '';
    if (jd_text) {
      const truncatedJD = String(jd_text).substring(0, 2500);
      jdContext = `\n### Full Job Description:\n${truncatedJD}`;
    }
    let responsibilitiesContext = '';
    if (jd_analysis && jd_analysis.key_responsibilities && jd_analysis.key_responsibilities.length > 0) {
      responsibilitiesContext = `\n### Key Responsibilities from JD:\n${jd_analysis.key_responsibilities.join('\n- ')}`;
    }

    const hasJD = !!(jd_text && jd_text.trim().length > 20);

    // ── Build round instructions ──
    const roundInstructions: string[] = [];
    let roundNumber = 1;

    for (const round of activeRounds) {
      const rLabel = round.label || round.id;
      const rType = round.type || 'text';
      
      let roundDesc = `\n${roundNumber}. **${rLabel} Round** (${round.questionCount} ${rType.toUpperCase()} questions):`;
      
      if (round.id === 'aptitude') {
        roundDesc += `
   - Logical reasoning, quantitative aptitude, pattern recognition relevant to ${hasJD ? 'the JD context' : `a ${sanitizedRole} role`}
   - Each question MUST have exactly 4 options (A, B, C, D) with ONE correct answer
   - Questions should test analytical thinking in a professional context
   ${hasJD ? '- If the JD mentions domain-specific concepts, include aptitude questions relevant to that domain' : ''}`;
      } else if (round.id === 'technical') {
        roundDesc += `
   ${hasJD
     ? `- Generate questions DIRECTLY from the skills and technologies mentioned in the JD
   - Each question should target a specific skill from: ${jd_analysis?.required_skills?.slice(0, 8).join(', ') || sanitizedRole}
   - Ask about real-world scenarios using those specific technologies`
     : `- Core technical questions for a ${sanitizedRole} position
   - Theory + practical scenario-based questions`}
   - Difficulty: ${sanitizedDifficulty === 'easy' ? 'Focus on fundamental concepts and definitions' : sanitizedDifficulty === 'medium' ? 'Include scenario-based and intermediate concepts' : 'Include system design, advanced architecture, and complex problem-solving'}
   ${company_type === 'faang' ? '- Include at least one system design or scalability question' : ''}`;
      } else if (round.id === 'coding') {
        roundDesc += `
   - Practical algorithmic and data structure coding challenges
   ${hasJD ? `- Use the tech stack from the JD (e.g., ${jd_analysis?.required_skills?.filter((s: string) => /python|java|javascript|react|node|sql|c\+\+|go|rust|typescript/i.test(s)).join(', ') || sanitizedRole})` : `- Relevant to ${sanitizedRole} role`}
   - ${sanitizedDifficulty === 'easy' ? 'Basic array/string manipulation' : sanitizedDifficulty === 'medium' ? 'Data structures and algorithmic thinking' : 'Complex algorithms, optimization, or system design code'}
   ${company_type === 'faang' ? '- Focus on DSA problems similar to LeetCode medium/hard' : ''}
   - You MUST provide structured \`coding_metadata\` for these questions including detailed constraints and exact test cases with input and expected output strings.`;
      } else if (round.id === 'hr') {
        roundDesc += `
   - Behavioral and situational interview questions
   - Questions about teamwork, leadership, conflict resolution, career goals
   - Tailored for a ${sanitizedCompany} company context
   ${hasJD ? '- Reference specific responsibilities from the JD where relevant' : ''}`;
      } else {
        // Custom round mapping
        roundDesc += `
   - This is a custom ${rLabel} round.
   - Questions must be directly relevant to a ${sanitizedRole} role at a ${sanitizedCompany} company.
   - Ensure questions align with the requested format: ${rType}.`;
      }

      if (rType === 'mcq' && round.id !== 'aptitude') {
         roundDesc += `\n   - Each question MUST have exactly 4 options (A, B, C, D) with ONE correct answer`;
      }

      roundInstructions.push(roundDesc);
      roundNumber++;
    }

    // ── Build the final prompt ──
    const prompt = `You are an expert technical interviewer and interview coach.

${hasJD ? `### CRITICAL INSTRUCTION ###
A specific Job Description (JD) has been provided below. You MUST:
1. Generate questions that are DIRECTLY tailored to the skills, tools, frameworks, and responsibilities in this JD
2. DO NOT provide generic role-based questions — focus intensely on what the JD specifies
3. If the JD mentions specific technologies (e.g., React, AWS, PostgreSQL), EVERY technical question should reference them
4. Extract the core competencies from the JD and test each one
${skillsContext}${responsibilitiesContext}${jdContext}
` : `You are specializing in ${sanitizedRole} positions at ${sanitizedCompany} companies.`}

Generate a complete multi-round interview question set for a **${sanitizedDifficulty}-level ${sanitizedRole}** position at a **${sanitizedCompany}** company.

**Round Structure:**
${roundInstructions.join('\n')}

**Company Context (${sanitizedCompany}):**
${company_type === 'startup' ? '- Focus on versatility, hands-on experience, scrappy problem-solving, and wearing multiple hats' :
  company_type === 'faang' ? '- Focus on scalability, system design, algorithmic efficiency, and large-scale distributed systems' :
  '- Focus on best practices, cross-team collaboration, process-driven approaches, and enterprise patterns'}

Return ONLY a JSON object with this exact structure:
{
  "rounds": [
    {
      "round_type": "string (the round identifier)",
      "round_label": "string (Human readable label of the round)",
      "questions": [
        { 
           "text": "question text", 
           "type": "mcq|text|code|voice", 
           "options": ["A) ...", "B) ...", "C) ...", "D) ..."], 
           "correct": "A",
           "coding_metadata": {
             "title": "string",
             "description": "string",
             "inputFormat": "string",
             "outputFormat": "string",
             "constraints": "string",
             "sampleInput": "string",
             "sampleOutput": "string",
             "testCases": [ { "input": "string", "expected": "string" } ]
           }
        }
      ]
    }
  ]
}

IMPORTANT: For MCQ questions, "options" and "correct" fields are required. For text/voice questions, omit "options", "correct", and "coding_metadata". For code questions, "coding_metadata" is heavily required.`;

    console.log('generate-questions: Prompt length:', prompt.length);
    console.log('generate-questions: Has JD:', hasJD);
    console.log('generate-questions: Rounds requested:', activeRounds.map(r => `${r.id}(${r.questionCount})`).join(', '));

    // ── Call OpenRouter API ──
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      return new Response(JSON.stringify({ error: 'OpenRouter API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const llmResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': Deno.env.get('SUPABASE_URL') || '',
        'X-Title': 'InterviewAI',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [
          { role: 'system', content: 'You are an expert interview coach. Always respond with valid JSON containing multi-round interview questions. Follow the round structure and question counts EXACTLY as specified.' },
          { role: 'user', content: prompt }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'multi_round_questions',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                rounds: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      round_type: { type: 'string' },
                      round_label: { type: 'string' },
                      questions: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            text: { type: 'string' },
                            type: { type: 'string' },
                            options: { type: 'array', items: { type: 'string' } },
                            correct: { type: 'string' },
                            coding_metadata: {
                              type: 'object',
                              properties: {
                                title: { type: 'string' },
                                description: { type: 'string' },
                                inputFormat: { type: 'string' },
                                outputFormat: { type: 'string' },
                                constraints: { type: 'string' },
                                sampleInput: { type: 'string' },
                                sampleOutput: { type: 'string' },
                                testCases: {
                                  type: 'array',
                                  items: {
                                    type: 'object',
                                    properties: {
                                      input: { type: 'string' },
                                      expected: { type: 'string' }
                                    },
                                    required: ['input', 'expected'],
                                    additionalProperties: false
                                  }
                                }
                              },
                              required: ['title', 'description', 'inputFormat', 'outputFormat', 'constraints', 'sampleInput', 'sampleOutput', 'testCases'],
                              additionalProperties: false
                            }
                          },
                          required: ['text', 'type'],
                          additionalProperties: false
                        }
                      }
                    },
                    required: ['round_type', 'round_label', 'questions'],
                    additionalProperties: false
                  }
                }
              },
              required: ['rounds'],
              additionalProperties: false
            }
          }
        },
        temperature: 0.8,
        max_tokens: 5000
      })
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error('OpenRouter error:', errText);
      return new Response(JSON.stringify({ error: 'Failed to generate questions' }), {
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
        // Standard JSON parse
        return JSON.parse(text);
      } catch (e) {
        // If it fails, try to strip markdown code blocks
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            return JSON.parse(jsonMatch[1]);
          } catch (e2) {
            console.error('Failed to parse extracted JSON:', e2);
          }
        }
        
        // Final attempt: find the first { and last }
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          try {
            return JSON.parse(text.substring(start, end + 1));
          } catch (e3) {
            console.error('Failed to parse braced JSON:', e3);
          }
        }
        throw e; // Original error if all fails
      }
    }

    let parsedRounds;
    try {
      const parsed = extractJson(content);
      parsedRounds = parsed.rounds;
      if (!Array.isArray(parsedRounds)) throw new Error('rounds is not an array');
    } catch (e) {
      console.error('Parse error:', e, content);
      return new Response(JSON.stringify({ error: 'Failed to parse AI response' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Flatten rounds into question records with sequential numbering ──
    const questionRecords: any[] = [];
    let questionNumber = 1;

    for (const round of parsedRounds) {
      const roundType = round.round_type || 'general';
      const roundLabel = round.round_label || round.round_type || 'General';

      if (!Array.isArray(round.questions)) continue;

      for (const q of round.questions) {
        const questionType = q.type || 'text';

        const record: any = {
          session_id: session_id,
          question_number: questionNumber++,
          question_text: String(q.text).substring(0, 2000),
          round_type: roundType,
          round_label: roundLabel,
          question_type: questionType,
        };

        // Add MCQ-specific fields
        if (questionType === 'mcq' && Array.isArray(q.options)) {
          record.mcq_options = q.options.map((opt: string, i: number) => ({
            label: String.fromCharCode(65 + i), // A, B, C, D
            text: String(opt).replace(/^[A-D]\)\s*/, '').substring(0, 500) // Strip "A) " prefix if present
          }));
          record.correct_answer = String(q.correct || 'A').substring(0, 1).toUpperCase();
        }

        // Add Coding-specific fields
        if (questionType === 'code' && q.coding_metadata) {
          record.coding_metadata = q.coding_metadata;
        }

        questionRecords.push(record);
      }
    }

    if (questionRecords.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid questions generated' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`generate-questions: Inserting ${questionRecords.length} questions (${parsedRounds.length} rounds)`);

    const { data: insertedQuestions, error: insertError } = await supabaseAdmin
      .from('questions')
      .insert(questionRecords)
      .select();

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to save questions' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ questions: insertedQuestions }), {
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
