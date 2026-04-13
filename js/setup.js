// ============================================
// Setup Page — Logic (v3: Wizard Flow)
// ============================================

import { authService } from './services/authService.js?v=3';
import { supabase } from './services/supabaseClient.js';
import { generateQuestions, analyzeJD } from './services/aiService.js';
import { guardAuth } from './router.js?v=3';
import { APP_CONFIG } from './config.js';
import { initTheme, showToast, renderNavbar, getSuggestedDifficulty, setButtonLoading, escapeHtml } from './utils.js';
import { ROLE_DATA } from './role-data.js';

// ── State ──
let currentStep = 1;
let selectedRole = null;
let selectedCompany = null;
let selectedDifficulty = null;
let jdText = '';
let jdAnalysis = null;
let currentUserId = null;
let activeSuggestionIndex = -1;

// Round configurator state (deep copy from defaults)
let roundConfig = [];

function initRoundConfig() {
  roundConfig = APP_CONFIG.interviewRounds.map(r => ({
    ...r,
    questionCount: r.questionCount,
    enabled: r.enabled !== false
  }));
}

// ══════════════════════════════════
// Initialization
// ══════════════════════════════════
export async function initSetup() {
  initTheme();
  initRoundConfig();

  const result = await guardAuth();
  if (!result) return;
  const { session, profile } = result;
  currentUserId = session.user.id;

  document.getElementById('navbar-container').innerHTML = renderNavbar(profile, '');

  initAutocomplete();
  await loadSuggestedDifficulty(session.user.id);
  await loadSavedJDs(session.user.id);
  renderRoundConfigurator();

  // Bind global handlers
  window.selectCompany = handleSelectCompany;
  window.selectDifficulty = handleSelectDifficulty;
  window.startInterview = handleStartInterview;
  window.analyzeJD = handleAnalyzeJD;
  window.handleJDInput = handleJDInput;
  window.loadSavedJD = handleLoadSavedJD;
  window.clearRoleSearch = clearRoleSearch;
  window.handleSelectRole = handleSelectRole;

  // Wizard navigation
  window.wizardNext = wizardNext;
  window.wizardPrev = wizardPrev;
  window.wizardSkipTo = wizardSkipTo;

  // Round configurator
  window.toggleRound = toggleRound;
  window.adjustQuestionCount = adjustQuestionCount;

  showStep(1);
}

