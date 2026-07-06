-- ==========================================
-- Migration: 20260706000002
-- Description: Create assignment tables for group-content M:N relationships
-- Phase: P2 — Content scoping by group
-- ==========================================

-- Deck-Group assignments
CREATE TABLE public.deck_groups (
  deck_id  uuid NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  PRIMARY KEY (deck_id, group_id)
);
CREATE INDEX idx_deck_groups_group_id ON public.deck_groups(group_id);
CREATE INDEX idx_deck_groups_deck_id ON public.deck_groups(deck_id);

-- Question Bank-Group assignments
CREATE TABLE public.bank_groups (
  bank_id  uuid NOT NULL REFERENCES public.question_banks(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  PRIMARY KEY (bank_id, group_id)
);
CREATE INDEX idx_bank_groups_group_id ON public.bank_groups(group_id);
CREATE INDEX idx_bank_groups_bank_id ON public.bank_groups(bank_id);

-- Topic-Group assignments
CREATE TABLE public.topic_groups (
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, group_id)
);
CREATE INDEX idx_topic_groups_group_id ON public.topic_groups(group_id);
CREATE INDEX idx_topic_groups_topic_id ON public.topic_groups(topic_id);
