-- ==========================================
-- TABLE: subjects
-- Depends on: 03_universities.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.subjects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid REFERENCES public.universities(id) ON DELETE SET NULL,
  name        text NOT NULL,
  description text,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_subjects_university ON public.subjects(university_id);
