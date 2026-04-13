/// <reference path="../deno.d.ts" />
// ============================================
// Edge Function: admin-stats
// Returns platform-wide statistics for admin dashboard
// ============================================

// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  console.log(`admin-stats: Received ${req.method} request`);

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
        console.log(`admin-stats: Authenticated user ${userId}`);
      } catch (e) {
        console.warn('admin-stats: Failed to parse token but proceeding anyway (probable clock skew)');
      }
    }

    if (!userId && fallbackUserId) {
      console.log(`admin-stats: Using fallback userId from header: ${fallbackUserId}`);
      userId = fallbackUserId;
    }

    if (!userId && !authHeader) {
      console.log('admin-stats: No auth header found - proceeding to check if user info was injected by gateway');
    }

    // Verify user with their token
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service role to check admin status and fetch all data
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if user is admin
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || profile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch all profiles
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    // Fetch all completed sessions
    const { data: sessions } = await supabaseAdmin
      .from('sessions')
      .select('id, user_id, total_score, question_count, created_at, status')
      .eq('status', 'completed');

    // Fetch question count
    const { count: totalQuestions } = await supabaseAdmin
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .not('score', 'is', null);

    // Calculate stats
    const allSessions = sessions || [];
    const allProfiles = profiles || [];

    const totalSessions = allSessions.length;
    const totalScoreSum = allSessions.reduce((s, sess) => s + (sess.total_score || 0), 0);
    const totalQuestionCount = allSessions.reduce((s, sess) => s + (sess.question_count || 0), 0);
    const avgScore = totalQuestionCount > 0 ? totalScoreSum / totalQuestionCount : 0;

    // Per-user stats
    const users = allProfiles.map(p => {
      const userSessions = allSessions.filter(s => s.user_id === p.id);
      const userTotalScore = userSessions.reduce((s, sess) => s + (sess.total_score || 0), 0);
      const userTotalQ = userSessions.reduce((s, sess) => s + (sess.question_count || 0), 0);
      const userAvg = userTotalQ > 0 ? userTotalScore / userTotalQ : 0;

      // Best score per session
      let bestScore = 0;
      userSessions.forEach(s => {
        if (s.question_count > 0) {
          const avg = s.total_score / s.question_count;
          if (avg > bestScore) bestScore = avg;
        }
      });

      const lastSession = userSessions.length > 0
        ? userSessions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
        : null;

      return {
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        avatar_url: p.avatar_url,
        role: p.role,
        created_at: p.created_at,
        total_sessions: userSessions.length,
        total_score: userTotalScore,
        total_questions: userTotalQ,
        avg_score: userAvg,
        best_score: bestScore,
        last_active: lastSession?.created_at || p.created_at,
      };
    });

    return new Response(JSON.stringify({
      totalUsers: allProfiles.length,
      totalSessions,
      avgScore,
      totalQuestions: totalQuestions || 0,
      users,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Admin stats error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

export { };
