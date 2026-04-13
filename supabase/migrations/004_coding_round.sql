-- ============================================
-- Migration 004: Coding Round Support
-- Adds coding metadata column for HackerRank style questions
-- ============================================

-- Add coding_metadata column to questions
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS coding_metadata JSONB;
