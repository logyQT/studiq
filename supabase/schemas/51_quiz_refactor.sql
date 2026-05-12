-- ==========================================
-- MIGRATION: Refactor quiz system to on-the-fly generation
-- Drops teacher-created quizzes, adds student-generated quiz attempts
-- ==========================================

-- Drop old quiz tables (cascade handles dependent objects)
DROP TABLE IF EXISTS public.quiz_questions CASCADE;
DROP TABLE IF EXISTS public.quizzes CASCADE;

-- Modify quiz_attempts: remove quiz_id, add config
ALTER TABLE public.quiz_attempts DROP COLUMN IF EXISTS quiz_id;
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS config jsonb;

-- Create new table to store which questions were in each generated attempt
CREATE TABLE IF NOT EXISTS public.quiz_attempt_questions (
  attempt_id  uuid REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  PRIMARY KEY (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempt_questions_attempt ON public.quiz_attempt_questions(attempt_id);
