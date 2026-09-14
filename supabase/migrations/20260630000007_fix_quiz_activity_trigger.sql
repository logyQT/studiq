-- 20260630000007
-- Use started_at instead of completed_at for daily activity date
-- (completed_at is null when a quiz attempt is first created)

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
