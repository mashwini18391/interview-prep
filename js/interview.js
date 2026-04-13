// ============================================
// Interview Page — Logic (v3: Sequential Rounds)
// ============================================

import { authService } from './services/authService.js?v=3';
import { supabase } from './services/supabaseClient.js';
import { evaluateAnswer } from './services/aiService.js';
import { guardAuth } from './router.js?v=3';
import { APP_CONFIG } from './config.js';
import {
  initTheme, showToast, renderNavbar, getScoreClass, getScoreColor,
  escapeHtml, sanitizeInput, formatTime, setButtonLoading, getDifficultyBadge,
  getUrlParam
} from './utils.js';
import { SpeechHandler } from './speech.js';

let sessionId = null;
let sessionData = null;
let questions = [];
let currentIndex = 0;
let timerInterval = null;
let timeLeft = APP_CONFIG.questionTimer;
let speech = null;

// Round-based state
let rounds = [];           // Array of { id, label, color, questions: [] }
let currentRoundIndex = 0;
let roundCompleteShown = false;

export async function initInterview() {
  initTheme();

  const result = await guardAuth();
  if (!result) return;
  const { profile } = result;

  document.getElementById('navbar-container').innerHTML = renderNavbar(profile, '');

  console.log('Interview: Full URL search:', window.location.search);
  sessionId = getUrlParam('session') || getUrlParam('id');
  if (sessionId === 'undefined') sessionId = null;
  console.log('Interview: Received sessionId:', sessionId);

  if (!sessionId) {
    console.error('Interview: No valid session ID found in URL.');
    showToast('No session specified', 'error');
    setTimeout(() => window.location.href = '/setup', 1500);
    return;
  }

  speech = new SpeechHandler();

  // Expose handlers
  window.navigateQuestion = handleNavigate;
  window.navigateTo = handleNavigateTo;
  window.submitAnswer = handleSubmitAnswer;
  window.skipQuestion = handleSkipQuestion;
  window.onAnswerInput = handleAnswerInput;
  window.toggleVoice = handleToggleVoice;
  window.selectMCQ = handleSelectMCQ;
  window.continueToNextRound = handleContinueToNextRound;

  await loadSession();
}

async function loadSession() {
  try {
    const { data: sess, error: sErr } = await supabase
      .from('sessions').select('*').eq('id', sessionId).single();
    if (sErr) throw sErr;
    sessionData = sess;

    const { data: qs, error: qErr } = await supabase
      .from('questions').select('*').eq('session_id', sessionId)
      .order('question_number', { ascending: true });
    if (qErr) throw qErr;
    questions = qs || [];

    if (questions.length === 0) {
      showToast('No questions found for this session', 'error');
      return;
    }

    organizeRounds();

    document.getElementById('role-badge').textContent = sessionData.job_role;
    document.getElementById('difficulty-badge').innerHTML = getDifficultyBadge(sessionData.difficulty);

    // Find the first incomplete round
    currentRoundIndex = 0;
    for (let i = 0; i < rounds.length; i++) {
      if (!isRoundCompleted(i)) { currentRoundIndex = i; break; }
      if (i === rounds.length - 1) currentRoundIndex = i;
    }

    renderRoundStepper();
    renderDots();
    showQuestion(getFirstQuestionOfRound(currentRoundIndex));
  } catch (err) {
    console.error('Load session error:', err);
    showToast('Failed to load session', 'error');
  }
}