// ══════════════════════════════════
// Wizard Navigation
// ══════════════════════════════════
function showStep(step) {
  currentStep = step;

  // Update panels
  document.querySelectorAll('.wizard-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`step-${step}`);
  if (panel) {
    panel.classList.add('active');
    // Re-trigger animation
    panel.style.animation = 'none';
    panel.offsetHeight; // force reflow
    panel.style.animation = '';
  }

  // Update progress bar
  const steps = document.querySelectorAll('.wizard-step');
  const connectors = document.querySelectorAll('.wizard-connector');
  steps.forEach((s, i) => {
    const stepNum = i + 1;
    s.classList.remove('active', 'completed');
    if (stepNum === step) s.classList.add('active');
    else if (stepNum < step) s.classList.add('completed');
  });
  connectors.forEach((c, i) => {
    c.classList.toggle('completed', i + 1 < step);
  });

  // Step-specific logic
  if (step === 3) {
    renderRoundConfigurator();
    checkStep3Ready();
  }
  if (step === 4) {
    renderPreview();
  }
}

function wizardNext() {
  if (currentStep === 1) {
    // If JD is present, analyze it first, then go to step 2
    if (jdText && jdText.trim().length >= 20) {
      handleAnalyzeJD().then(() => showStep(2));
    } else {
      // No JD, skip analysis and go to customize
      showStep(3);
    }
    return;
  }
  if (currentStep < 4) showStep(currentStep + 1);
}

function wizardPrev() {
  if (currentStep === 3 && !jdAnalysis) {
    // If we skipped analysis, go back to step 1
    showStep(1);
    return;
  }
  if (currentStep > 1) showStep(currentStep - 1);
}

function wizardSkipTo(step) {
  showStep(step);
}

// ══════════════════════════════════
// Step 1: JD Input
// ══════════════════════════════════
function handleJDInput() {
  const input = document.getElementById('jd-input');
  const charCount = document.getElementById('jd-char-count');
  const analyzeBtn = document.getElementById('analyze-jd-btn');
  const nextBtn = document.getElementById('step1-next');
  jdText = input.value;
  charCount.textContent = `${jdText.length} characters`;
  const hasContent = jdText.trim().length >= 20;
  analyzeBtn.disabled = !hasContent;
  if (nextBtn) nextBtn.disabled = !hasContent;
}

async function loadSavedJDs(userId) {
  try {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, job_role, jd_text, created_at')
      .eq('user_id', userId)
      .not('jd_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5);

    if (sessions && sessions.length > 0) {
      const section = document.getElementById('saved-jd-section');
      const select = document.getElementById('saved-jd-select');
      section.classList.remove('hidden');
      select.innerHTML = '<option value="">📋 Load from previous sessions...</option>' +
        sessions.map(s => `<option value="${s.id}">${escapeHtml(s.job_role)} — ${new Date(s.created_at).toLocaleDateString()}</option>`).join('');
      select.dataset.sessions = JSON.stringify(sessions);
    }
  } catch (e) {
    console.log('No saved JDs found');
  }
}

function handleLoadSavedJD(sessionId) {
  if (!sessionId) return;
  const select = document.getElementById('saved-jd-select');
  const sessions = JSON.parse(select.dataset.sessions || '[]');
  const session = sessions.find(s => s.id === sessionId);
  if (session && session.jd_text) {
    document.getElementById('jd-input').value = session.jd_text;
    handleJDInput();
    showToast('JD loaded! Click "Analyze & Continue" to proceed.', 'info');
  }
}

// ══════════════════════════════════
// Step 2: AI Analysis
// ══════════════════════════════════
async function handleAnalyzeJD() {
  if (!jdText || jdText.trim().length < 20) {
    showToast('Please paste a valid Job Description (at least 20 characters)', 'warning');
    return;
  }

  // Show loading
  const loading = document.getElementById('analysis-loading');
  const results = document.getElementById('analysis-results');
  loading?.classList.remove('hidden');
  results?.classList.add('hidden');

  try {
    jdAnalysis = await analyzeJD({ jd_text: jdText });
    console.log('JD Analysis:', jdAnalysis);

    loading?.classList.add('hidden');
    results?.classList.remove('hidden');

    // Render analysis cards
    document.getElementById('jd-role').textContent = jdAnalysis.role_type || 'Unknown';
    document.getElementById('jd-experience').textContent = jdAnalysis.experience_level || 'Unknown';
    document.getElementById('jd-company').textContent =
      jdAnalysis.company_type === 'mnc' ? 'MNC / Enterprise' :
      jdAnalysis.company_type === 'faang' ? 'FAANG / Big Tech' : 'Startup';

    // Render skills
    document.getElementById('jd-skills').innerHTML = (jdAnalysis.required_skills || [])
      .map(skill => `<span class="skill-badge">${escapeHtml(skill)}</span>`).join('');

    // Render responsibilities
    const respSection = document.getElementById('jd-responsibilities-section');
    if (jdAnalysis.key_responsibilities && jdAnalysis.key_responsibilities.length > 0) {
      respSection.classList.remove('hidden');
      document.getElementById('jd-responsibilities').innerHTML =
        jdAnalysis.key_responsibilities
          .map(r => `<div class="jd-resp-item">• ${escapeHtml(r)}</div>`).join('');
    } else {
      respSection.classList.add('hidden');
    }

    // AI Suggestions
    const suggestionsEl = document.getElementById('ai-suggestions-content');
    const suggestions = [];
    if (jdAnalysis.required_skills && jdAnalysis.required_skills.length > 3) {
      suggestions.push(`Focus on the top skills: <strong>${jdAnalysis.required_skills.slice(0, 3).join(', ')}</strong>`);
    }
    if (jdAnalysis.experience_level) {
      const expMap = { junior: 'easy', mid: 'medium', senior: 'hard', lead: 'hard' };
      const sugDiff = expMap[jdAnalysis.experience_level.toLowerCase()] || 'medium';
      suggestions.push(`Recommended difficulty: <strong style="text-transform:capitalize;">${sugDiff}</strong> based on ${jdAnalysis.experience_level} experience level`);
    }
    if (jdAnalysis.company_type === 'faang' || jdAnalysis.company_type === 'mnc') {
      suggestions.push('Consider including system design questions in the technical round');
    }
    suggestions.push('All detected skills will be used to generate tailored questions');

    suggestionsEl.innerHTML = suggestions.map(s => `<div class="ai-suggestion-item">${s}</div>`).join('');

    // Auto-fill Step 3
    if (jdAnalysis.role_type) handleSelectRole(jdAnalysis.role_type, true);
    if (jdAnalysis.company_type) handleSelectCompany(jdAnalysis.company_type);
    if (jdAnalysis.suggested_difficulty) handleSelectDifficulty(jdAnalysis.suggested_difficulty);

    showToast('JD analyzed successfully!', 'success');
  } catch (err) {
    console.error('JD Analysis error:', err);
    loading?.classList.add('hidden');
    showToast(err.message || 'Failed to analyze Job Description', 'error');
  }
}

// ══════════════════════════════════
// Step 3: Customize
// ══════════════════════════════════

// ── Role Autocomplete ──
function initAutocomplete() {
  const input = document.getElementById('role-search-input');
  if (!input) return;

  input.addEventListener('input', (e) => {
    const value = e.target.value.trim();
    updateSuggestions(value);
    toggleClearBtn(value.length > 0);
    if (value.length > 0) {
      handleSelectRole(value, false);
    } else {
      selectedRole = null;
      checkStep3Ready();
    }
  });

  input.addEventListener('keydown', (e) => {
    const list = document.getElementById('role-suggestions');
    const items = list.querySelectorAll('.suggestion-item');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, items.length - 1);
      updateActiveSuggestion(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, -1);
      updateActiveSuggestion(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeSuggestionIndex > -1 && items[activeSuggestionIndex]) {
        items[activeSuggestionIndex].click();
      } else if (input.value.trim()) {
        handleSelectRole(input.value.trim(), true);
        list.classList.add('hidden');
      }
    } else if (e.key === 'Escape') {
      list.classList.add('hidden');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-container')) {
      document.getElementById('role-suggestions').classList.add('hidden');
    }
  });
}

