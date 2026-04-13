// ============================================
// Summary Page — Logic (v2: Multi-Round)
// ============================================

import { authService } from './services/authService.js?v=3';
import { supabase } from './services/supabaseClient.js';
import { guardAuth } from './router.js?v=3';
import { APP_CONFIG } from './config.js';
import {
  initTheme, showToast, renderNavbar, renderCircularProgress,
  getScoreClass, getScoreColor, getScoreLabel, getDifficultyBadge,
  escapeHtml, formatDate, getCurrentTheme, getUrlParam
} from './utils.js';

export async function initSummary() {
  initTheme();

  const result = await guardAuth();
  if (!result) return;
  document.getElementById('navbar-container').innerHTML = renderNavbar(result.profile, '');

  window.toggleBreakdown = (i) => document.getElementById(`breakdown-${i}`).classList.toggle('open');
  window.shareResults = handleShareResults;

  // Try 'id' first, then 'session' as fallback
  const sessionId = getUrlParam('id') || getUrlParam('session');
  
  if (!sessionId || sessionId === 'undefined') { 
    showToast('No session specified', 'error'); 
    setTimeout(() => window.location.href = '/dashboard', 1500);
    return; 
  }
  await loadSummary(sessionId);
}

async function loadSummary(sessionId) {
  try {
    const { data: sess, error: sErr } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
    if (sErr) throw sErr;

    const { data: questions, error: qErr } = await supabase.from('questions').select('*').eq('session_id', sessionId).order('question_number');
    if (qErr) throw qErr;

    // Calculate round scores
    const roundScores = calculateRoundScores(questions);

    if (sess.status !== 'completed') {
      const totalScore = questions.reduce((s, q) => s + (q.score || 0), 0);
      const answered = questions.filter(q => q.score !== null).length;
      const strengths = questions.filter(q => q.score >= 7).map(q => q.good_feedback).filter(Boolean).join(' ');
      const improvements = questions.filter(q => q.score < 7).map(q => q.missing_feedback).filter(Boolean).join(' ');

      await supabase.from('sessions').update({
        status: 'completed', total_score: totalScore, question_count: answered,
        strengths: (strengths || 'Keep practicing!').substring(0, 1000),
        improvements: (improvements || 'Great job overall!').substring(0, 1000),
        completed_at: new Date().toISOString(),
        round_scores: roundScores
      }).eq('id', sessionId);

      Object.assign(sess, { total_score: totalScore, question_count: answered, strengths, improvements, round_scores: roundScores });
    }

    renderSummary(sess, questions, roundScores);
  } catch (err) {
    console.error('Load summary error:', err);
    showToast('Failed to load summary', 'error');
  }
}

function calculateRoundScores(questions) {
  const rounds = {};

  questions.forEach(q => {
    const rt = q.round_type || 'general';
    if (!rounds[rt]) rounds[rt] = { total: 0, count: 0, answered: 0, maxPossible: 0, label: q.round_label || APP_CONFIG.interviewRounds.find(r => r.id === rt)?.label || (rt.charAt(0).toUpperCase() + rt.slice(1)) };
    rounds[rt].maxPossible += 10;
    if (q.score !== null && q.score !== undefined) {
      rounds[rt].total += q.score;
      rounds[rt].answered++;
    }
    rounds[rt].count++;
  });

  // Calculate averages and fractions
  const result = {};
  Object.keys(rounds).forEach(rt => {
    const r = rounds[rt];
    result[rt] = {
      average: r.answered > 0 ? r.total / r.answered : 0,
      total: r.total,
      answered: r.answered,
      count: r.count,
      percentage: r.answered > 0 ? (r.total / (r.answered * 10)) * 100 : 0,
      label: r.label
    };
  });

  return result;
}

