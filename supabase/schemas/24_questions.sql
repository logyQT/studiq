-- ==========================================
-- TABLE: questions
-- Depends on: 01_config.sql, 00_enums.sql, 03_organizations.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  type            question_type NOT NULL DEFAULT 'mcq',
  content         text NOT NULL,
  explanation     text,
  visibility      visibility_type NOT NULL DEFAULT 'personal',
  search_vector   tsvector
                  GENERATED ALWAYS AS (
                    to_tsvector('english', coalesce(content, '')) ||
                    to_tsvector('polish', coalesce(content, '')) ||
                    to_tsvector('english', coalesce(explanation, '')) ||
                    to_tsvector('polish', coalesce(explanation, ''))
                  ) STORED,
  created_at      timestamptz DEFAULT now(),
  bank_id         uuid NOT NULL REFERENCES public.question_banks(id) ON DELETE CASCADE,
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_questions_search_vector ON public.questions USING GIN (search_vector);
CREATE INDEX idx_questions_created_by ON public.questions(created_by);
CREATE INDEX idx_questions_bank_id ON public.questions(bank_id);
CREATE INDEX idx_questions_visibility ON public.questions (organization_id, visibility);
