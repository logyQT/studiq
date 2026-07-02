-- ==========================================
-- TABLE: flashcards
-- Depends on: 03_organizations.sql, 04_profiles.sql
-- ==========================================

CREATE TABLE public.flashcards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  front           text NOT NULL,
  back            text NOT NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_flashcards_created_by ON public.flashcards(created_by);
CREATE INDEX idx_flashcards_organization ON public.flashcards(organization_id);
CREATE INDEX idx_flashcards_created_at_id ON public.flashcards (created_at DESC, id);

-- ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