function renderSummary(sess, questions, roundScores) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('summary-content').classList.remove('hidden');

  const answered = questions.filter(q => q.score !== null);
  const avgScore = answered.length > 0 ? answered.reduce((s, q) => s + q.score, 0) / answered.length : 0;
  const scores = answered.map(q => q.score);
  const highest = scores.length > 0 ? Math.max(...scores) : 0;
  const lowest = scores.length > 0 ? Math.min(...scores) : 0;

  const companyLabel = sess.company_type === 'mnc' ? 'MNC' : sess.company_type === 'faang' ? 'FAANG' : 'Startup';
  document.getElementById('summary-subtitle').textContent = `${sess.job_role} • ${companyLabel} • ${formatDate(sess.created_at)}`;
  document.getElementById('score-circle').innerHTML = renderCircularProgress(avgScore, 10, 180);
  document.getElementById('score-label').textContent = getScoreLabel(avgScore);
  document.getElementById('summary-meta').innerHTML = `
    <div class="summary-meta-item">${getDifficultyBadge(sess.difficulty)}</div>
    <div class="summary-meta-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> ${questions.length} questions</div>
    <div class="summary-meta-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 4 12 14.01 9 11.01"/></svg> ${answered.length} answered</div>`;

  document.getElementById('stat-answered').textContent = answered.length;
  document.getElementById('stat-highest').textContent = highest.toFixed(1);
  document.getElementById('stat-lowest').textContent = lowest.toFixed(1);
  document.getElementById('strengths-text').textContent = sess.strengths || 'Keep practicing!';
  document.getElementById('improvements-text').textContent = sess.improvements || 'Great job overall!';

  renderRoundPerformance(roundScores);
  renderScoreChart(questions);
  renderRoundChart(roundScores);
  renderLearningResources(roundScores, sess.job_role);
  renderBreakdown(questions);

  // Confetti for high scores
  if (avgScore >= APP_CONFIG.confettiThreshold && typeof confetti === 'function') {
    setTimeout(() => {
      confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, disableForReducedMotion: true });
      setTimeout(() => confetti({ particleCount: 100, spread: 100, origin: { y: 0.5 }, disableForReducedMotion: true }), 300);
    }, 800);
  }
}

// ── Round Performance Cards ──
function renderRoundPerformance(roundScores) {
  const container = document.getElementById('round-performance');
  const roundOrder = ['aptitude', 'technical', 'coding', 'hr', 'general'];

  const cards = roundOrder
    .filter(rt => roundScores[rt])
    .map(rt => {
      const rs = roundScores[rt];
      const roundConfig = APP_CONFIG.interviewRounds.find(r => r.id === rt);
      const color = roundConfig?.color || ['#f43f5e', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'][Object.keys(roundScores).indexOf(rt) % 5];
      const label = rs.label || (rt.charAt(0).toUpperCase() + rt.slice(1) + ' Round');
      const icon = APP_CONFIG.roundIcons?.[rt] || '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
      const avgDisplay = rs.average.toFixed(1);
      const scoreText = `${rs.total.toFixed(0)}/${rs.count * 10}`;
      const pct = rs.percentage;

      return `
        <div class="round-perf-card" style="--round-color: ${color}">
          <div class="round-perf-header">
            <div class="round-perf-icon">${icon}</div>
            <div class="round-perf-label">${label}</div>
          </div>
          <div class="round-perf-score">${avgDisplay}<span class="round-perf-max">/10</span></div>
          <div class="round-perf-bar">
            <div class="round-perf-fill" style="width:${pct}%; background: ${color};"></div>
          </div>
          <div class="round-perf-meta">${scoreText} • ${rs.answered}/${rs.count} answered</div>
        </div>`;
    });

  if (cards.length > 1) {
    container.innerHTML = `
      <div class="round-perf-title">Performance by Round</div>
      <div class="round-perf-grid">${cards.join('')}</div>`;
  } else {
    container.innerHTML = '';
  }
}

// ── Round Radar/Bar Chart ──
function renderRoundChart(roundScores) {
  const activeRounds = Object.keys(roundScores);

  if (activeRounds.length < 2) {
    document.getElementById('round-chart-section').style.display = 'none';
    return;
  }

  const ctx = document.getElementById('round-chart')?.getContext('2d');
  if (!ctx) return;
  const isDark = getCurrentTheme() === 'dark';

  const labels = activeRounds.map(rt => {
    return roundScores[rt]?.label?.replace(' Round', '') || rt;
  });
  const data = activeRounds.map(rt => roundScores[rt].average);
  const colors = activeRounds.map((rt, idx) => {
    const cfg = APP_CONFIG.interviewRounds.find(r => r.id === rt);
    return cfg?.color || ['#f43f5e', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'][idx % 5];
  });

  new Chart(ctx, {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: 'Score',
        data,
        backgroundColor: 'rgba(124, 92, 252, 0.15)',
        borderColor: '#7c5cfc',
        borderWidth: 2,
        pointBackgroundColor: colors,
        pointBorderColor: colors,
        pointRadius: 5,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0,
          max: 10,
          ticks: {
            stepSize: 2,
            color: isDark ? '#6b6b8d' : '#8b8ba8',
            backdropColor: 'transparent'
          },
          grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
          pointLabels: {
            color: isDark ? '#a0a0b8' : '#6b6b8d',
            font: { size: 13, weight: '600' }
          }
        }
      }
    }
  });
}

