-- Update flashcard_study_sessions mode CHECK to match new mode names
ALTER TABLE public.flashcard_study_sessions
  DROP CONSTRAINT IF EXISTS flashcard_study_sessions_mode_check,
  ADD CONSTRAINT flashcard_study_sessions_mode_check
    CHECK (mode IN ('review', 'cram', 'quick'));

COMMENT ON COLUMN public.flashcard_study_sessions.mode IS 'review=due cards, cram=all deck cards, quick=review with limit=5';