function updateSuggestions(query) {
  const list = document.getElementById('role-suggestions');
  if (!query || query.length < 1) { list.classList.add('hidden'); return; }

  const filtered = ROLE_DATA.filter(role =>
    role.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 8);

  if (filtered.length === 0) { list.classList.add('hidden'); return; }

  activeSuggestionIndex = -1;
  list.innerHTML = filtered.map(role => {
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const highlighted = role.replace(regex, '<b>$1</b>');
    return `
      <div class="suggestion-item" onclick="handleSelectRole('${role.replace(/'/g, "\\'")}', true)">
        <svg class="suggestion-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span>${highlighted}</span>
      </div>`;
  }).join('');
  list.classList.remove('hidden');
}

function updateActiveSuggestion(items) {
  items.forEach((item, i) => {
    item.classList.toggle('active', i === activeSuggestionIndex);
    if (i === activeSuggestionIndex) item.scrollIntoView({ block: 'nearest' });
  });
}

function toggleClearBtn(show) {
  document.getElementById('clear-role-btn')?.classList.toggle('hidden', !show);
}

function clearRoleSearch() {
  const input = document.getElementById('role-search-input');
  input.value = '';
  input.focus();
  toggleClearBtn(false);
  document.getElementById('role-suggestions').classList.add('hidden');
  selectedRole = null;
  checkStep3Ready();
}

function handleSelectRole(role, updateInput = true) {
  selectedRole = role;
  if (updateInput) {
    const input = document.getElementById('role-search-input');
    if (input) input.value = role;
    document.getElementById('role-suggestions')?.classList.add('hidden');
    toggleClearBtn(true);
  }

  // Auto-toggle coding round based on role
  const hasCoding = APP_CONFIG.codingRoles.some(r => role.toLowerCase().includes(r.toLowerCase()));
  const codingRound = roundConfig.find(r => r.id === 'coding');
  if (codingRound) codingRound.enabled = hasCoding;
  renderRoundConfigurator();
  checkStep3Ready();
}

// ── Company ──
function handleSelectCompany(type) {
  selectedCompany = type;
  document.querySelectorAll('.company-option').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.company-option[data-value="${type}"]`)?.classList.add('selected');
  checkStep3Ready();
}

// ── Difficulty ──
function handleSelectDifficulty(level) {
  selectedDifficulty = level;
  document.querySelectorAll('.difficulty-option').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.difficulty-option[data-value="${level}"]`)?.classList.add('selected');
  checkStep3Ready();
}

