-- Migration: teacher_assignments
-- Creates assignment tables, alters quiz_attempts, adds storage bucket

-- ==========================================
-- 1. Enum
-- ==========================================
DO $$ BEGIN
  CREATE TYPE assignment_status AS ENUM ('draft', 'published');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ==========================================
-- 2. Tables
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

CREATE TABLE public.assignment_answer_images (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id     uuid REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id    uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  image_url      text NOT NULL,
  uploaded_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_assignment_answer_images_attempt ON public.assignment_answer_images(attempt_id);

-- ==========================================
-- 3. Alter quiz_attempts
-- ==========================================

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES public.teacher_assignments(id) ON DELETE SET NULL;

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS graded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_assignment ON public.quiz_attempts(assignment_id);

ALTER TABLE public.quiz_answers
  ADD COLUMN IF NOT EXISTS teacher_points int;

ALTER TABLE public.quiz_answers
  ADD COLUMN IF NOT EXISTS teacher_feedback text;

-- ==========================================
-- 4. Trigger: auto-count questions + total_points
-- ==========================================

CREATE OR REPLACE FUNCTION public.update_assignment_counts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.teacher_assignments
    SET question_count = question_count + 1, total_points = total_points + NEW.points
    WHERE id = NEW.assignment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.teacher_assignments
    SET question_count = GREATEST(question_count - 1, 0), total_points = GREATEST(total_points - OLD.points, 0)
    WHERE id = OLD.assignment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_questions_ai ON public.assignment_questions;
CREATE TRIGGER trg_assignment_questions_ai
  AFTER INSERT ON public.assignment_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_assignment_counts();

DROP TRIGGER IF EXISTS trg_assignment_questions_ad ON public.assignment_questions;
CREATE TRIGGER trg_assignment_questions_ad
  AFTER DELETE ON public.assignment_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_assignment_counts();

-- ==========================================
-- 5. Storage bucket for answer images
-- ==========================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'assignment-images',
  'assignment-images',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policy: authenticated users can upload in their org's path
CREATE POLICY "assignment_images_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'assignment-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "assignment_images_select_own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'assignment-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