function organizeRounds() {
  rounds = [];
  let currentRoundId = null;
  let currentRoundObj = null;

  questions.forEach(q => {
    const rt = q.round_type || 'general';
    const rLabel = q.round_label || APP_CONFIG.interviewRounds.find(r => r.id === rt)?.label || (rt.charAt(0).toUpperCase() + rt.slice(1) + ' Round');

    if (rt !== currentRoundId) {
      currentRoundId = rt;
      const roundConfig = APP_CONFIG.interviewRounds.find(r => r.id === rt);
      
      currentRoundObj = {
        id: rt,
        label: rLabel,
        color: roundConfig?.color || ['#f43f5e', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'][rounds.length % 5],
        icon: APP_CONFIG.roundIcons?.[rt] || '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
        timer: roundConfig?.timer || APP_CONFIG.questionTimer,
        questions: []
      };
      rounds.push(currentRoundObj);
    }
    currentRoundObj.questions.push(q);
  });
}

// ── Round Helpers ──
function getFirstQuestionOfRound(roundIndex) {
  let offset = 0;
  for (let i = 0; i < roundIndex; i++) {
    offset += rounds[i].questions.length;
  }
  return offset;
}

function getRoundForQuestion(index) {
  let count = 0;
  for (let i = 0; i < rounds.length; i++) {
    count += rounds[i].questions.length;
    if (index < count) return i;
  }
  return rounds.length - 1;
}

function getIndexWithinRound(globalIndex) {
  let offset = 0;
  for (let i = 0; i < currentRoundIndex; i++) {
    offset += rounds[i].questions.length;
  }
  return globalIndex - offset;
}

function getTimerForQuestion(index) {
  const roundIdx = getRoundForQuestion(index);
  return rounds[roundIdx]?.timer || APP_CONFIG.questionTimer;
}

function isRoundCompleted(roundIndex) {
  return rounds[roundIndex].questions.every(q =>
    (q.score !== null && q.score !== undefined) || q.user_answer === 'SKIPPED'
  );
}

// ── Round Stepper ──
function renderRoundStepper() {
  const stepper = document.getElementById('round-stepper');
  if (rounds.length <= 1) { stepper.innerHTML = ''; return; }

  stepper.innerHTML = rounds.map((round, i) => {
    const isActive = i === currentRoundIndex;
    const isCompleted = isRoundCompleted(i);
    const isLocked = i > currentRoundIndex && !isRoundCompleted(currentRoundIndex);
    let cls = 'round-step';
    if (isActive) cls += ' active';
    if (isCompleted) cls += ' completed';
    if (isLocked) cls += ' locked';

    return `
      <div class="${cls}" style="--step-color: ${round.color}">
        <div class="round-step-icon">${isCompleted ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : round.icon}</div>
        <div class="round-step-label">${round.label.replace(' Round', '')}</div>
        <div class="round-step-count">${round.questions.length}Q</div>
      </div>
      ${i < rounds.length - 1 ? `<div class="round-step-connector ${isCompleted ? 'completed' : ''}"></div>` : ''}
    `;
  }).join('');
}

function renderCurrentRoundBadge() {
  const badge = document.getElementById('current-round-badge');
  if (rounds.length <= 1) { badge.innerHTML = ''; return; }
  const round = rounds[currentRoundIndex];
  if (!round) return;

  const answered = round.questions.filter(q =>
    (q.score !== null && q.score !== undefined) || q.user_answer === 'SKIPPED'
  ).length;

  badge.innerHTML = `
    <div class="round-badge-inner" style="--round-color: ${round.color}">
      <span class="round-badge-icon">${round.icon}</span>
      <span class="round-badge-text">${round.label}</span>
      <span class="round-badge-progress">${answered}/${round.questions.length}</span>
    </div>
  `;
}

// ── Dots (current round only) ──
function renderDots() {
  const dotsEl = document.getElementById('question-dots');
  const round = rounds[currentRoundIndex];
  if (!round) return;

  const startIdx = getFirstQuestionOfRound(currentRoundIndex);

  dotsEl.innerHTML = round.questions.map((q, i) => {
    const globalIdx = startIdx + i;
    let cls = 'q-dot';
    if (globalIdx === currentIndex) cls += ' active';
    if (q.score !== null && q.score !== undefined) cls += ' answered';
    else if (q.user_answer === 'SKIPPED') cls += ' skipped';

    return `<div class="${cls}" onclick="navigateTo(${globalIdx})" title="Q${i + 1}" style="--dot-color: ${round.color}"></div>`;
  }).join('');
}

function showQuestion(index) {
  currentIndex = index;
  const q = questions[index];
  const newRoundIndex = getRoundForQuestion(index);

  if (newRoundIndex !== currentRoundIndex) {
    currentRoundIndex = newRoundIndex;
    renderRoundStepper();
  }
  currentRoundIndex = newRoundIndex;
  renderCurrentRoundBadge();

  // Hide round-complete screen and show question UI
  document.getElementById('round-complete-screen').classList.add('hidden');
  document.getElementById('question-container').classList.remove('hidden');
  document.getElementById('question-actions').classList.remove('hidden');
  roundCompleteShown = false;

  // Progress (round-specific)
  const round = rounds[currentRoundIndex];
  const answered = round.questions.filter(q => q.score !== null || q.user_answer === 'SKIPPED').length;
  const localIdx = getIndexWithinRound(index);
  document.getElementById('progress-label').textContent = `Round ${currentRoundIndex + 1}/${rounds.length} • Q${localIdx + 1}/${round.questions.length}`;
  document.getElementById('progress-fill').style.width = `${(answered / round.questions.length) * 100}%`;

  // Restrict prev button to current round
  const roundStart = getFirstQuestionOfRound(currentRoundIndex);
  document.getElementById('prev-btn').disabled = index <= roundStart;

  resetTimer();

  const container = document.getElementById('question-container');
  const isAnswered = q.score !== null && q.score !== undefined;
  const qType = q.question_type || 'text';

  if (qType === 'code') {
    container.innerHTML = `
      <div class="card question-card code-split-view animate-fade-in-up" id="question-card-inner">
        <div class="code-split-left">
          <div class="question-number">
            <span class="q-badge" style="background: color-mix(in srgb, ${round?.color || '#7c5cfc'} 15%, transparent); color: ${round?.color || '#7c5cfc'}">${localIdx + 1}</span>
            Question ${localIdx + 1} of ${round.questions.length}
            <span class="q-type-badge q-type-${qType}">${qType.toUpperCase()}</span>
          </div>
          <div class="code-problem-title">${escapeHtml(q.coding_metadata?.title || 'Coding Challenge')}</div>
          <div class="question-text text-sm">${escapeHtml(q.coding_metadata?.description || q.question_text)}</div>
          
          ${q.coding_metadata?.inputFormat ? `
          <div class="code-problem-section">
            <h4>Input Format</h4>
            <div class="text-sm text-secondary">${escapeHtml(q.coding_metadata.inputFormat)}</div>
          </div>` : ''}
          
          ${q.coding_metadata?.outputFormat ? `
          <div class="code-problem-section">
            <h4>Output Format</h4>
            <div class="text-sm text-secondary">${escapeHtml(q.coding_metadata.outputFormat)}</div>
          </div>` : ''}

          ${q.coding_metadata?.constraints ? `
          <div class="code-problem-section">
            <h4>Constraints</h4>
            <pre>${escapeHtml(q.coding_metadata.constraints)}</pre>
          </div>` : ''}

          ${q.coding_metadata?.sampleInput ? `
          <div class="code-problem-section">
            <h4>Sample Input</h4>
            <pre>${escapeHtml(q.coding_metadata.sampleInput)}</pre>
          </div>` : ''}

          ${q.coding_metadata?.sampleOutput ? `
          <div class="code-problem-section">
            <h4>Sample Output</h4>
            <pre>${escapeHtml(q.coding_metadata.sampleOutput)}</pre>
          </div>` : ''}
        </div>
        
        <div class="code-split-right">
          <div class="code-editor-toolbar">
            <select id="code-language-select" onchange="changeLanguage()">
              <option value="javascript">JavaScript (Node.js)</option>
              <option value="python">Python 3</option>
              <option value="java">Java</option>
              <option value="cpp">C++</option>
            </select>
            <div>
              <button class="btn btn-secondary btn-sm" id="run-code-btn" onclick="runCode()" style="background:rgba(255,255,255,0.1); border:none; padding:4px 12px;">▶ Run Code</button>
            </div>
          </div>
          <div class="code-editor-container" id="editor-container"></div>
          <div class="code-terminal" id="code-terminal">
            Waiting for execution...
          </div>
        </div>
      </div>`;
      
      // Initialize Monaco via global window function asynchronously
      setTimeout(() => initMonacoEditor(q), 50);

  } else {
    container.innerHTML = `
      <div class="card question-card animate-fade-in-up" id="question-card-inner">
        <div class="question-number">
          <span class="q-badge" style="background: color-mix(in srgb, ${round?.color || '#7c5cfc'} 15%, transparent); color: ${round?.color || '#7c5cfc'}">${localIdx + 1}</span>
          Question ${localIdx + 1} of ${round.questions.length}
          <span class="q-type-badge q-type-${qType}">${qType.toUpperCase()}</span>
        </div>
        <div class="question-text">${escapeHtml(q.question_text)}</div>
        ${isAnswered ? renderAnsweredArea(q) : renderInputArea(q, qType)}
      </div>`;
  }

  const feedbackContainer = document.getElementById('feedback-container');
  if (isAnswered) {
    feedbackContainer.classList.remove('hidden');
    feedbackContainer.innerHTML = renderFeedback(q);
    updateSubmitForNext();
    document.getElementById('skip-btn').classList.add('hidden');
    stopTimer();
  } else {
    feedbackContainer.classList.add('hidden');
    feedbackContainer.innerHTML = '';
    resetSubmitButton();
    document.getElementById('skip-btn').classList.remove('hidden');
    if (qType === 'mcq') document.getElementById('submit-btn').disabled = true;
    startTimer();
  }

  renderDots();
  checkRoundDone();
}

// ── Input Renderers ──
function renderInputArea(q, qType) {
  if (qType === 'mcq') return renderMCQInput(q);
  if (qType === 'code') return renderCodeInput(q);
  return renderTextInput(q);
}

function renderTextInput(q) {
  return `
    <div class="answer-area">
      <textarea class="answer-textarea" id="answer-input" placeholder="Type your answer here... or use voice input"
        oninput="onAnswerInput()">${escapeHtml(q.user_answer || '')}</textarea>
      <div class="answer-actions">
        ${speech.supported ? `
          <button class="mic-btn" id="mic-btn" onclick="toggleVoice()" title="Voice input">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
            </svg>
          </button>` : ''}
      </div>
      <div class="char-count" id="char-count">0 characters</div>
      <div id="voice-indicator" class="hidden">
        <div class="voice-indicator"><span class="pulse-dot"></span> Listening... Speak your answer</div>
      </div>
    </div>`;
}

function renderMCQInput(q) {
  const options = q.mcq_options || [];
  return `
    <div class="answer-area mcq-area">
      <div class="mcq-options" id="mcq-options">
        ${options.map(opt => `
          <div class="mcq-option" data-value="${opt.label}" onclick="selectMCQ('${opt.label}')">
            <div class="mcq-option-label">${opt.label}</div>
            <div class="mcq-option-text">${escapeHtml(opt.text)}</div>
          </div>
        `).join('')}
      </div>
      <input type="hidden" id="answer-input" value="" />
    </div>`;
}

function renderCodeInput(q) {
  return `
    <div class="answer-area code-area">
      <div class="code-editor-header">
        <span class="code-lang-badge">Code</span>
        <span class="code-hint">Write your solution below</span>
      </div>
      <textarea class="code-textarea" id="answer-input" placeholder="// Write your code here...&#10;&#10;function solution() {&#10;  &#10;}"
        oninput="onAnswerInput()" spellcheck="false">${escapeHtml(q.user_answer || '')}</textarea>
      <div class="char-count" id="char-count">0 characters</div>
    </div>`;
}

function renderAnsweredArea(q) {
  const qType = q.question_type || 'text';
  let content;

  if (q.user_answer === 'SKIPPED') {
    content = '<em style="color:var(--warning-400);">Skipped</em>';
  } else if (qType === 'mcq') {
    const selected = q.user_answer?.trim().toUpperCase().charAt(0);
    const correct = q.correct_answer?.trim().toUpperCase().charAt(0);
    const options = q.mcq_options || [];
    content = options.map(opt => {
      const isSelected = opt.label === selected;
      const isCorrect = opt.label === correct;
      let cls = 'mcq-option-result';
      if (isSelected && isCorrect) cls += ' correct';
      else if (isSelected && !isCorrect) cls += ' wrong';
      else if (isCorrect) cls += ' correct-highlight';
      return `<div class="${cls}">
        <div class="mcq-option-label">${opt.label}</div>
        <div class="mcq-option-text">${escapeHtml(opt.text)}</div>
        ${isSelected ? '<span class="mcq-your-pick">Your answer</span>' : ''}
        ${isCorrect ? '<span class="mcq-correct-mark">✓ Correct</span>' : ''}
      </div>`;
    }).join('');
  } else if (qType === 'code') {
    content = `<pre class="code-answer-display"><code>${escapeHtml(q.user_answer || '')}</code></pre>`;
  } else {
    content = escapeHtml(q.user_answer || '');
  }

  return `
    <div class="answer-area">
      <div style="padding:var(--space-4);background:var(--bg-tertiary);border-radius:var(--radius-lg);font-size:var(--text-sm);color:var(--text-secondary);line-height:var(--leading-relaxed);">
        <div style="font-size:var(--text-xs);font-weight:600;color:var(--text-tertiary);margin-bottom:var(--space-2);text-transform:uppercase;">Your Answer</div>
        ${content}
      </div>
    </div>`;
}

function renderFeedback(q) {
  if (q.user_answer === 'SKIPPED') {
    return `
      <div class="card feedback-card" style="border-left-color:var(--warning-500);">
        <div class="feedback-header">
          <div class="feedback-score"><span class="score-num" style="color:var(--warning-500);">-</span><span class="score-max">/ 10</span></div>
          <span class="badge badge-warning">Skipped</span>
        </div>
        ${q.ideal_answer ? `<div class="feedback-section"><div class="feedback-section-title ideal"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> Ideal Answer</div><p>${escapeHtml(q.ideal_answer)}</p></div>` : ''}
      </div>`;
  }
  const scoreColor = getScoreColor(q.score);
  return `
    <div class="card feedback-card" style="border-left-color:${scoreColor};">
      <div class="feedback-header">
        <div class="feedback-score"><span class="score-num" style="color:${scoreColor};">${q.score}</span><span class="score-max">/ 10</span></div>
        <span class="score-badge ${getScoreClass(q.score)}">${q.score}/10</span>
      </div>
      ${q.good_feedback ? `<div class="feedback-section"><div class="feedback-section-title good"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 4 12 14.01 9 11.01"/></svg> What was good</div><p>${escapeHtml(q.good_feedback)}</p></div>` : ''}
      ${q.missing_feedback ? `<div class="feedback-section"><div class="feedback-section-title missing"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> What was missing</div><p>${escapeHtml(q.missing_feedback)}</p></div>` : ''}
      ${q.ideal_answer ? `<div class="feedback-section"><div class="feedback-section-title ideal"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> Ideal Answer</div><p>${escapeHtml(q.ideal_answer)}</p></div>` : ''}
    </div>`;
}

// ── Timer ──
function startTimer() {
  timeLeft = getTimerForQuestion(currentIndex);
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) { stopTimer(); handleSubmitAnswer(); }
  }, 1000);
}
function stopTimer() { if (timerInterval) clearInterval(timerInterval); }
function resetTimer() { stopTimer(); timeLeft = getTimerForQuestion(currentIndex); updateTimerDisplay(); }
function updateTimerDisplay() {
  const display = document.getElementById('timer-display');
  const timer = document.getElementById('timer');
  display.textContent = formatTime(timeLeft);
  timer.className = 'timer';
  if (timeLeft <= 30) timer.classList.add('danger');
  else if (timeLeft <= 60) timer.classList.add('warning');
}

// ── MCQ ──
function handleSelectMCQ(label) {
  const input = document.getElementById('answer-input');
  if (input) input.value = label;
  document.querySelectorAll('.mcq-option').forEach(opt => {
    opt.classList.remove('selected');
    if (opt.dataset.value === label) opt.classList.add('selected');
  });
  document.getElementById('submit-btn').disabled = false;
}

// ── Handlers ──
function handleAnswerInput() {
  const input = document.getElementById('answer-input');
  if (input) {
    document.getElementById('submit-btn').disabled = input.value.trim().length === 0;
    const charCount = document.getElementById('char-count');
    if (charCount) charCount.textContent = `${input.value.length} characters`;
  }
}

function handleToggleVoice() {
  const input = document.getElementById('answer-input');
  const micBtn = document.getElementById('mic-btn');
  const indicator = document.getElementById('voice-indicator');
  if (speech.isRecording) {
    const text = speech.stop();
    if (input && text) input.value = text;
    micBtn?.classList.remove('recording');
    indicator?.classList.add('hidden');
    handleAnswerInput();
  } else {
    speech.onResult = (result) => { if (input) input.value = result.combined; handleAnswerInput(); };
    speech.onStateChange = (recording) => {
      recording ? micBtn?.classList.add('recording') : micBtn?.classList.remove('recording');
      recording ? indicator?.classList.remove('hidden') : indicator?.classList.add('hidden');
    };
    speech.start(input?.value || '');
  }
}

async function handleSubmitAnswer() {
  const q = questions[currentIndex];
  const qType = q.question_type || 'text';
  let rawAnswer = '';

  if (qType === 'code' && monacoEditorInstance) {
    rawAnswer = monacoEditorInstance.getValue();
  } else {
    const input = document.getElementById('answer-input');
    rawAnswer = input?.value || '';
  }

  const answer = sanitizeInput(rawAnswer);
  if (!answer || answer.trim().length === 0) {
    showToast('Please provide your answer', 'warning');
    return;
  }

  if (speech?.isRecording) speech.stop();
  stopTimer();

  const btn = document.getElementById('submit-btn');
  setButtonLoading(btn, true);
  document.getElementById('skip-btn').classList.add('hidden');

  const feedbackContainer = document.getElementById('feedback-container');

  feedbackContainer.classList.remove('hidden');
  feedbackContainer.innerHTML = `<div class="card feedback-card"><div class="eval-loading"><div class="spinner"></div><span>${qType === 'mcq' ? 'Checking answer...' : 'AI is evaluating your answer...'}</span></div></div>`;

  try {
    const evalData = await evaluateAnswer({
      question_id: q.id,
      answer,
      question_text: q.question_text,
      job_role: sessionData.job_role,
      difficulty: sessionData.difficulty,
      question_type: qType,
      round_type: q.round_type || 'general',
      correct_answer: q.correct_answer,
      mcq_options: q.mcq_options,
      execution_result: q._lastExecutionResult || null
    });

    q.user_answer = answer;
    q.score = evalData.score;
    q.good_feedback = evalData.good;
    q.missing_feedback = evalData.missing;
    q.ideal_answer = evalData.ideal;
    q.time_taken = getTimerForQuestion(currentIndex) - timeLeft;

    showQuestion(currentIndex);
  } catch (err) {
    console.error('Evaluation error:', err);
    showToast('Failed to evaluate answer. Please try again.', 'error');
    feedbackContainer.classList.add('hidden');
    setButtonLoading(btn, false);
    document.getElementById('skip-btn').classList.remove('hidden');
  }
}

async function handleSkipQuestion() {
  const q = questions[currentIndex];
  if (speech?.isRecording) speech.stop();
  stopTimer();
  try {
    await supabase.from('questions').update({ user_answer: 'SKIPPED', answered_at: new Date().toISOString() }).eq('id', q.id);
    q.user_answer = 'SKIPPED';
    // Check if this was the last question in the round
    checkRoundDone();
    if (!roundCompleteShown) {
      const roundEnd = getFirstQuestionOfRound(currentRoundIndex) + rounds[currentRoundIndex].questions.length - 1;
      if (currentIndex < roundEnd) handleNavigate(1);
    }
  } catch { showToast('Failed to skip question', 'error'); }
}

function handleNavigate(delta) {
  const next = currentIndex + delta;
  // Restrict navigation to current round
  const roundStart = getFirstQuestionOfRound(currentRoundIndex);
  const roundEnd = roundStart + rounds[currentRoundIndex].questions.length - 1;
  if (next >= roundStart && next <= roundEnd) {
    if (speech?.isRecording) speech.stop();
    showQuestion(next);
  }
}

function handleNavigateTo(index) {
  // Restrict to current round
  const roundStart = getFirstQuestionOfRound(currentRoundIndex);
  const roundEnd = roundStart + rounds[currentRoundIndex].questions.length - 1;
  if (index >= roundStart && index <= roundEnd) {
    if (speech?.isRecording) speech.stop();
    showQuestion(index);
  }
}

function updateSubmitForNext() {
  const btn = document.getElementById('submit-btn');
  const roundEnd = getFirstQuestionOfRound(currentRoundIndex) + rounds[currentRoundIndex].questions.length - 1;
  const isLastInRound = currentIndex >= roundEnd;
  const allDone = rounds.every((_, i) => isRoundCompleted(i));

  if (isLastInRound && isRoundCompleted(currentRoundIndex)) {
    btn.textContent = allDone ? 'View Results' : 'Finish Round';
  } else {
    btn.textContent = 'Next →';
  }
  btn.disabled = false;
  btn.onclick = () => {
    if (isLastInRound && isRoundCompleted(currentRoundIndex)) {
      if (allDone) {
        // Navigate directly to summary
        window.location.href = `/summary?id=${sessionId}`;
      } else {
        checkRoundDone();
      }
    } else {
      handleNavigate(1);
    }
  };
}

function resetSubmitButton() {
  const btn = document.getElementById('submit-btn');
  btn.innerHTML = 'Submit Answer <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
  btn.disabled = true;
  btn.onclick = () => handleSubmitAnswer();
}

// ══════════════════════════════════
// Round Completion Logic
// ══════════════════════════════════
function checkRoundDone() {
  if (!isRoundCompleted(currentRoundIndex)) return;

  // Check if ALL rounds are done
  const allDone = rounds.every((_, i) => isRoundCompleted(i));

  if (allDone) {
    // Show finish banner with working link
    document.getElementById('finish-banner').classList.remove('hidden');
    const resultsBtn = document.getElementById('view-results-btn');
    resultsBtn.href = `/summary?id=${sessionId}`;
    resultsBtn.onclick = (e) => {
      e.preventDefault();
      window.location.href = `/summary?id=${sessionId}`;
    };
    return;
  }

  // Show round-complete screen if there are more rounds
  if (currentRoundIndex < rounds.length - 1) {
    showRoundCompleteScreen();
  }
}

function showRoundCompleteScreen() {
  roundCompleteShown = true;
  const round = rounds[currentRoundIndex];
  const qs = round.questions;
  const totalScore = qs.reduce((s, q) => s + (q.score || 0), 0);
  const answered = qs.filter(q => q.score !== null && q.score !== undefined).length;
  const avg = answered > 0 ? totalScore / answered : 0;
  const pct = answered > 0 ? (totalScore / (answered * 10)) * 100 : 0;

  // Hide question UI, show round-complete
  document.getElementById('question-container').classList.add('hidden');
  document.getElementById('question-actions').classList.add('hidden');
  document.getElementById('feedback-container').classList.add('hidden');

  const screen = document.getElementById('round-complete-screen');
  screen.classList.remove('hidden');

  document.getElementById('round-complete-icon').innerHTML = round.icon;
  document.getElementById('round-complete-icon').style.color = round.color;
  document.getElementById('round-complete-title').textContent = `${round.label} Complete!`;

  const scoreColor = getScoreColor(avg);
  document.getElementById('round-complete-score').innerHTML = `
    <div class="rcs-score-display" style="--score-color: ${scoreColor}">
      <span class="rcs-score-num">${avg.toFixed(1)}</span>
      <span class="rcs-score-max">/ 10</span>
    </div>
    <div class="rcs-score-bar">
      <div class="rcs-score-fill" style="width:${pct}%; background:${round.color};"></div>
    </div>
    <div class="rcs-score-meta">${totalScore}/${answered * 10} points • ${answered} answered, ${qs.length - answered} skipped</div>
  `;

  // Mini breakdown
  document.getElementById('round-complete-breakdown').innerHTML = qs.map((q, i) => {
    const sc = q.score !== null && q.score !== undefined ? q.score : '-';
    const scColor = q.score !== null ? getScoreColor(q.score) : 'var(--warning-400)';
    return `
      <div class="rcs-breakdown-item">
        <span class="rcs-q-num">Q${i + 1}</span>
        <span class="rcs-q-text">${escapeHtml(q.question_text).substring(0, 60)}${q.question_text.length > 60 ? '...' : ''}</span>
        <span class="rcs-q-score" style="color:${scColor}">${sc}/10</span>
      </div>`;
  }).join('');

  // Update button text for last round
  const nextBtn = document.getElementById('next-round-btn');
  if (currentRoundIndex >= rounds.length - 1) {
    nextBtn.innerHTML = 'View Results <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
    nextBtn.onclick = () => { window.location.href = `/summary?id=${sessionId}`; };
  } else {
    const nextRound = rounds[currentRoundIndex + 1];
    nextBtn.innerHTML = `Continue to ${nextRound.label} <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
  }
}
function handleContinueToNextRound() {
  if (currentRoundIndex >= rounds.length - 1) {
    window.location.href = `/summary?id=${sessionId}`;
    return;
  }
  currentRoundIndex++;
  document.getElementById('round-complete-screen').classList.add('hidden');
  renderRoundStepper();
  renderDots();
  showQuestion(getFirstQuestionOfRound(currentRoundIndex));
}

