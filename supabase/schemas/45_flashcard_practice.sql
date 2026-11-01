-- ==========================================
-- TABLE: flashcard_practice
-- Depends on: 04_profiles.sql, 30_flashcards.sql
-- ==========================================

CREATE TABLE public.flashcard_practice (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  flashcard_id      uuid REFERENCES public.flashcards(id) ON DELETE CASCADE,
  was_correct       boolean NOT NULL,
  practiced_at      timestamptz DEFAULT now(),
  response_time_ms  integer,
  confidence_level  integer CHECK (confidence_level IS NULL OR (confidence_level >= 1 AND confidence_level <= 5)),
  session_id        uuid,
  -- Organization of the flashcard when it is shared into a group (see 68_activity_organization.sql).
  organization_id   uuid REFERENCES public.organizations(id) ON DELETE SET NULL
);

CREATE INDEX idx_flashcard_practice_user ON public.flashcard_practice(user_id);
CREATE INDEX idx_flashcard_practice_flashcard ON public.flashcard_practice(flashcard_id);
CREATE INDEX idx_flashcard_practice_session ON public.flashcard_practice(session_id);
CREATE INDEX idx_flashcard_practice_organization
  ON public.flashcard_practice(organization_id, practiced_at) WHERE organization_id IS NOT NULL;
-- Retention curve of the student insights (#657): partitions by card and orders by time.
CREATE INDEX idx_flashcard_practice_user_card_time
  ON public.flashcard_practice(user_id, flashcard_id, practiced_at);
