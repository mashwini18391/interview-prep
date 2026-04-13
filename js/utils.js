// ============================================
// AI Interview Prep Coach — Utilities
// ============================================

// ── Toast Notifications ──
let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(message, type = 'info', duration = 4000) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Theme Management ──
function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'dark'); // default dark
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  // Dispatch event for chart updates etc
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
  return next;
}

function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

// ── Date Formatting ──
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function formatDateTime(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function timeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(dateStr);
}

// ── Score Helpers ──
function getScoreColor(score) {
  if (score >= 8) return 'var(--success-500)';
  if (score >= 6) return 'var(--accent-500)';
  if (score >= 4) return 'var(--warning-500)';
  return 'var(--danger-500)';
}

function getScoreClass(score) {
  if (score >= 8) return 'excellent';
  if (score >= 6) return 'good';
  if (score >= 4) return 'average';
  return 'poor';
}

function getScoreLabel(score) {
  if (score >= 9) return 'Outstanding';
  if (score >= 8) return 'Excellent';
  if (score >= 7) return 'Very Good';
  if (score >= 6) return 'Good';
  if (score >= 5) return 'Average';
  if (score >= 4) return 'Below Average';
  return 'Needs Improvement';
}

function getDifficultyBadge(difficulty) {
  const classes = {
    easy: 'badge-success',
    medium: 'badge-warning',
    hard: 'badge-danger'
  };
  return `<span class="badge ${classes[difficulty] || 'badge-info'}">${difficulty}</span>`;
}

// ── Suggested Difficulty ──
function getSuggestedDifficulty(avgScore) {
  if (avgScore === null || avgScore === undefined) return 'medium';
  if (avgScore < 5) return 'easy';
  if (avgScore <= 7) return 'medium';
  return 'hard';
}

// ── Input Sanitization ──
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/<[^>]*>/g, '').substring(0, 5000);
}

// ── Loading States ──
function showLoading(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.classList.remove('hidden');
}

function hideLoading(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.classList.add('hidden');
}

function setButtonLoading(btn, loading = true) {
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Loading...';
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
  }
}

// ── Skeleton Rendering ──
function renderSkeletonCards(container, count = 3) {
  container.innerHTML = Array(count).fill('').map(() => `
    <div class="card skeleton-card skeleton animate-fade-in"></div>
  `).join('');
}

function renderSkeletonTable(container, rows = 5) {
  container.innerHTML = `
    <div class="skeleton" style="height: 40px; margin-bottom: 8px; border-radius: 8px;"></div>
    ${Array(rows).fill('').map(() => `
      <div class="skeleton" style="height: 52px; margin-bottom: 4px; border-radius: 8px;"></div>
    `).join('')}
  `;
}

// ── Timer Formatting ──
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ── URL Params ──
function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// ── Debounce ──
function debounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ── Cache Manager ──
const cache = {
  set(key, data, ttlMs = 300000) { // 5 min default
    const item = { data, expiry: Date.now() + ttlMs };
    try { localStorage.setItem(`cache_${key}`, JSON.stringify(item)); } catch (e) { /* full */ }
  },

  get(key) {
    try {
      const raw = localStorage.getItem(`cache_${key}`);
      if (!raw) return null;
      const item = JSON.parse(raw);
      if (Date.now() > item.expiry) {
        localStorage.removeItem(`cache_${key}`);
        return null;
      }
      return item.data;
    } catch {
      return null;
    }
  },

  clear(key) {
    if (key) {
      localStorage.removeItem(`cache_${key}`);
    } else {
      Object.keys(localStorage)
        .filter(k => k.startsWith('cache_'))
        .forEach(k => localStorage.removeItem(k));
    }
  }
};

