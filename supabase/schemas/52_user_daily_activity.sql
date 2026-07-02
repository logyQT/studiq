-- ==========================================
-- TABLE: user_daily_activity
-- Precomputed daily stats for fast dashboard queries.
-- Updated via triggers on flashcard_practice and quiz_attempts.
-- Depends on: 04_profiles.sql
-- ==========================================

CREATE TABLE public.user_daily_activity (
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date           date NOT NULL,
  reviews_count  integer NOT NULL DEFAULT 0,
  reviews_correct integer NOT NULL DEFAULT 0,
  quizzes_count  integer NOT NULL DEFAULT 0,
  quizzes_score  integer NOT NULL DEFAULT 0,
  quizzes_total  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- ==========================================
-- TRIGGER: increment_reviews
-- Fires on flashcard_practice INSERT and bumps
-- daily activity counters atomically.
-- ==========================================

CREATE OR REPLACE FUNCTION public.increment_reviews()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.user_daily_activity (user_id, date, reviews_count, reviews_correct)
  VALUES (NEW.user_id, NEW.practiced_at::date, 1, CASE WHEN NEW.was_correct THEN 1 ELSE 0 END)
  ON CONFLICT (user_id, date) DO UPDATE SET
    reviews_count = public.user_daily_activity.reviews_count + 1,
    reviews_correct = public.user_daily_activity.reviews_correct + CASE WHEN NEW.was_correct THEN 1 ELSE 0 END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reviews
  AFTER INSERT ON public.flashcard_practice
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_reviews();

-- ==========================================
-- TRIGGER: increment_quizzes
-- Fires on quiz_attempts INSERT and bumps
-- daily activity counters atomically.
-- Uses started_at (not completed_at) because
-- completed_at is null on initial insert.
-- ==========================================

CREATE OR REPLACE FUNCTION public.increment_quizzes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.user_daily_activity (user_id, date, quizzes_count, quizzes_score, quizzes_total)
  VALUES (NEW.user_id, NEW.started_at::date, 1, NEW.score, NEW.total_questions)
  ON CONFLICT (user_id, date) DO UPDATE SET
    quizzes_count = public.user_daily_activity.quizzes_count + 1,
    quizzes_score = public.user_daily_activity.quizzes_score + NEW.score,
    quizzes_total = public.user_daily_activity.quizzes_total + NEW.total_questions;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_quizzes
  AFTER INSERT ON public.quiz_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_quizzes();
