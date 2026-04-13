// ============================================
// Config — Re-exports for backward compatibility
// All Supabase config now lives in services/supabaseClient.js
// ============================================

console.log('Config: Loading modules from supabaseClient.js...');
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, EDGE_FUNCTION_URL } from './services/supabaseClient.js';
export { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, EDGE_FUNCTION_URL };
console.log('Config: Modules exported successfully');

// App Configuration — kept here as it's app-level, not service-level
const APP_CONFIG = {
  appName: 'InterviewAI',
  version: '3.0.0',
  supabaseUrl: SUPABASE_URL,

  companyTypes: [
    { id: 'startup', label: 'Startup', desc: 'Fast-paced, hands-on roles', icon: 'rocket' },
    { id: 'mnc', label: 'MNC / Enterprise', desc: 'Structured, process-driven', icon: 'building' },
    { id: 'faang', label: 'FAANG / Big Tech', desc: 'Advanced system design focus', icon: 'zap' }
  ],

  difficulties: [
    { id: 'easy', label: 'Easy', color: 'var(--success-500)', description: 'Fundamentals & basics' },
    { id: 'medium', label: 'Medium', color: 'var(--warning-500)', description: 'Intermediate concepts' },
    { id: 'hard', label: 'Hard', color: 'var(--danger-500)', description: 'Advanced & system design' }
  ],

  // Multi-round interview configuration (defaults — user can toggle/adjust)
  interviewRounds: [
    { id: 'aptitude', label: 'Aptitude Round', icon: 'brain', questionCount: 4, type: 'mcq', color: '#7c5cfc', timer: 60, enabled: true },
    { id: 'technical', label: 'Technical Round', icon: 'cpu', questionCount: 3, type: 'text', color: '#0ea5e9', timer: 180, enabled: true },
    { id: 'coding', label: 'Coding Round', icon: 'code', questionCount: 2, type: 'code', color: '#22c55e', timer: 300, enabled: true },
    { id: 'hr', label: 'HR Round', icon: 'users', questionCount: 2, type: 'text', color: '#f59e0b', timer: 180, enabled: true }
  ],

  // Roles that include a coding round (others skip it by default)
  codingRoles: [
    'Software Engineer', 'Frontend Developer', 'Backend Developer', 'Full Stack Developer',
    'Mobile App Developer', 'Android Developer', 'iOS Developer', 'Game Developer',
    'Data Scientist', 'Machine Learning Engineer', 'ML Engineer',
    'DevOps Engineer', 'Cloud Architect', 'Site Reliability Engineer',
    'Embedded Systems Engineer', 'Blockchain Developer',
    'React Developer', 'Angular Developer', 'Vue.js Developer',
    'Node.js Developer', 'Python Developer', 'Java Developer',
    'Go Developer', 'Web Developer', 'SDET', 'QA Engineer'
  ],

  // Round icons SVGs for use in UI
  roundIcons: {
    aptitude: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/></svg>',
    technical: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>',
    coding: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    hr: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
  },

  // Auto-adjust uses last 3 sessions
  difficultyAutoAdjustSessions: 3,

  defaultQuestionCount: 5,
  minQuestions: 5,
  maxQuestions: 10,

  // Default timer per question (seconds) — overridden by round-specific timers
  questionTimer: 180,

  questionTypes: [
    { id: 'mcq', label: 'Multiple Choice (MCQ)' },
    { id: 'text', label: 'Text / Discussion / Voice' },
    { id: 'code', label: 'Coding / Technical' }
  ],

  // Confetti threshold
  confettiThreshold: 9
};

export { APP_CONFIG };
