-- Per-user deck suspension
-- Each user can independently suspend/unsuspend decks.
-- Suspended deck cards are excluded from reviews, due counts, breakdowns, and personal stats.

CREATE TABLE IF NOT EXISTS public.suspended_decks (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, deck_id)
);

CREATE INDEX IF NOT EXISTS idx_suspended_decks_user ON public.suspended_decks(user_id);
