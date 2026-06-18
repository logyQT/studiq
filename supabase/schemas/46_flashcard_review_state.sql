-- ==========================================
-- TABLE: flashcard_review_state
-- Tracks SM-2 spaced repetition state per (user, flashcard)
-- Depends on: 04_profiles.sql, 30_flashcards.sql
-- ==========================================

CREATE TABLE public.flashcard_review_state (
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  flashcard_id      uuid NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE,
  easiness_factor   real NOT NULL DEFAULT 2.5,
  interval_days     integer NOT NULL DEFAULT 0,
  repetitions       integer NOT NULL DEFAULT 0,
  next_review_at    timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at  timestamptz,
  last_quality      smallint,
  learning_state    text NOT NULL DEFAULT 'review'
                    CHECK (learning_state IN ('new', 'learning', 'review', 'relearning')),
  learning_step     integer NOT NULL DEFAULT 0,
  lapse_count       integer NOT NULL DEFAULT 0,
  is_leech          boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, flashcard_id)
);

COMMENT ON COLUMN public.flashcard_review_state.learning_state IS 'new|learning|review|relearning — learning lifecycle phase';
COMMENT ON COLUMN public.flashcard_review_state.learning_step IS '0-based index into user_study_settings.learning_steps[] (minute durations)';
COMMENT ON COLUMN public.flashcard_review_state.lapse_count IS 'Total wrong answers ever — used for leech detection';
COMMENT ON COLUMN public.flashcard_review_state.is_leech IS 'Flagged as leech — requires user action to un-suspend';

CREATE INDEX idx_flashcard_review_state_next_review
  ON public.flashcard_review_state(user_id, next_review_at);
