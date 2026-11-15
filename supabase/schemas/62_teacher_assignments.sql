-- ==========================================
-- TABLES: teacher_assignments, assignment_questions, assignment_targets
-- Depends on: 04_profiles.sql, 24_questions.sql, 60_groups.sql
-- ==========================================

CREATE TABLE public.teacher_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  quiz_id           uuid REFERENCES public.quizzes(id) ON DELETE SET NULL,
  title             text NOT NULL,
  description       text,
  status            assignment_status NOT NULL DEFAULT 'draft',
  deadline          timestamptz,
  start_time        timestamptz,
  time_limit_min    int,
  shuffle_questions boolean NOT NULL DEFAULT true,
  shuffle_answers   boolean NOT NULL DEFAULT true,
  show_results      boolean NOT NULL DEFAULT false,
  max_attempts      int NOT NULL DEFAULT 1,
  -- Seal every item for the whole organisation, not only the targeted classes (R3).
  seal_org_wide     boolean NOT NULL DEFAULT false,
  passing_score     int,
  question_count    int NOT NULL DEFAULT 0,
  total_points      int NOT NULL DEFAULT 0,
  -- Written by the natural expiry at `deadline` or by an explicit close; never cleared (R7/R12).
  closed_at         timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_teacher_assignments_org ON public.teacher_assignments(organization_id, created_by);
CREATE INDEX idx_teacher_assignments_status ON public.teacher_assignments(status);

-- The close is once: once `closed_at` is written, no later update can clear or move it.
CREATE OR REPLACE FUNCTION public.teacher_assignments_close_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'teacher_assignments.closed_at is durable: a closed assessment cannot be reopened'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_teacher_assignments_close_once
  BEFORE UPDATE ON public.teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION public.teacher_assignments_close_once();

CREATE TABLE public.assignment_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  uuid REFERENCES public.teacher_assignments(id) ON DELETE CASCADE,
  question_id    uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  order_index    int,
  points         int NOT NULL DEFAULT 1,
  -- Frozen at publish: reader-safe content, key material (never granted to `authenticated`),
  -- and the item version the assessment is serving. `snapshot_key` is read with the service role.
  snapshot         jsonb,
  snapshot_key     jsonb,
  snapshot_version int,
  -- Keep this item's key back from the cohort review until the teacher releases it (R10).
  withhold_from_review boolean NOT NULL DEFAULT false,
  released_at          timestamptz,
  UNIQUE (assignment_id, question_id)
);

CREATE INDEX idx_assignment_questions_assignment ON public.assignment_questions(assignment_id);

CREATE TABLE public.assignment_targets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  uuid REFERENCES public.teacher_assignments(id) ON DELETE CASCADE,
  group_id       uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  student_id     uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_at    timestamptz DEFAULT now(),
  CONSTRAINT one_target CHECK (
    (group_id IS NOT NULL AND student_id IS NULL)
    OR (group_id IS NULL AND student_id IS NOT NULL)
  )
);

CREATE INDEX idx_assignment_targets_assignment ON public.assignment_targets(assignment_id);
CREATE INDEX idx_assignment_targets_group ON public.assignment_targets(group_id);
CREATE INDEX idx_assignment_targets_student ON public.assignment_targets(student_id);
