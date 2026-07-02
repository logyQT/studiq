-- ==========================================
-- TABLE: suspended_decks
-- Per-user deck suspension. Users can independently
-- suspend/unsuspend decks. Suspended deck cards are
-- excluded from reviews, due counts, and stats.
-- Depends on: 04_profiles.sql, 34_flashcard_decks.sql
-- ==========================================

CREATE TABLE public.suspended_decks (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  deck_id    uuid NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, deck_id)
);

CREATE INDEX idx_suspended_decks_user ON public.suspended_decks(user_id);
