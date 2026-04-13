-- ============================================
-- Migration 003: Dynamic Rounds
-- Drops restrictive check constraints to allow
-- user-defined round naming and question types
-- ============================================

-- 1. Drop constraints on questions table to allow custom round_type and question_type
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_round_type_check;
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_question_type_check;

-- 2. Add round_label to explicitly store human-readable names for custom rounds
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS round_label TEXT;
