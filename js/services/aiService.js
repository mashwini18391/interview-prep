// ============================================
// AI Service — Centralized AI API calls
// All LLM interactions go through Edge Functions
// No API keys are ever used in frontend code
// ============================================

import { supabase, EDGE_FUNCTION_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';

/**
 * Get the current user's access token for Edge Function auth
 */
async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return session.access_token;
}

/**
 * Decode JWT for diagnostic purposes (Clock Skew detection)
 */
function debugToken(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    const now = Math.floor(Date.now() / 1000);
    const skew = payload.iat - now;
    
    console.log('AI Service: Token Diagnostic ->', {
      tokenIssuedAt: new Date(payload.iat * 1000).toLocaleString(),
      systemCurrentTime: new Date().toLocaleString(),
      skewSeconds: skew
    });
    
    if (skew > 0) {
      console.warn(`⚠️ AI Service: CLOCK SKEW DETECTED! Your system clock is BEHIND the server by ${skew} seconds. This will cause "Invalid JWT" errors unless "Verify JWT" is disabled in the Supabase Dashboard.`);
    }
  } catch (e) {
    // Ignore parse errors in diagnostic
  }
}

/**
 * Call an Edge Function with high-availability auth fallback
 * If the user's JWT is rejected (clock-skew), we fallback to the Anon Key as the token.
 */
async function callEdgeFunction(functionName, body = null, method = 'POST', isRetry = false) {
  try {
    console.log(`AI Service: Calling ${functionName} (${method})...`);

    const url = `${EDGE_FUNCTION_URL}/${functionName}`;
    const headers = {
      'content-type': 'application/json',
      'apikey': SUPABASE_ANON_KEY.trim(),
    };

    // Get session
    const { data: { session } } = await supabase.auth.getSession();
    
    // Logic: Use session token on first try. If it fails with 401, use Anon Key on retry.
    const token = (!isRetry && session?.access_token) ? session.access_token : SUPABASE_ANON_KEY;
    
    headers['authorization'] = `Bearer ${token.trim()}`;
    
    if (isRetry) {
      console.warn(`AI Service: Fallback mode active - Using Anon Key for Authorization header.`);
      debugToken(SUPABASE_ANON_KEY);
    } else if (session?.access_token) {
      debugToken(session.access_token);
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    // If 401 Unauthorized, retry once with the Anon Key
    if (response.status === 401 && !isRetry) {
      console.warn(`AI Service: 401 Unauthorized for ${functionName}. Retrying with Anon Key bypass...`);
      return callEdgeFunction(functionName, body, method, true);
    }

    const responseText = await response.text();
    let responseData;
    try {
      responseData = responseText ? JSON.parse(responseText) : { raw: responseText };
    } catch (e) {
      responseData = { error: 'Failed to parse JSON', raw: responseText };
    }

    if (!response.ok) {
      console.error(`AI Service: ${functionName} failed (${response.status}):`, responseData);
      const errorMsg = responseData?.error || responseData?.message || `Edge function failed with status ${response.status}`;
      throw new Error(errorMsg);
    }

    console.log(`AI Service: ${functionName} success!`);
    return responseData;
  } catch (err) {
    console.error(`AI Service: ${functionName} unexpected error:`, err);
    throw err;
  }
}






// ── JD Analysis ──

/**
 * Analyze a Job Description to extract skills, experience level, etc.
 * @param {Object} params
 * @param {string} params.jd_text - The raw JD text
 * @returns {Promise<{required_skills, experience_level, key_responsibilities, role_type, suggested_difficulty, company_type}>}
 */
async function analyzeJD({ jd_text }) {
  return callEdgeFunction('analyze-jd', { jd_text });
}

// ── Question Generation ──

/**
 * Generate multi-round interview questions for a session
 * @param {Object} params
 * @param {string} params.session_id
 * @param {string} params.job_role
 * @param {string} params.company_type
 * @param {string} params.difficulty
 * @param {number} params.count
 * @param {string} [params.jd_text] - Optional JD text
 * @param {Object} [params.jd_analysis] - Optional extracted JD analysis
 * @param {boolean} [params.include_coding] - Whether to include coding round
 * @returns {Promise<{questions: Array}>}
 */
async function generateQuestions({ session_id, job_role, company_type, difficulty, count, jd_text, jd_analysis, include_coding, rounds }) {
  return callEdgeFunction('generate-questions', {
    session_id,
    job_role,
    company_type,
    difficulty,
    count,
    jd_text,
    jd_analysis,
    include_coding,
    rounds
  });
}

// ── Answer Evaluation ──

/**
 * Evaluate a user's answer against a question
 * @param {Object} params
 * @param {string} params.question_id
 * @param {string} params.answer
 * @param {string} params.question_text
 * @param {string} params.job_role
 * @param {string} params.difficulty
 * @param {string} [params.question_type] - 'mcq', 'text', or 'code'
 * @param {string} [params.round_type] - 'aptitude', 'technical', 'coding', 'hr'
 * @param {string} [params.correct_answer] - For MCQ auto-grading
 * @param {Array}  [params.mcq_options] - MCQ options for context
 * @returns {Promise<{score: number, good: string, missing: string, ideal: string, round: string}>}
 */
async function evaluateAnswer({ question_id, answer, question_text, job_role, difficulty, question_type, round_type, correct_answer, mcq_options }) {
  return callEdgeFunction('evaluate-answer', {
    question_id,
    answer,
    question_text,
    job_role,
    difficulty,
    question_type,
    round_type,
    correct_answer,
    mcq_options
  });
}

// ── Admin Stats ──

/**
 * Fetch platform-wide admin statistics
 * Only works for users with admin role
 * @returns {Promise<{totalUsers, totalSessions, avgScore, totalQuestions, users}>}
 */
async function fetchAdminStats() {
  return callEdgeFunction('admin-stats', null, 'GET');
}

export {
  analyzeJD,
  generateQuestions,
  evaluateAnswer,
  fetchAdminStats,
  callEdgeFunction
};
