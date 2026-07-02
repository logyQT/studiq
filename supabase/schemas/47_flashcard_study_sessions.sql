-- ==========================================
-- TABLE: flashcard_study_sessions
-- Aggregate data per practice/study session for
-- session summary display.
-- Depends on: 04_profiles.sql
-- ==========================================

CREATE TABLE public.flashcard_study_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at     timestamptz NOT NULL,
  completed_at   timestamptz NOT NULL,
  duration_ms    integer NOT NULL,
  cards_studied  integer NOT NULL DEFAULT 0,
  cards_correct  integer NOT NULL DEFAULT 0,
  deck_ids       uuid[] DEFAULT '{}',
  mode           text NOT NULL CHECK (mode IN ('review', 'cram', 'quick')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.flashcard_study_sessions.mode IS 'review=due cards, cram=all deck cards, quick=review with limit=5';

CREATE INDEX idx_flashcard_study_sessions_user ON public.flashcard_study_sessions(user_id);
