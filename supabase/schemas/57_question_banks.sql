-- ==========================================
-- TABLE: question_banks
-- Organizational containers for questions
-- Mirrors flashcard_decks
-- Depends on: 01_config.sql, 03_organizations.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.question_banks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  search_vector   tsvector
                  GENERATED ALWAYS AS (
                    to_tsvector('english', coalesce(name, '')) ||
                    to_tsvector('polish', coalesce(name, '')) ||
                    to_tsvector('english', coalesce(description, '')) ||
                    to_tsvector('polish', coalesce(description, ''))
                  ) STORED,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_question_banks_search_vector ON public.question_banks USING GIN (search_vector);
CREATE INDEX idx_question_banks_created_by ON public.question_banks(created_by);
CREATE INDEX idx_question_banks_organization ON public.question_banks(organization_id);
