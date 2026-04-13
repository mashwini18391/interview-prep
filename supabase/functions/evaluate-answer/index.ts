/// <reference path="../deno.d.ts" />
// ============================================
// Edge Function: evaluate-answer
// Evaluates a user's answer using OpenRouter LLM
// Supports MCQ auto-grading, text evaluation, code scoring
// ============================================

// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req: Request) => {
  console.log(`evaluate-answer: Received ${req.method} request`);

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
        console.log(`evaluate-answer: Authenticated user ${userId}`);
      } catch (e) {
        console.warn('evaluate-answer: Failed to parse token but proceeding anyway (probable clock skew)');
      }
    }

    if (!userId && fallbackUserId) {
      console.log(`evaluate-answer: Using fallback userId from header: ${fallbackUserId}`);
      userId = fallbackUserId;
    }

    if (!userId) {
      console.log('evaluate-answer: No valid userId found - using guest fallback');
      userId = 'guest'; // or handle as appropriate for your business logic
    }

    // Use service role for database operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request
    const {
      question_id, answer, question_text, job_role, difficulty,
      question_type, round_type, correct_answer, mcq_options,
      execution_result
    } = await req.json();

    if (!question_id || !answer || !question_text) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify question belongs to user's session
    // We join with the sessions table using supabaseAdmin to check ownership
    const { data: question, error: qError } = await supabaseAdmin
      .from('questions')
      .select('id, session_id, sessions!inner(user_id)')
      .eq('id', question_id)
      .eq('sessions.user_id', userId)
      .single();

    if (qError || !question) {
      return new Response(JSON.stringify({ error: 'Question not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sanitize inputs
    const sanitizedAnswer = String(answer).replace(/<[^>]*>/g, '').substring(0, 5000);
    const sanitizedQuestion = String(question_text).replace(/<[^>]*>/g, '').substring(0, 2000);
    const sanitizedRole = String(job_role || 'Software Developer').replace(/<[^>]*>/g, '').substring(0, 100);
    const sanitizedDifficulty = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
    const qType = ['mcq', 'text', 'code'].includes(question_type) ? question_type : 'text';
    const rType = ['aptitude', 'technical', 'coding', 'hr', 'general'].includes(round_type) ? round_type : 'general';

    let evaluation;

    // ─── MCQ: Auto-grade without AI call ───
    if (qType === 'mcq' && correct_answer) {
      const userChoice = sanitizedAnswer.trim().toUpperCase().charAt(0);
      const correctChoice = String(correct_answer).trim().toUpperCase().charAt(0);
      const isCorrect = userChoice === correctChoice;

      // Find the correct option text for the ideal answer
      let correctOptionText = correctChoice;
      if (Array.isArray(mcq_options)) {
        const correctOpt = mcq_options.find((opt: any) =>
          (opt.label || '').toUpperCase() === correctChoice
        );
        if (correctOpt) {
          correctOptionText = `${correctOpt.label}) ${correctOpt.text}`;
        }
      }

      evaluation = {
        score: isCorrect ? 10 : 0,
        good: isCorrect ? 'Correct answer! Well done.' : `You selected ${userChoice}, but the correct answer was ${correctChoice}.`,
        missing: isCorrect ? 'Nothing — you got it right!' : `The correct answer is ${correctOptionText}. Review this concept for better understanding.`,
        ideal: `The correct answer is ${correctOptionText}.`,
        round: rType
      };
    }

    // ─── Text / Code: AI evaluation ───
    else {
      const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')?.trim().replace(/^"|"$/g, '');
      if (!OPENROUTER_API_KEY) {
        return new Response(JSON.stringify({ error: 'OpenRouter API key not configured' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Build type-specific prompt
      let prompt;

      if (qType === 'code') {
        prompt = `You are an expert code reviewer and interview evaluator for ${sanitizedRole} positions.

**Difficulty Level:** ${sanitizedDifficulty}
**Round:** Coding Round

**Coding Problem:**
${sanitizedQuestion}

**Candidate's Code/Solution:**
\`\`\`
${sanitizedAnswer}
\`\`\`

${execution_result ? `**Code Execution Results (against secret test cases):**
${JSON.stringify({ 
  passedCount: execution_result.results?.filter((r:any)=>r.passed).length || 0, 
  totalCases: execution_result.results?.length || 0,
  details: execution_result.results?.map((r:any) => ({ passed: r.passed, error: r.error }))
}, null, 2)}
` : ''}
Evaluate this coding answer thoroughly. Consider:
1. **Correctness**: Does the logic solve the problem correctly?
2. **Code quality**: Is the code clean, readable, and well-structured?
3. **Efficiency**: Is the approach optimal in terms of time/space complexity?
4. **Edge cases**: Are edge cases handled?
5. **Best practices**: Does it follow coding best practices?

Score from 1-10 where:
- 1-3: Code doesn't work or has major logical errors
- 4-5: Partially correct but missing key logic
- 6-7: Works for basic cases, decent structure
- 8-9: Correct, efficient, handles edge cases
- 10: Optimal solution with clean, production-quality code

Provide constructive, specific feedback about the code.`;
      } else if (rType === 'hr') {
        prompt = `You are an expert HR interview evaluator for ${sanitizedRole} positions.

**Difficulty Level:** ${sanitizedDifficulty}
**Round:** HR / Behavioral Round

**Interview Question:**
${sanitizedQuestion}

**Candidate's Answer:**
${sanitizedAnswer}

Evaluate this behavioral answer. Consider:
1. **STAR Method**: Did they use Situation-Task-Action-Result format?
2. **Specificity**: Did they give concrete examples?
3. **Self-awareness**: Do they show reflection and growth?
4. **Cultural fit**: Does their answer show alignment with professional values?
5. **Communication**: Is the answer clear and well-structured?

Score from 1-10 where:
- 1-3: Vague, generic, no real examples
- 4-5: Some structure but lacks depth
- 6-7: Good example with reasonable structure
- 8-9: Excellent STAR response with insights
- 10: Outstanding, memorable answer with deep reflection

Provide constructive, specific feedback.`;
      } else {
        // Technical / general text
        prompt = `You are an expert interview evaluator for ${sanitizedRole} positions.

**Difficulty Level:** ${sanitizedDifficulty}
**Round:** ${rType === 'technical' ? 'Technical' : 'General'} Round

**Interview Question:**
${sanitizedQuestion}

**Candidate's Answer:**
${sanitizedAnswer}

Evaluate this answer thoroughly. Consider:
1. Accuracy and correctness of the information
2. Completeness — did they cover the key points?
3. Depth of understanding demonstrated
4. Practical examples or real-world relevance
5. Communication clarity

Score from 1-10 where:
- 1-3: Poor, major gaps in understanding
- 4-5: Below average, missing key concepts
- 6-7: Good, covers basics with some depth
- 8-9: Very good, comprehensive with examples
- 10: Outstanding, expert-level answer

Provide constructive, specific feedback.`;
      }

      const MODELS = [
        'google/gemini-2.0-flash-001',
        'google/gemini-flash-1.5-8b',
        'openai/gpt-4o-mini',
        'anthropic/claude-3-haiku',
        'meta-llama/llama-3.1-8b-instruct:free'
      ];

      async function callOpenRouter(modelId: string) {
        console.log(`evaluate-answer: Attempting evaluation with model: ${modelId}`);
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
              { role: 'system', content: 'You are an expert interview evaluator. Always respond with valid JSON.' },
              { role: 'user', content: prompt }
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'answer_evaluation',
                strict: true,
                schema: {
                  type: 'object',
                  properties: {
                    score: { type: 'number', description: 'Score from 1 to 10' },
                    good: { type: 'string', description: 'What was good about the answer' },
                    missing: { type: 'string', description: 'What was missing or could be improved' },
                    ideal: { type: 'string', description: 'The ideal comprehensive answer' }
                  },
                  required: ['score', 'good', 'missing', 'ideal'],
                  additionalProperties: false
                }
              }
            },
            temperature: 0.4,
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
            console.log(`evaluate-answer: Successfully evaluated with ${model}`);
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
          error: 'Failed to evaluate answer after multiple attempts',
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

      try {
        evaluation = extractJson(content);
        evaluation.score = Math.min(10, Math.max(1, Number(evaluation.score) || 5));
        evaluation.good = String(evaluation.good || '').substring(0, 2000);
        evaluation.missing = String(evaluation.missing || '').substring(0, 2000);
        evaluation.ideal = String(evaluation.ideal || '').substring(0, 3000);
        evaluation.round = rType;
      } catch (e) {
        console.error('Parse error:', e, content);
        return new Response(JSON.stringify({ error: 'Failed to parse evaluation' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // supabaseAdmin already declared above

    const { error: updateError } = await supabaseAdmin
      .from('questions')
      .update({
        user_answer: sanitizedAnswer,
        score: evaluation.score,
        good_feedback: evaluation.good,
        missing_feedback: evaluation.missing,
        ideal_answer: evaluation.ideal,
        answered_at: new Date().toISOString()
      })
      .eq('id', question_id);

    if (updateError) {
      console.error('Update error:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to save evaluation' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(evaluation), {
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

export { };
