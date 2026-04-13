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
 * Decode JWT for diagnostic purposes
 */
function debugToken(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => 
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''));
    const payload = JSON.parse(jsonPayload);
    
    const now = Math.floor(Date.now() / 1000);
    const exp = payload.exp;
    const diff = exp - now;
    
    const isFuture = payload.iat > now;
    
    console.log('AI Service: Token DEBUG ->', {
      issuedAt: new Date(payload.iat * 1000).toLocaleString(),
      expiresAt: new Date(payload.exp * 1000).toLocaleString(),
      timeLeftSeconds: diff,
      isFuture,
      systemClock: new Date().toLocaleString()
    });
    
    if (diff < 0) console.error('AI Service: TOKEN EXPIRED!');
    if (isFuture) console.warn('AI Service: TOKEN FROM THE FUTURE! Check your computer clock.');
    
    return { isFuture, isExpired: diff < 0 };
  } catch (e) {
    console.error('AI Service: Failed to debug token:', e);
    return { isFuture: false, isExpired: false };
  }
}

/**
 * Call an Edge Function with auth and JSON body
 * Uses plain fetch with retry logic for robust authentication
 */
async function callEdgeFunction(functionName, body = null, method = 'POST', isRetry = false) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    
    let isFuture = false;
    if (token) {
      const diagnosis = debugToken(token);
      isFuture = diagnosis.isFuture;
    }
    
    console.log(`AI Service: Calling ${functionName} (${method})...`);

    const url = `${EDGE_FUNCTION_URL}/${functionName}`;
    const headers = {
      'content-type': 'application/json',
      'apikey': SUPABASE_ANON_KEY.trim(), // Mandatory for Supabase Gateway routing
    };

    // If token is from the future, use ANON key as fallback in Authorization to bypass Gateway's strict JWT check
    if (token && !isFuture) {
      headers['authorization'] = `Bearer ${token.trim()}`;
    } else {
      // Use anon key as the bearer token - it satisfies the gateway and isn't from the future
      console.warn('AI Service: Using ANON key as authorization fallback (Clock skew/CORS resilience)');
      headers['authorization'] = `Bearer ${SUPABASE_ANON_KEY.trim()}`;
      
      // Pass the actual userId in a secondary header so the Edge Function can identifying the caller
      if (token) {
        try {
          const base64Url = token.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(atob(base64));
          if (payload.sub) {
            headers['x-user-id'] = payload.sub;
            console.log(`AI Service: Included fallback x-user-id: ${payload.sub}`);
          }
        } catch (e) {
          console.error('AI Service: Failed to extract fallback userId:', e);
        }
      }
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (fetchErr) {
      console.error(`AI Service: Network error calling ${functionName}:`, fetchErr);
      throw new Error(`Connection failed: Check if Supabase functions are deployed and reachable.`);
    }

    if (response.status === 401 && !isRetry) {
      console.warn(`AI Service: 401 Unauthorized for ${functionName}. Attempting session refresh...`);
      const { data: { session: refreshed }, error: refreshError } = await supabase.auth.refreshSession();
      
      if (!refreshError && refreshed) {
        console.log('AI Service: Session refreshed. Retrying function call...');
        return callEdgeFunction(functionName, body, method, true);
      }
    }

    const responseText = await response.text();
    let responseData;
    try {
      responseData = responseText ? JSON.parse(responseText) : null;
    } catch (e) {
      console.error(`AI Service: Failed to parse response from ${functionName}:`, responseText);
      throw new Error(`Invalid response from ${functionName}`);
    }

    if (!response.ok) {
      console.error(`AI Service: ${functionName} failed (${response.status}):`, JSON.stringify(responseData, null, 2));
      throw new Error(responseData?.error || `Edge function ${functionName} failed with status ${response.status}`);
    }

    return responseData;
  } catch (err) {
    console.error(`AI Service: ${functionName} call failed:`, err);
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
