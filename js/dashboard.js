// ============================================
// Dashboard Page — Logic
// ============================================

import { supabase } from './services/supabaseClient.js';
import { guardAuth, signOut } from './router.js?v=3';
import {
  initTheme, showToast, renderNavbar, formatDate, timeAgo,
  getScoreClass, getDifficultyBadge, getSuggestedDifficulty,
  escapeHtml, cache, getCurrentTheme
} from './utils.js';

let progressChart = null;

export async function initDashboard() {
  initTheme();

  const result = await guardAuth();
  if (!result) return;
  const { session, profile } = result;

  document.getElementById('navbar-container').innerHTML = renderNavbar(profile, 'dashboard');

  // Greeting
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';
  const firstName = profile?.full_name?.split(' ')[0] || 'there';
  document.getElementById('greeting-text').textContent = `${greeting}, ${firstName} 👋`;

  await loadDashboardData(session.user.id);
}

async function loadDashboardData(userId) {
  // Try cache first
  const cached = cache.get(`dashboard_${userId}`);
  if (cached) {
    renderDashboard(cached.sessions, cached.questionCount);
    // Still fetch fresh data in background
    fetchFreshData(userId);
    return;
  }

  try {
    const data = await fetchFreshData(userId);
    renderDashboard(data.sessions, data.questionCount);
  } catch (err) {
    console.error('Dashboard load error:', err);
    showToast('Failed to load dashboard data', 'error');
  }
}

async function fetchFreshData(userId) {
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const { count: questionCount } = await supabase
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .in('session_id', (sessions || []).map(s => s.id))
    .not('score', 'is', null);

  // Cache for 2 minutes
  cache.set(`dashboard_${userId}`, { sessions, questionCount }, 120000);
  return { sessions: sessions || [], questionCount: questionCount || 0 };
}

function renderDashboard(sessions, questionCount) {
  const totalSessions = sessions.length;
  const totalQ = sessions.reduce((s, sess) => s + (sess.question_count || 1), 0);
  const avgScore = totalQ > 0
    ? (sessions.reduce((sum, s) => sum + (s.total_score || 0), 0) / totalQ).toFixed(1)
    : '0.0';
  const bestScore = totalSessions > 0
    ? Math.max(...sessions.map(s => s.question_count > 0 ? (s.total_score / s.question_count) : 0)).toFixed(1)
    : '0.0';

  // Animate stat values
  animateValue('stat-sessions', totalSessions);
  animateValue('stat-avg-score', avgScore);
  animateValue('stat-best-score', bestScore);
  animateValue('stat-questions', questionCount);

  // Difficulty suggestion (uses last 3 sessions)
  const recentSessions = sessions.slice(0, 3);
  const recentTotal = recentSessions.reduce((s, sess) => s + (sess.total_score || 0), 0);
  const recentQ = recentSessions.reduce((s, sess) => s + (sess.question_count || 1), 0);
  const recentAvg = recentQ > 0 ? recentTotal / recentQ : parseFloat(avgScore);
  const suggested = getSuggestedDifficulty(recentAvg);
  const colors = { easy: 'var(--success-500)', medium: 'var(--warning-500)', hard: 'var(--danger-500)' };
  document.getElementById('suggested-difficulty').innerHTML = `
    <span style="color:${colors[suggested]};text-transform:capitalize;">${suggested}</span> difficulty
  `;

  renderRecentSessions(sessions.slice(0, 5));
  renderProgressChart(sessions.slice().reverse());
}

function animateValue(elementId, value) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = `<span style="animation:countUp 0.5s ease-out">${value}</span>`;
}

function renderRecentSessions(sessions) {
  const container = document.getElementById('recent-sessions');
  if (sessions.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-8) var(--space-4);">
        <p style="font-size:var(--text-sm);color:var(--text-tertiary);">No sessions yet. Start your first interview!</p>
      </div>`;
    return;
  }
  container.innerHTML = sessions.map(s => {
    const avg = s.question_count > 0 ? (s.total_score / s.question_count).toFixed(1) : '0.0';
    return `
      <a href="/summary?id=${s.id}" class="session-item">
        <div class="score-badge ${getScoreClass(parseFloat(avg))}">${avg}</div>
        <div class="session-info">
          <div class="session-role">${escapeHtml(s.job_role)}</div>
          <div class="session-meta">${getDifficultyBadge(s.difficulty)}<span>${timeAgo(s.created_at)}</span></div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-tertiary)"><polyline points="9 18 15 12 9 6"/></svg>
      </a>`;
  }).join('');
}

function renderProgressChart(sessions) {
  const container = document.getElementById('chart-container');
  if (sessions.length < 2) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-8);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:48px;height:48px;"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
        <p style="font-size:var(--text-sm);color:var(--text-tertiary);margin-top:var(--space-4);">Complete at least 2 sessions to see your progress chart.</p>
      </div>`;
    return;
  }
  container.innerHTML = '<canvas id="progress-chart"></canvas>';
  const ctx = document.getElementById('progress-chart').getContext('2d');
  const isDark = getCurrentTheme() === 'dark';
  const labels = sessions.map(s => formatDate(s.created_at));
  const scores = sessions.map(s => s.question_count > 0 ? (s.total_score / s.question_count).toFixed(1) : 0);

  if (progressChart) progressChart.destroy();
  progressChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Average Score', data: scores,
        borderColor: '#7c5cfc', backgroundColor: 'rgba(124,92,252,0.1)',
        borderWidth: 3, fill: true, tension: 0.4,
        pointBackgroundColor: '#7c5cfc',
        pointBorderColor: isDark ? '#111127' : '#ffffff',
        pointBorderWidth: 3, pointRadius: 5, pointHoverRadius: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { backgroundColor: isDark ? '#1a1a3e' : '#fff', titleColor: isDark ? '#f0f0f8' : '#1a1a2e', bodyColor: isDark ? '#a0a0c0' : '#4a4a6a', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderWidth: 1, padding: 12, cornerRadius: 8, displayColors: false }
      },
      scales: {
        x: { grid: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }, ticks: { color: isDark ? '#6b6b8d' : '#8b8ba8', font: { size: 11 } } },
        y: { min: 0, max: 10, grid: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }, ticks: { color: isDark ? '#6b6b8d' : '#8b8ba8', font: { size: 11 }, stepSize: 2 } }
      },
      interaction: { intersect: false, mode: 'index' }
    }
  });

  window.addEventListener('themechange', () => {
    if (progressChart) { progressChart.destroy(); renderProgressChart(sessions); }
  });
}