// ── Score Bar Chart ──
function renderScoreChart(questions) {
  const answered = questions.filter(q => q.score !== null);
  if (answered.length === 0) return;
  const ctx = document.getElementById('score-chart')?.getContext('2d');
  if (!ctx) return;
  const isDark = getCurrentTheme() === 'dark';

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: answered.map(q => `Q${q.question_number}`),
      datasets: [{
        label: 'Score', data: answered.map(q => q.score),
        backgroundColor: answered.map(q => {
          const rt = q.round_type || 'general';
          const cfg = APP_CONFIG.interviewRounds.find(r => r.id === rt);
          const color = cfg?.color || '#7c5cfc';
          return color + '99'; // Add alpha
        }),
        borderColor: answered.map(q => {
          const rt = q.round_type || 'general';
          const cfg = APP_CONFIG.interviewRounds.find(r => r.id === rt);
          return cfg?.color || '#7c5cfc';
        }),
        borderWidth: 2, borderRadius: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: isDark ? '#6b6b8d' : '#8b8ba8' } },
        y: { min: 0, max: 10, grid: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }, ticks: { color: isDark ? '#6b6b8d' : '#8b8ba8', stepSize: 2 } }
      }
    }
  });
}

// ── Learning Resources ──
function renderLearningResources(roundScores, jobRole) {
  const container = document.getElementById('learning-resources');
  const weakRounds = [];

  const roundOrder = ['aptitude', 'technical', 'coding', 'hr'];
  roundOrder.forEach(rt => {
    if (roundScores[rt] && roundScores[rt].average < 7) {
      weakRounds.push(rt);
    }
  });

  if (weakRounds.length === 0) {
    container.innerHTML = '';
    return;
  }

  const resourceMap = {
    aptitude: [
      { title: 'Logical Reasoning Practice', desc: 'Improve your analytical and pattern recognition skills', url: 'https://www.indiabix.com/logical-reasoning/questions-and-answers/', icon: '🧠' },
      { title: 'Quantitative Aptitude Guide', desc: 'Master numerical and mathematical problem-solving', url: 'https://www.geeksforgeeks.org/quantitative-aptitude/', icon: '📊' }
    ],
    technical: [
      { title: `${jobRole} Interview Questions`, desc: `Practice common ${jobRole} technical questions`, url: `https://www.google.com/search?q=${encodeURIComponent(jobRole + ' interview questions')}`, icon: '💻' },
      { title: 'System Design Primer', desc: 'Learn system design fundamentals and patterns', url: 'https://github.com/donnemartin/system-design-primer', icon: '🏗️' }
    ],
    coding: [
      { title: 'LeetCode Practice', desc: 'Practice coding problems by difficulty and topic', url: 'https://leetcode.com/problemset/', icon: '⌨️' },
      { title: 'NeetCode Roadmap', desc: 'Structured coding interview preparation roadmap', url: 'https://neetcode.io/roadmap', icon: '🗺️' }
    ],
    hr: [
      { title: 'STAR Method Guide', desc: 'Master the Situation-Task-Action-Result framework', url: 'https://www.google.com/search?q=STAR+method+interview+technique', icon: '⭐' },
      { title: 'Behavioral Interview Tips', desc: 'Common behavioral questions and winning strategies', url: 'https://www.google.com/search?q=behavioral+interview+questions+and+answers', icon: '🤝' }
    ]
  };

  const resources = weakRounds.flatMap(rt => resourceMap[rt] || []);
  if (resources.length === 0) return;

  container.innerHTML = `
    <div class="resources-title">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
      Suggested Learning Resources
      <span class="resources-subtitle">Based on your weak areas</span>
    </div>
    <div class="resources-grid">
      ${resources.map(r => `
        <a href="${r.url}" target="_blank" rel="noopener" class="resource-card">
          <span class="resource-icon">${r.icon}</span>
          <div class="resource-info">
            <div class="resource-name">${escapeHtml(r.title)}</div>
            <div class="resource-desc">${escapeHtml(r.desc)}</div>
          </div>
          <svg class="resource-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
        </a>
      `).join('')}
    </div>`;
}

