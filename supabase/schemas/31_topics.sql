-- ==========================================
-- TABLE: topics
-- Unified topics shared by flashcards and questions
-- Replaces flashcard_topics
-- Depends on: 01_config.sql, 03_organizations.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.topics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            text NOT NULL,
  search_vector   tsvector
                  GENERATED ALWAYS AS (
                    to_tsvector('english', coalesce(name, '')) ||
                    to_tsvector('polish', coalesce(name, ''))
                  ) STORED,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_topics_search_vector ON public.topics USING GIN (search_vector);
CREATE INDEX idx_topics_created_by ON public.topics(created_by);
CREATE INDEX idx_topics_organization ON public.topics(organization_id);
