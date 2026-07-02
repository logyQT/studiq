-- ==========================================
-- TABLE: flashcards
-- Depends on: 01_config.sql, 03_organizations.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.flashcards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  front           text NOT NULL,
  back            text NOT NULL,
  search_vector   tsvector
                  GENERATED ALWAYS AS (
                    to_tsvector('english', coalesce(front, '')) ||
                    to_tsvector('polish', coalesce(front, '')) ||
                    to_tsvector('english', coalesce(back, '')) ||
                    to_tsvector('polish', coalesce(back, ''))
                  ) STORED,
  created_at      timestamptz DEFAULT now()
);

-- Full-text search index covering both English and Polish
CREATE INDEX idx_flashcards_search_vector ON public.flashcards USING GIN (search_vector);

-- Operational indexes
CREATE INDEX idx_flashcards_created_by ON public.flashcards(created_by);
CREATE INDEX idx_flashcards_organization ON public.flashcards(organization_id);
CREATE INDEX idx_flashcards_created_at_id ON public.flashcards (created_at DESC, id);
CREATE INDEX idx_flashcards_owner_time ON public.flashcards (created_by, created_at DESC, id);
CREATE INDEX idx_flashcards_org_time ON public.flashcards (organization_id, created_at DESC, id);