// ── Question Breakdown ──
function renderBreakdown(questions) {
  document.getElementById('breakdown-list').innerHTML = questions.map((q, i) => {
    const rt = q.round_type || 'general';
    const qType = q.question_type || 'text';
    const roundConfig = APP_CONFIG.interviewRounds.find(r => r.id === rt);
    const roundColor = roundConfig?.color || '#7c5cfc';
    const roundLabel = roundConfig?.label || 'General';

    return `
    <div class="breakdown-item" id="breakdown-${i}">
      <div class="breakdown-item-header" onclick="toggleBreakdown(${i})">
        <div class="q-num" style="background: ${roundColor}22; color: ${roundColor}">${q.question_number}</div>
        <div class="q-text">${escapeHtml(q.question_text)}</div>
        <span class="breakdown-round-badge" style="color: ${roundColor}; background: ${roundColor}15; border: 1px solid ${roundColor}30">${roundLabel.replace(' Round', '')}</span>
        <span class="breakdown-type-badge">${qType.toUpperCase()}</span>
        ${q.score !== null ? `<div class="score-badge ${getScoreClass(q.score)}">${q.score}</div>` : '<span class="badge badge-warning">Skipped</span>'}
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="breakdown-item-body">
        <div class="breakdown-answer">
          <div style="font-size:var(--text-xs);font-weight:600;color:var(--text-tertiary);margin-bottom:var(--space-1);text-transform:uppercase;">Your Answer</div>
          ${q.user_answer === 'SKIPPED' ? '<em style="color:var(--warning-400);">Skipped</em>' :
            qType === 'code' ? `<pre style="background:#1a1b26;padding:var(--space-3);border-radius:var(--radius-lg);overflow-x:auto;"><code style="font-family:'JetBrains Mono',monospace;font-size:13px;color:#c0caf5;">${escapeHtml(q.user_answer || 'No answer')}</code></pre>` :
            escapeHtml(q.user_answer || 'No answer')}
        </div>
        <div class="breakdown-feedback">
          ${q.good_feedback ? `<div class="breakdown-feedback-item"><div class="label good">✓ What was good</div><p>${escapeHtml(q.good_feedback)}</p></div>` : ''}
          ${q.missing_feedback ? `<div class="breakdown-feedback-item"><div class="label missing">⚠ What was missing</div><p>${escapeHtml(q.missing_feedback)}</p></div>` : ''}
          ${q.ideal_answer ? `<div class="breakdown-feedback-item"><div class="label ideal">📖 Ideal Answer</div><p>${escapeHtml(q.ideal_answer)}</p></div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function handleShareResults() {
  const url = `${window.location.origin}/share?id=${getUrlParam('id')}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('Share link copied to clipboard!', 'success'));
  } else { prompt('Copy this link:', url); }
}
