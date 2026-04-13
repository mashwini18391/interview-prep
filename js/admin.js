// ============================================
// Admin Page — Logic
// Uses guardAdmin to verify role from DB
// ============================================

import { fetchAdminStats } from './services/aiService.js';
import { guardAdmin } from './router.js?v=3';
import {
  initTheme, showToast, renderNavbar, timeAgo,
  getScoreClass, escapeHtml, debounce
} from './utils.js';

let allUsers = [];
let filteredUsers = [];
const PAGE_SIZE = 15;
let currentPage = 1;

export async function initAdmin() {
  initTheme();

  // guardAdmin: fetches role from DB, redirects non-admins
  const result = await guardAdmin();
  if (!result) return;

  document.getElementById('navbar-container').innerHTML = renderNavbar(result.profile, 'admin');

  window.searchUsers = debounce(handleSearch, 300);
  window.adminGoToPage = handleGoToPage;

  await loadAdminData();
}

async function loadAdminData() {
  try {
    // Uses aiService — no direct fetch in page code
    const data = await fetchAdminStats();

    document.getElementById('admin-total-users').textContent = data.totalUsers || 0;
    document.getElementById('admin-total-sessions').textContent = data.totalSessions || 0;
    document.getElementById('admin-avg-score').textContent = (data.avgScore || 0).toFixed(1);
    document.getElementById('admin-total-questions').textContent = data.totalQuestions || 0;

    allUsers = data.users || [];
    filteredUsers = [...allUsers];
    renderUserTable();
  } catch (err) {
    console.error('Admin load error:', err);
    showToast('Failed to load admin data', 'error');
  }
}

function handleSearch(query) {
  const q = query.toLowerCase().trim();
  filteredUsers = q
    ? allUsers.filter(u => (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
    : [...allUsers];
  currentPage = 1;
  renderUserTable();
}

function renderUserTable() {
  const tbody = document.getElementById('users-tbody');
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filteredUsers.slice(start, start + PAGE_SIZE);

  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:var(--space-8);color:var(--text-tertiary);">No users found</td></tr>`;
    document.getElementById('admin-pagination').innerHTML = '';
    return;
  }

  tbody.innerHTML = page.map(u => {
    const avgScore = u.total_sessions > 0 && u.total_questions > 0 ? (u.total_score / u.total_questions).toFixed(1) : '-';
    const bestScore = u.best_score ? u.best_score.toFixed(1) : '-';
    return `
      <tr>
        <td>
          <div class="user-row">
            <img src="${u.avatar_url || `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%237c5cfc'/%3E%3Ctext x='16' y='22' text-anchor='middle' fill='white' font-size='14'%3E${(u.full_name?.[0] || 'U').toUpperCase()}%3C/text%3E%3C/svg%3E`}" alt="">
            <div class="user-info">
              <div class="user-name">${escapeHtml(u.full_name || 'Unknown')}</div>
              <div class="user-email">${escapeHtml(u.email)}</div>
            </div>
          </div>
        </td>
        <td><span style="font-weight:600;">${u.total_sessions || 0}</span></td>
        <td>${avgScore !== '-' ? `<span class="score-badge ${getScoreClass(parseFloat(avgScore))}" style="width:36px;height:36px;font-size:var(--text-xs);">${avgScore}</span>` : '-'}</td>
        <td>${bestScore !== '-' ? `<span style="color:var(--success-400);font-weight:600;">${bestScore}</span>` : '-'}</td>
        <td><span style="font-size:var(--text-xs);color:var(--text-tertiary);">${u.last_active ? timeAgo(u.last_active) : 'Never'}</span></td>
        <td><span class="badge ${u.role === 'admin' ? 'badge-primary' : 'badge-info'}">${u.role || 'user'}</span></td>
      </tr>`;
  }).join('');

  const totalPages = Math.ceil(filteredUsers.length / PAGE_SIZE);
  const pag = document.getElementById('admin-pagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }
  let html = `<button ${currentPage === 1 ? 'disabled' : ''} onclick="adminGoToPage(${currentPage - 1})">‹</button>`;
  for (let i = 1; i <= totalPages; i++) html += `<button class="${i === currentPage ? 'active' : ''}" onclick="adminGoToPage(${i})">${i}</button>`;
  html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="adminGoToPage(${currentPage + 1})">›</button>`;
  pag.innerHTML = html;
}

function handleGoToPage(page) {
  currentPage = page;
  renderUserTable();
}