// ══════════════════════════════════
// Monaco Editor & Execution Logic
// ══════════════════════════════════
let monacoEditorInstance = null;

window.initMonacoEditor = function(q) {
  const container = document.getElementById('editor-container');
  if (!container) return;

  // Set default language based on JD logic or default javascript
  const langSelect = document.getElementById('code-language-select');
  let defaultLang = 'javascript';
  if (sessionData?.jd_analysis?.required_skills) {
    const skills = sessionData.jd_analysis.required_skills.map(s => s.toLowerCase());
    if (skills.includes('python')) defaultLang = 'python';
    else if (skills.includes('java')) defaultLang = 'java';
    else if (skills.includes('c++') || skills.includes('cpp')) defaultLang = 'cpp';
  }
  langSelect.value = defaultLang;

  // Destroy previous instance
  if (monacoEditorInstance) {
    monacoEditorInstance.dispose();
  }

  // Use RequireJS AMD loader included in HTML
  if (window.require) {
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.46.0/min/vs' }});
    require(['vs/editor/editor.main'], function() {
      monacoEditorInstance = monaco.editor.create(container, {
        value: q.user_answer || '// Write your code here...',
        language: defaultLang,
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "'JetBrains Mono', monospace",
        scrollBeyondLastLine: false,
        padding: { top: 16 }
      });

      monacoEditorInstance.onDidChangeModelContent(() => {
        // Mock onAnswerInput handler to sync with the main flow so user_answer is tracked
        q.user_answer = monacoEditorInstance.getValue();
        document.getElementById('submit-btn').disabled = q.user_answer.trim().length === 0;
      });
      
      // Re-trigger visual sync
      document.getElementById('submit-btn').disabled = !q.user_answer || q.user_answer.trim().length === 0;
    });
  } else {
    container.innerHTML = '<div style="padding:1rem;color:red;">Failed to load code editor. Please check connection.</div>';
  }
};

