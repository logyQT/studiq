-- ==========================================
-- Group-visible decks must have at least one share link — #139
--
-- Decks created with `visibility = 'group'` and an empty `groupIds` list have no
-- `deck_groups` row, so only their creator can read them while they still claim
-- to be shared. The service/validation now rejects that state; this repairs the
-- rows written before it (functionally personal already, so no access is lost).
-- Idempotent — a second run matches nothing.
-- ==========================================

-- 1) The deck's cards follow the deck back to personal (mirrors `update()`), so a
--    repaired deck does not keep group-scoped cards.
UPDATE public.flashcards AS f
SET visibility = 'personal'
WHERE f.deck_id IN (
  SELECT d.id
  FROM public.flashcard_decks AS d
  WHERE d.visibility = 'group'
    AND NOT EXISTS (SELECT 1 FROM public.deck_groups AS dg WHERE dg.deck_id = d.id)
);

-- 2) Un-share the group-visible decks that have no share link.
UPDATE public.flashcard_decks AS d
SET visibility = 'personal'
WHERE d.visibility = 'group'
  AND NOT EXISTS (SELECT 1 FROM public.deck_groups AS dg WHERE dg.deck_id = d.id);