async function loadSuggestedDifficulty(userId) {
  try {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('total_score, question_count')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(APP_CONFIG.difficultyAutoAdjustSessions);

    if (sessions && sessions.length > 0) {
      const totalScore = sessions.reduce((s, sess) => s + (sess.total_score || 0), 0);
      const totalQ = sessions.reduce((s, sess) => s + (sess.question_count || 1), 0);
      const avg = totalScore / totalQ;
      const suggested = getSuggestedDifficulty(avg);

      const el = document.getElementById('difficulty-suggestion');
      if (el) el.innerHTML =
        `💡 Based on your last ${sessions.length} session${sessions.length > 1 ? 's' : ''} (avg <strong>${avg.toFixed(1)}</strong>), we suggest <strong style="text-transform:capitalize;">${suggested}</strong> difficulty.`;

      handleSelectDifficulty(suggested);
    } else {
      handleSelectDifficulty('medium');
    }
  } catch {
    handleSelectDifficulty('medium');
  }
}

// ── Round Configurator ──
function renderRoundConfigurator() {
  const container = document.getElementById('round-configurator');
  if (!container) return;

  container.innerHTML = roundConfig.map(round => {
    const typeLabel = APP_CONFIG.questionTypes?.find(t => t.id === round.type)?.label || 'Text';
    return `
    <div class="round-config-card ${round.enabled ? '' : 'disabled'}" style="--round-color: ${round.color}" data-round="${round.id}">
      <div class="round-config-icon">${APP_CONFIG.roundIcons[round.id] || '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'}</div>
      <div class="round-config-info">
        <div class="round-config-name">${escapeHtml(round.label)}</div>
        <div class="round-config-meta">${round.enabled ? `${round.questionCount} Qs • ${typeLabel}` : 'Disabled'}</div>
      </div>
      <div class="round-config-controls w-full mt-2 sm:mt-0 sm:w-auto" style="display:flex; align-items:center; gap:var(--space-4);">
        ${round.enabled ? `
          <div class="question-counter">
            <button class="counter-btn" onclick="adjustQuestionCount('${round.id}', -1)" ${round.questionCount <= 1 ? 'disabled' : ''}>−</button>
            <span class="counter-value">${round.questionCount}</span>
            <button class="counter-btn" onclick="adjustQuestionCount('${round.id}', 1)">+</button>
          </div>
        ` : ''}
        <label class="toggle-switch">
          <input type="checkbox" ${round.enabled ? 'checked' : ''} onchange="toggleRound('${round.id}')">
          <span class="toggle-slider"></span>
        </label>
        ${round.isCustom ? `<button class="btn btn-icon" onclick="removeRound('${round.id}')" style="color:var(--danger-500);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
      </div>
    </div>
  `}).join('');
}

function toggleRound(roundId) {
  const round = roundConfig.find(r => r.id === roundId);
  if (round) {
    round.enabled = !round.enabled;
    renderRoundConfigurator();
    checkStep3Ready();
  }
}

function adjustQuestionCount(roundId, delta) {
  const round = roundConfig.find(r => r.id === roundId);
  if (round) {
    const newCount = round.questionCount + delta;
    if (newCount >= 1) { // No max limit
      round.questionCount = newCount;
      renderRoundConfigurator();
    }
  }
}

function checkStep3Ready() {
  const btn = document.getElementById('step3-next');
  const hasRole = selectedRole && selectedRole.trim().length > 0;
  const hasCompany = !!selectedCompany;
  const hasDifficulty = !!selectedDifficulty;
  const hasRounds = roundConfig.some(r => r.enabled);
  if (btn) btn.disabled = !(hasRole && hasCompany && hasDifficulty && hasRounds);
}

window.showAddRoundModal = function() {
  document.getElementById('custom-round-name').value = '';
  document.getElementById('custom-round-type').value = 'text';
  document.getElementById('custom-round-count').value = '5';
  document.getElementById('add-round-modal').classList.remove('hidden');
};

window.closeAddRoundModal = function() {
  document.getElementById('add-round-modal').classList.add('hidden');
};

window.confirmAddRound = function() {
  const label = document.getElementById('custom-round-name').value.trim();
  if (!label) {
    showToast('Please enter a round name', 'error');
    return;
  }
  
  const type = document.getElementById('custom-round-type').value;
  const qCount = parseInt(document.getElementById('custom-round-count').value, 10) || 5;

  const newId = label.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
  
  // Random color for custom round
  const colors = ['#f43f5e', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  roundConfig.push({
    id: newId,
    label: label,
    questionCount: qCount > 0 ? qCount : 5,
    type: type,
    color: color,
    timer: APP_CONFIG.questionTimer,
    enabled: true,
    isCustom: true
  });

  closeAddRoundModal();
  renderRoundConfigurator();
  checkStep3Ready();
};

window.removeRound = function(roundId) {
  roundConfig = roundConfig.filter(r => r.id !== roundId);
  renderRoundConfigurator();
  checkStep3Ready();
};


// ══════════════════════════════════
// Step 4: Preview
// ══════════════════════════════════
function renderPreview() {
  const activeRounds = roundConfig.filter(r => r.enabled);
  const totalQuestions = activeRounds.reduce((sum, r) => sum + r.questionCount, 0);
  const totalTime = activeRounds.reduce((sum, r) => sum + (r.questionCount * r.timer), 0);
  const companyLabel = APP_CONFIG.companyTypes.find(c => c.id === selectedCompany)?.label || selectedCompany;

  // Preview grid
  document.getElementById('preview-grid').innerHTML = `
    <div class="preview-item">
      <div class="preview-item-label">Job Role</div>
      <div class="preview-item-value">${escapeHtml(selectedRole)}</div>
    </div>
    <div class="preview-item">
      <div class="preview-item-label">Company Type</div>
      <div class="preview-item-value">${escapeHtml(companyLabel)}</div>
    </div>
    <div class="preview-item">
      <div class="preview-item-label">Difficulty</div>
      <div class="preview-item-value" style="text-transform:capitalize;">${selectedDifficulty}</div>
    </div>
  `;

  // Preview rounds
  document.getElementById('preview-rounds').innerHTML = activeRounds.map((round, i) => `
    <div class="preview-round-card" style="--round-color: ${round.color}">
      <div class="preview-round-icon">${APP_CONFIG.roundIcons[round.id] || ''}</div>
      <div class="preview-round-info">
        <div class="preview-round-name">${round.label}</div>
        <div class="preview-round-meta">${round.questionCount} questions • ${Math.floor(round.timer / 60)}min each</div>
      </div>
      <div class="preview-round-count">${round.questionCount}</div>
    </div>
  `).join('');

  // Total
  document.getElementById('preview-total').innerHTML = `
    <div class="preview-total-text">
      Total: <strong>${totalQuestions} questions</strong> across <strong>${activeRounds.length} rounds</strong>
      • Estimated time: <strong>${Math.ceil(totalTime / 60)} minutes</strong>
    </div>
  `;
}

// ══════════════════════════════════
// Start Interview
// ══════════════════════════════════
async function handleStartInterview() {
  if (!selectedRole || !selectedCompany || !selectedDifficulty) return;

  const btn = document.getElementById('start-btn');
  setButtonLoading(btn, true);

  try {
    const session = await authService.getSession();
    const activeRounds = roundConfig.filter(r => r.enabled);
    const totalQuestions = activeRounds.reduce((sum, r) => sum + r.questionCount, 0);
    const includeCoding = activeRounds.some(r => r.id === 'coding');

    // Create session in DB
    const sessionPayload = {
      user_id: session.user.id,
      job_role: selectedRole,
      company_type: selectedCompany,
      difficulty: selectedDifficulty,
      question_count: totalQuestions,
      status: 'in_progress'
    };

    if (jdText && jdText.trim().length > 0) {
      sessionPayload.jd_text = jdText.substring(0, 5000);
    }
    if (jdAnalysis) {
      sessionPayload.jd_analysis = jdAnalysis;
    }

    const { data: newSession, error } = await supabase
      .from('sessions')
      .insert(sessionPayload)
      .select()
      .single();

    if (error) throw error;
    console.log('Setup: Session created:', newSession.id);

    // Generate questions with round config
    await generateQuestions({
      session_id: newSession.id,
      job_role: selectedRole,
      company_type: selectedCompany,
      difficulty: selectedDifficulty,
      count: totalQuestions,
      jd_text: jdText || undefined,
      jd_analysis: jdAnalysis || undefined,
      include_coding: includeCoding,
      rounds: activeRounds.map(r => ({ id: r.id, label: r.label, type: r.type, questionCount: r.questionCount }))
    });

    window.location.href = `/interview?session=${newSession.id}`;
  } catch (err) {
    console.error('Setup: Start interview error:', err);
    showToast(err.message || 'Failed to start interview', 'error');
    setButtonLoading(btn, false);
  }
}
