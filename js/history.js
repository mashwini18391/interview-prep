// ============================================
// History Page — Logic
// ============================================

import { authService } from './services/authService.js?v=3';
import { supabase } from './services/supabaseClient.js';
import { guardAuth } from './router.js?v=3';
import {
  initTheme, showToast, renderNavbar, formatDate, timeAgo,
  getScoreClass, getDifficultyBadge, escapeHtml, getCurrentTheme
} from './utils.js';

let allSessions = [];
let filteredSessions = [];
const PAGE_SIZE = 10;
let currentPage = 1;

export async function initHistory() {
  initTheme();

  const result = await guardAuth();
  if (!result) return;
  const { session, profile } = result;

  document.getElementById('navbar-container').innerHTML = renderNavbar(profile, 'history');

  window.applyFilters = applyFilters;
  window.goToPage = goToPage;

  await loadHistory(session.user.id);
}

async function loadHistory(userId) {
  try {
    const { data: sessions, error } = await supabase
      .from('sessions').select('*').eq('user_id', userId).eq('status', 'completed')
      .order('created_at', { ascending: false });
    if (error) throw error;
    allSessions = sessions || [];

    const roles = [...new Set(allSessions.map(s => s.job_role))];
    const roleSelect = document.getElementById('filter-role');
    roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r; opt.textContent = r;
      roleSelect.appendChild(opt);
    });

    applyFilters();
    renderChart();
  } catch (err) {
    console.error(err);
    showToast('Failed to load history', 'error');
  }
}

function applyFilters() {
  const role = document.getElementById('filter-role').value;
  const diff = document.getElementById('filter-difficulty').value;
  const sort = document.getElementById('filter-sort').value;

  filteredSessions = allSessions.filter(s => {
    if (role && s.job_role !== role) return false;
    if (diff && s.difficulty !== diff) return false;
    return true;
  });

  filteredSessions.sort((a, b) => {
    const avgA = a.question_count > 0 ? a.total_score / a.question_count : 0;
    const avgB = b.question_count > 0 ? b.total_score / b.question_count : 0;
    switch (sort) {
      case 'oldest': return new Date(a.created_at) - new Date(b.created_at);
      case 'highest': return avgB - avgA;
      case 'lowest': return avgA - avgB;
      default: return new Date(b.created_at) - new Date(a.created_at);
    }
  });

  currentPage = 1;
  renderList();
}

function renderList() {
  const container = document.getElementById('history-list');
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filteredSessions.slice(start, start + PAGE_SIZE);

  if (page.length === 0) {
    container.innerHTML = `
      <div class="card empty-state history-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <h3>No sessions found</h3>
        <p>Try adjusting your filters or start a new practice session.</p>
        <a href="/setup" class="btn btn-primary" style="margin-top:var(--space-4);">Start New Session</a>
      </div>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  container.innerHTML = page.map((s, i) => {
    const avg = s.question_count > 0 ? (s.total_score / s.question_count).toFixed(1) : '0.0';
    return `
      <a href="/summary?id=${s.id}" class="card history-item animate-fade-in-up stagger-${i % 6 + 1}">
        <div class="score-col"><div class="score-badge ${getScoreClass(parseFloat(avg))}" style="width:52px;height:52px;font-size:var(--text-base);">${avg}</div></div>
        <div class="info-col">
          <div class="role-name">${escapeHtml(s.job_role)}</div>
          <div class="meta-row">
            ${getDifficultyBadge(s.difficulty)}
            <span class="meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${formatDate(s.created_at)}</span>
            <span class="meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> ${s.question_count} questions</span>
            <span class="badge badge-info" style="font-size:10px;">${s.company_type === 'mnc' ? 'MNC' : s.company_type === 'faang' ? 'FAANG' : 'Startup'}</span>
          </div>
        </div>
        <div class="arrow-col"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>
      </a>`;
  }).join('');

  renderPagination();
}

function renderPagination() {
  const totalPages = Math.ceil(filteredSessions.length / PAGE_SIZE);
  if (totalPages <= 1) { document.getElementById('pagination').innerHTML = ''; return; }
  const pag = document.getElementById('pagination');
  let html = `<button ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">‹</button>`;
  for (let i = 1; i <= totalPages; i++) html += `<button class="${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">›</button>`;
  pag.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  renderList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderChart() {
  if (allSessions.length < 2) return;
  const sorted = [...allSessions].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const isDark = getCurrentTheme() === 'dark';
  const ctx = document.getElementById('history-chart')?.getContext('2d');
  if (!ctx) return;
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: sorted.map(s => formatDate(s.created_at)),
      datasets: [{
        label: 'Average Score',
        data: sorted.map(s => s.question_count > 0 ? (s.total_score / s.question_count).toFixed(1) : 0),
        borderColor: '#7c5cfc', backgroundColor: 'rgba(124,92,252,0.08)',
        borderWidth: 3, fill: true, tension: 0.4,
        pointBackgroundColor: '#7c5cfc', pointBorderColor: isDark ? '#111127' : '#fff',
        pointBorderWidth: 3, pointRadius: 4, pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }, ticks: { color: isDark ? '#6b6b8d' : '#8b8ba8', font: { size: 11 } } },
        y: { min: 0, max: 10, grid: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }, ticks: { color: isDark ? '#6b6b8d' : '#8b8ba8', stepSize: 2 } }
      },
      interaction: { intersect: false, mode: 'index' }
    }
  });
}
