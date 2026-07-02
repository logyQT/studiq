-- ==========================================
-- TABLE: topics
-- Unified topics shared by flashcards and questions
-- Replaces flashcard_topics
-- Depends on: 03_organizations.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.topics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  name            text NOT NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_topics_created_by ON public.topics(created_by);
CREATE INDEX idx_topics_organization ON public.topics(organization_id);
