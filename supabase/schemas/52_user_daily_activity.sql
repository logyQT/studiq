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

CREATE INDEX idx_user_daily_activity_date ON public.user_daily_activity(date);

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
-- Books an attempt into daily activity when it is completed, not when it starts:
-- a quiz counts once its `completed_at` is set, on that date, with the score the
-- attempt finished with. A later score write is a regrade, so only the delta is
-- applied to the already-booked row.
-- SECURITY DEFINER: a teacher regrades a student's attempt, and the write to
-- `user_daily_activity` must not be filtered by the caller's row-level policy.
-- ==========================================

CREATE OR REPLACE FUNCTION public.increment_quizzes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A started attempt is not a completed quiz.
    IF NEW.completed_at IS NULL THEN
      RETURN NEW;
    END IF;
  ELSIF OLD.completed_at IS NOT NULL THEN
    -- Already completed: only a changed score moves the counter, by the delta.
    IF NEW.completed_at IS NOT NULL AND NEW.score <> OLD.score THEN
      UPDATE public.user_daily_activity
      SET quizzes_score = GREATEST(quizzes_score + (NEW.score - OLD.score), 0)
      WHERE user_id = NEW.user_id
        AND date = NEW.completed_at::date;
    END IF;
    RETURN NEW;
  ELSIF NEW.completed_at IS NULL THEN
    -- Still running, or completed_at was cleared: nothing to book.
    RETURN NEW;
  END IF;

  -- Completion transition (or an attempt inserted already completed).
  INSERT INTO public.user_daily_activity (user_id, date, quizzes_count, quizzes_score, quizzes_total)
  VALUES (NEW.user_id, NEW.completed_at::date, 1, NEW.score, NEW.total_questions)
  ON CONFLICT (user_id, date) DO UPDATE SET
    quizzes_count = public.user_daily_activity.quizzes_count + 1,
    quizzes_score = public.user_daily_activity.quizzes_score + EXCLUDED.quizzes_score,
    quizzes_total = public.user_daily_activity.quizzes_total + EXCLUDED.quizzes_total;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_quizzes
  AFTER INSERT OR UPDATE OF score, completed_at ON public.quiz_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_quizzes();
