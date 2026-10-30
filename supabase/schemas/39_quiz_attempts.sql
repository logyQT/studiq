-- ==========================================
-- TABLE: quiz_attempts
-- Depends on: 04_profiles.sql
-- ==========================================

CREATE TABLE public.quiz_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  score            int NOT NULL DEFAULT 0,
  total_questions  int NOT NULL DEFAULT 0,
  total_points     int,
  config           jsonb,
  draft_answers    jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at       timestamptz DEFAULT now(),
  completed_at     timestamptz,
  assignment_id    uuid REFERENCES public.teacher_assignments(id) ON DELETE SET NULL,
  -- Set on insert from `assignment_id`, preserved on update: `assignment_id` becomes NULL when
  -- the assignment is deleted, this marker keeps the attempt out of the student's practice
  -- insights (see 20261028100200_student_insights.sql, #657).
  is_assignment_attempt boolean NOT NULL DEFAULT false,
  graded_at        timestamptz
);

CREATE INDEX idx_quiz_attempts_user ON public.quiz_attempts(user_id);
CREATE INDEX idx_quiz_attempts_assignment ON public.quiz_attempts(assignment_id);
CREATE INDEX idx_quiz_attempts_completed_at
  ON public.quiz_attempts(completed_at) WHERE completed_at IS NOT NULL;

-- At most one *running* attempt per assignment and student (#369). Completed
-- attempts stay unlimited — `max_attempts` is enforced by the service.
CREATE UNIQUE INDEX quiz_attempts_one_open_per_assignment
  ON public.quiz_attempts (assignment_id, user_id)
  WHERE completed_at IS NULL AND assignment_id IS NOT NULL;

-- The assignment marker is database-controlled: derived on insert, preserved on update. A
-- student may update their own attempts through PostgREST, and the quota, the resume card and
-- the student insights all trust this value (#657).
CREATE OR REPLACE FUNCTION public.quiz_attempts_assignment_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.is_assignment_attempt := NEW.assignment_id IS NOT NULL;
  ELSE
    NEW.is_assignment_attempt := OLD.is_assignment_attempt;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_quiz_attempts_assignment_marker
  BEFORE INSERT OR UPDATE ON public.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION public.quiz_attempts_assignment_marker();
