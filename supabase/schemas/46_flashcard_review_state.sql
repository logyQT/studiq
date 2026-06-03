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
  last_quality      smallint CHECK (last_quality IS NULL OR (last_quality >= 0 AND last_quality <= 5)),
  PRIMARY KEY (user_id, flashcard_id)
);

CREATE INDEX idx_flashcard_review_state_next_review
  ON public.flashcard_review_state(user_id, next_review_at);
