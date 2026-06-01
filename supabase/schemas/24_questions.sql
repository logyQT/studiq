-- ==========================================
-- TABLE: questions
-- Depends on: 18_learning_enums.sql, 21_subjects.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid REFERENCES public.universities(id) ON DELETE SET NULL,
  subject_id    uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  type          question_type NOT NULL DEFAULT 'mcq',
  content       text NOT NULL,
  explanation   text,
  difficulty    question_difficulty NOT NULL DEFAULT 'medium',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_questions_subject ON public.questions(subject_id);
CREATE INDEX idx_questions_created_by ON public.questions(created_by);