window.changeLanguage = function() {
  if (monacoEditorInstance) {
    const lang = document.getElementById('code-language-select').value;
    monaco.editor.setModelLanguage(monacoEditorInstance.getModel(), lang);
  }
};

window.runCode = async function() {
  const term = document.getElementById('code-terminal');
  const btn = document.getElementById('run-code-btn');
  const q = questions[currentIndex];
  
  if (!monacoEditorInstance || !q) return;

  const code = monacoEditorInstance.getValue();
  if (code.trim().length === 0) {
    term.innerHTML = '<span style="color:var(--warning-500)">Error: Please write some code before running.</span>';
    return;
  }

  const lang = document.getElementById('code-language-select').value;
  term.innerHTML = '<span style="color:var(--primary-400)">Compiling and running against test cases...</span>';
  btn.disabled = true;
  btn.textContent = 'Running...';

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    
    // Check difficulty to determine timeout
    let timeoutMs = 2000;
    if (sessionData?.difficulty === 'medium') timeoutMs = 3000;
    if (sessionData?.difficulty === 'hard') timeoutMs = 5000;

    const res = await fetch(`${APP_CONFIG.supabaseUrl}/functions/v1/run-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        language: lang,
        code: code,
        testCases: q.coding_metadata?.testCases || [],
        timeoutMs: timeoutMs
      })
    });

    const result = await res.json();
    btn.disabled = false;
    btn.innerHTML = '▶ Run Code';

    if (!res.ok) {
      term.innerHTML = `<span style="color:var(--danger-500)">Execution Failed: ${escapeHtml(result.error || 'Server error')}</span>`;
      return;
    }

    // Process output
    let outputHtml = '';
    const results = result.results || [];
    let passedCount = 0;

    results.forEach((tr, idx) => {
      if (tr.passed) passedCount++;
      const color = tr.passed ? 'var(--success-500)' : 'var(--danger-500)';
      outputHtml += `<div style="margin-bottom:8px; border-bottom:1px solid #333; padding-bottom:8px;">
        <strong style="color:${color}">Test Case ${idx + 1}: ${tr.passed ? 'PASSED' : 'FAILED'}</strong><br/>
        <span style="color:#888">Input:</span> ${escapeHtml(tr.input)}<br/>
        <span style="color:#888">Expected:</span> ${escapeHtml(tr.expected)}<br/>
        <span style="color:#888">Actual Output:</span> <span style="color:${tr.passed ? '#d4d4d4' : 'var(--danger-400)'}">${escapeHtml(tr.output || 'No output')}</span>
        ${tr.error ? `<br/><span style="color:var(--danger-500)">Error: ${escapeHtml(tr.error)}</span>` : ''}
      </div>`;
    });

    outputHtml = `<div style="margin-bottom:12px; font-weight:bold; color:${passedCount === results.length ? 'var(--success-500)' : 'var(--warning-500)'}">
      Overall: ${passedCount} / ${results.length} Test Cases Passed (${result.total_time}ms)
    </div>` + outputHtml;

    term.innerHTML = outputHtml;
    
    // Store quick reference inside question object to be used by actual Submit logic
    q._lastExecutionResult = result;

  } catch (err) {
    console.error('Run code error', err);
    btn.disabled = false;
    btn.innerHTML = '▶ Run Code';
    term.innerHTML = '<span style="color:var(--danger-500)">Connection error while trying to run code.</span>';
  }
};

window.continueToNextRound = handleContinueToNextRound;

export { };