// ── Render Navbar ──
function renderNavbar(profile, activePage = '') {
  const isAdminUser = profile?.role === 'admin';
  return `
    <nav class="navbar" id="main-navbar">
      <a href="/dashboard.html" class="navbar-brand">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <defs>
            <linearGradient id="logo-grad" x1="0" y1="0" x2="32" y2="32">
              <stop offset="0%" stop-color="#7c5cfc"/>
              <stop offset="100%" stop-color="#0ea5e9"/>
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="8" fill="url(#logo-grad)"/>
          <path d="M10 22V10h3l3 8 3-8h3v12h-2.5v-8l-2.5 7h-2l-2.5-7v8z" fill="white"/>
        </svg>
        <span>InterviewAI</span>
      </a>
      <div class="navbar-nav" id="navbar-nav">
        <a href="/dashboard.html" class="nav-link ${activePage === 'dashboard' ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
          Dashboard
        </a>
        <a href="/history.html" class="nav-link ${activePage === 'history' ? 'active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          History
        </a>
        ${isAdminUser ? `
          <a href="/admin.html" class="nav-link ${activePage === 'admin' ? 'active' : ''}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            Admin
          </a>
        ` : ''}
      </div>
      <div class="navbar-actions">
        <button class="theme-toggle" id="theme-toggle" onclick="window.AppUtils.toggleTheme()" title="Toggle theme">
          <svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          <svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
        <button class="mobile-menu-btn btn-ghost btn-icon" onclick="document.getElementById('navbar-nav').classList.toggle('open')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div class="user-menu" id="user-menu">
          <img src="${profile?.avatar_url || `data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2236%22 height=%2236%22%3E%3Ccircle cx=%2218%22 cy=%2218%22 r=%2218%22 fill=%22%237c5cfc%22/%3E%3Ctext x=%2218%22 y=%2224%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2216%22%3E${(profile?.full_name?.[0] || 'U').toUpperCase()}%3C/text%3E%3C/svg%3E`}"
               alt="Avatar" class="navbar-avatar" onclick="this.parentElement.querySelector('.user-dropdown').classList.toggle('hidden')" />
          <div class="user-dropdown hidden" id="user-dropdown">
            <div style="padding: var(--space-3) var(--space-4);">
              <div style="font-weight: 600; font-size: var(--text-sm);">${escapeHtml(profile?.full_name || 'User')}</div>
              <div style="font-size: var(--text-xs); color: var(--text-tertiary);">${escapeHtml(profile?.email || '')}</div>
            </div>
            <div class="user-dropdown-divider"></div>
            <a href="/dashboard.html" class="user-dropdown-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
              Dashboard
            </a>
            <a href="/history.html" class="user-dropdown-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              History
            </a>
            <div class="user-dropdown-divider"></div>
            <button class="user-dropdown-item" onclick="window.AppAuth.signOut()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </nav>
  `;
}

// ── Close dropdown on outside click ──
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('user-dropdown');
  const menu = document.getElementById('user-menu');
  if (dropdown && menu && !menu.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

// ── Circular Progress SVG ──
function renderCircularProgress(score, maxScore = 10, size = 160) {
  const percentage = (score / maxScore) * 100;
  const radius = (size / 2) - 12;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const color = getScoreColor(score);

  return `
    <div class="circular-progress" style="width:${size}px;height:${size}px;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${radius}" stroke="var(--bg-tertiary)" stroke-width="10" fill="none"/>
        <circle cx="${size/2}" cy="${size/2}" r="${radius}" stroke="${color}" stroke-width="10" fill="none"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
          stroke-linecap="round" style="transition: stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1)"/>
      </svg>
      <div class="progress-text">
        <span class="score-value" style="color:${color}">${score.toFixed(1)}</span>
        <span class="score-label">out of ${maxScore}</span>
      </div>
    </div>
  `;
}

// ── Export for global use ──
window.AppUtils = {
  showToast, initTheme, toggleTheme, getCurrentTheme,
  formatDate, formatDateTime, timeAgo, formatTime,
  getScoreColor, getScoreClass, getScoreLabel, getDifficultyBadge, getSuggestedDifficulty,
  escapeHtml, sanitizeInput,
  showLoading, hideLoading, setButtonLoading,
  renderSkeletonCards, renderSkeletonTable,
  getUrlParam, debounce, cache,
  renderNavbar, renderCircularProgress
};

export {
  showToast, initTheme, toggleTheme, getCurrentTheme,
  formatDate, formatDateTime, timeAgo, formatTime,
  getScoreColor, getScoreClass, getScoreLabel, getDifficultyBadge, getSuggestedDifficulty,
  escapeHtml, sanitizeInput,
  showLoading, hideLoading, setButtonLoading,
  renderSkeletonCards, renderSkeletonTable,
  getUrlParam, debounce, cache,
  renderNavbar, renderCircularProgress
};
