-- Add daily review goal to user_study_settings
ALTER TABLE public.user_study_settings
ADD COLUMN IF NOT EXISTS daily_review_goal INTEGER NOT NULL DEFAULT 0;

-- Daily activity table (precomputed stats for fast queries)
CREATE TABLE IF NOT EXISTS public.user_daily_activity (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  reviews_count INTEGER NOT NULL DEFAULT 0,
  reviews_correct INTEGER NOT NULL DEFAULT 0,
  quizzes_count INTEGER NOT NULL DEFAULT 0,
  quizzes_score INTEGER NOT NULL DEFAULT 0,
  quizzes_total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- Trigger: increment reviews on flashcard_practice insert
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

DROP TRIGGER IF EXISTS trg_reviews ON public.flashcard_practice;
CREATE TRIGGER trg_reviews
  AFTER INSERT ON public.flashcard_practice
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_reviews();

-- Trigger: increment quizzes on quiz_attempts insert
CREATE OR REPLACE FUNCTION public.increment_quizzes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.user_daily_activity (user_id, date, quizzes_count, quizzes_score, quizzes_total)
  VALUES (NEW.user_id, NEW.completed_at::date, 1, NEW.score, NEW.total_questions)
  ON CONFLICT (user_id, date) DO UPDATE SET
    quizzes_count = public.user_daily_activity.quizzes_count + 1,
    quizzes_score = public.user_daily_activity.quizzes_score + NEW.score,
    quizzes_total = public.user_daily_activity.quizzes_total + NEW.total_questions;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quizzes ON public.quiz_attempts;
CREATE TRIGGER trg_quizzes
  AFTER INSERT ON public.quiz_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_quizzes();

-- Index for weak-points queries
CREATE INDEX IF NOT EXISTS idx_practice_user_correct ON public.flashcard_practice(user_id, was_correct);

-- Backfill existing data
INSERT INTO public.user_daily_activity (user_id, date, reviews_count, reviews_correct)
SELECT user_id, practiced_at::date, COUNT(*), COUNT(*) FILTER (WHERE was_correct)
FROM public.flashcard_practice
GROUP BY user_id, practiced_at::date
ON CONFLICT DO NOTHING;

INSERT INTO public.user_daily_activity (user_id, date, quizzes_count, quizzes_score, quizzes_total)
SELECT user_id, completed_at::date, COUNT(*), COALESCE(SUM(score), 0), COALESCE(SUM(total_questions), 0)
FROM public.quiz_attempts
GROUP BY user_id, completed_at::date
ON CONFLICT (user_id, date) DO UPDATE SET
  quizzes_count = public.user_daily_activity.quizzes_count + EXCLUDED.quizzes_count,
  quizzes_score = public.user_daily_activity.quizzes_score + EXCLUDED.quizzes_score,
  quizzes_total = public.user_daily_activity.quizzes_total + EXCLUDED.quizzes_total;

GRANT SELECT ON public.user_daily_activity TO authenticated, service_role;
