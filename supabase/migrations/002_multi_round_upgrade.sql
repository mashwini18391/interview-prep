-- ============================================
-- Migration 002: Multi-Round Interview Upgrade
-- Adds JD support, round types, and question types
-- Run this in Supabase SQL Editor
-- ============================================

-- =====================
-- 1. SESSIONS TABLE — New Columns
-- =====================

-- Store the pasted Job Description text for reuse
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS jd_text TEXT;

-- Store the AI-extracted analysis of the JD (skills, level, responsibilities)
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS jd_analysis JSONB;

-- Store per-round score breakdown: { "aptitude": 8, "technical": 7, "hr": 9 }
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS round_scores JSONB;

-- =====================
-- 2. QUESTIONS TABLE — New Columns
-- =====================

-- Which interview round this question belongs to
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS round_type TEXT DEFAULT 'general'
  CHECK (round_type IN ('aptitude', 'technical', 'coding', 'hr', 'general'));

-- The input type for this question
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS question_type TEXT DEFAULT 'text'
  CHECK (question_type IN ('mcq', 'text', 'code'));

-- MCQ options as JSON array: [{"label":"A","text":"Option text"},...]
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS mcq_options JSONB;

-- The correct answer for MCQ questions (e.g., "B")
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS correct_answer TEXT;

-- =====================
-- 3. INDEXES for new columns
-- =====================
CREATE INDEX IF NOT EXISTS idx_questions_round_type ON public.questions(round_type);
CREATE INDEX IF NOT EXISTS idx_questions_question_type ON public.questions(question_type);
CREATE INDEX IF NOT EXISTS idx_sessions_jd ON public.sessions((jd_text IS NOT NULL));
