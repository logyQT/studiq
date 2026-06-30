-- ==========================================
-- TABLE: subjects
-- Depends on: 03_organizations.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.subjects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  name        text NOT NULL,
  description text,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_subjects_organization ON public.subjects(organization_id);
