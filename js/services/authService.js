// ============================================
// Auth Service — Single source of truth for Auth
// ============================================

import { supabase } from './supabaseClient.js';

export const authService = {
  /**
   * Get current session
   */
  async getSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
  },

  /**
   * Get profile from database
   */
  async getProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    return data;
  },

  /**
   * Ensure user has a profile record. Creates one if missing.
   */
  async ensureProfile(user) {
    try {
      return await this.getProfile(user.id);
    } catch (e) {
      // PGRST116 = No rows found
      if (e.code === 'PGRST116') {
        console.log('AuthService: Profile missing, creating...', user.id);
        const { data: created, error: createErr } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            email: user.email,
            full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
            avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || ''
          })
          .select()
          .single();
        
        if (createErr) throw createErr;
        return created;
      }
      throw e;
    }
  },

  /**
   * Auth Guard for protected pages
   */
  async guardAuth() {
    try {
      const session = await this.getSession();
      if (!session) {
        console.warn('AuthService: No session, redirecting to login');
        window.location.href = '/index.html';
        return null;
      }

      const profile = await this.ensureProfile(session.user);
      return { session, profile };
    } catch (err) {
      console.error('AuthService: Guard error:', err);
      // STOP REDIRECT LOOP: Only redirect if it's an auth error, not a DB error
      if (err.status === 401 || err.message?.includes('JWT')) {
        window.location.href = '/index.html';
      } else {
        // Show error on screen instead of looping
        if (window.AppUtils?.showToast) {
          window.AppUtils.showToast(`Database Error: ${err.message}`, 'error');
        }
      }
      return null;
    }
  },

  /**
   * Sign In with Google
   */
  async signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/dashboard.html'
      }
    });
    if (error) throw error;
    return data;
  },

  /**
   * Sign Out
   */
  async signOut() {
    await supabase.auth.signOut();
    localStorage.clear();
    window.location.href = '/index.html';
  }
};

// Global exposure for non-module scripts
window.AppAuth = authService;
