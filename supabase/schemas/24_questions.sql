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
  -- The choice item's teaching artefact and part of the answer key (R16). Revoked from
  -- `authenticated` in 20261115130000_question_explanation_boundary.sql (#1180): it is read only by
  -- the server-side key reader.
  explanation     text,
  -- The open item's teaching artefact (#1173, R16). Revoked from `authenticated` in
  -- 20261115120000_question_model_answer.sql: it is an answer, read only by the server-side
  -- key reader.
  model_answer    text,
  status          question_status NOT NULL DEFAULT 'open',
  version         int NOT NULL DEFAULT 1,
  visibility      visibility_type NOT NULL DEFAULT 'personal',
  -- Indexes the explanation, so it is revoked with it (#1180).
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
