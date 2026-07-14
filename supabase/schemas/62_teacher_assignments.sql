-- ==========================================
-- TABLES: teacher_assignments, assignment_questions, assignment_targets
-- Depends on: 04_profiles.sql, 24_questions.sql, 60_groups.sql
-- ==========================================

CREATE TABLE public.teacher_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  title             text NOT NULL,
  description       text,
  status            assignment_status NOT NULL DEFAULT 'draft',
  deadline          timestamptz,
  time_limit_min    int,
  shuffle_questions boolean NOT NULL DEFAULT true,
  shuffle_answers   boolean NOT NULL DEFAULT true,
  show_results      boolean NOT NULL DEFAULT false,
  max_attempts      int NOT NULL DEFAULT 1,
  passing_score     int,
  question_count    int NOT NULL DEFAULT 0,
  total_points      int NOT NULL DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_teacher_assignments_org ON public.teacher_assignments(organization_id, created_by);
CREATE INDEX idx_teacher_assignments_status ON public.teacher_assignments(status);

CREATE TABLE public.assignment_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  uuid REFERENCES public.teacher_assignments(id) ON DELETE CASCADE,
  question_id    uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  order_index    int,
  points         int NOT NULL DEFAULT 1,
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
