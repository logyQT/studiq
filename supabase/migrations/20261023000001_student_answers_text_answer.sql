-- ============================================
-- Migration: student_answers.text_answer
-- Date: 2026-10-23
--
-- Fixes #176. `supabase/schemas/42_student_answers.sql` declares a
-- `text_answer` column, but no migration ever added it, so a typed answer to
-- an `open` question had nowhere to go and clients were forced to send it as
-- `selected_option_id` (which is UUID-only and was rejected at validation).
-- ============================================

ALTER TABLE public.student_answers
  ADD COLUMN IF NOT EXISTS text_answer text;

COMMENT ON COLUMN public.student_answers.text_answer IS
  'Free-text answer for an open question; mutually exclusive with selected_option_id';
