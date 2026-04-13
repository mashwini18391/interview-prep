// ============================================
// Router — Auth guards & navigation helpers
// ============================================

import { authService } from './services/authService.js';

/**
 * Auth guard — redirects to login if not authenticated.
 * Call at the top of every protected page's init().
 */
export async function guardAuth() {
  return await authService.guardAuth();
}

/**
 * Admin guard — redirects to dashboard if user is not admin.
 */
export async function guardAdmin() {
  const result = await guardAuth();
  if (!result) return null;

  if (result.profile.role !== 'admin') {
    console.warn('AuthService: User not admin, redirecting to dashboard');
    window.location.href = '/dashboard.html';
    return null;
  }

  return result;
}

/**
 * Sign in with Google OAuth
 */
export async function signInWithGoogle() {
  return await authService.signInWithGoogle();
}

/**
 * Sign out and redirect to login
 */
export async function signOut() {
  return await authService.signOut();
}

// Global exposure for navbar onclick
window.AppAuth = authService;
