-- #1082 — daily quiz activity must follow completion, not the start insert.
--
-- The old trigger booked +1 / +NEW.score on every `quiz_attempts` INSERT. Attempts
-- are inserted with score = 0 and completed_at = NULL, so every submitted quiz added
-- 0 to `quizzes_score`; abandoned attempts were counted as completed; and the row
-- landed on `started_at::date`, not the completion date.
--
-- New behaviour:
--   * INSERT books nothing (a started attempt is not a completed quiz).
--   * NULL -> non-NULL `completed_at` books +1 count, +total_questions, +score on
--     `completed_at::date`.
--   * A later score write on an already-completed attempt is a regrade: only
--     `NEW.score - OLD.score` moves `quizzes_score`, floored at 0. Count and total
--     are untouched, and a score-preserving write changes nothing.
-- SECURITY DEFINER so a teacher's regrade (a write to a student's attempt) can
-- update the student's activity row past that table's own-row RLS policy.
--
-- No backfill: the app is pre-market and every environment is seeded from scratch.
-- The one-time backfill in `20260629000005_daily_stats.sql` stays as history and is
-- a no-op on a fresh database.

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

DROP TRIGGER IF EXISTS trg_quizzes ON public.quiz_attempts;

CREATE TRIGGER trg_quizzes
  AFTER INSERT OR UPDATE OF score, completed_at ON public.quiz_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_quizzes();
