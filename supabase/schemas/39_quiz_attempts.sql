-- ==========================================
-- TABLE: quiz_attempts
-- Depends on: 04_profiles.sql
-- ==========================================

CREATE TABLE public.quiz_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  score            int NOT NULL DEFAULT 0,
  total_questions  int NOT NULL DEFAULT 0,
  config           jsonb,
  started_at       timestamptz DEFAULT now(),
  completed_at     timestamptz
);

CREATE INDEX idx_quiz_attempts_user ON public.quiz_attempts(user_id);
