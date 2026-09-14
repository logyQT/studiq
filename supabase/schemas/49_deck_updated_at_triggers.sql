-- ==========================================
-- TRIGGER FUNCTIONS: deck updated_at on indirect changes
-- Automatically bumps flashcard_decks.updated_at when:
--   1. A flashcard is added to or removed from a deck
--   2. A flashcard's content (front/back) is updated
-- Depends on: flashcard_decks, flashcard_deck_assignments, flashcards
-- ==========================================

-- 1. Bump parent deck's updated_at when assignment changes (add/remove flashcard)
CREATE OR REPLACE FUNCTION public.update_deck_updated_at_on_assignment()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE public.flashcard_decks SET updated_at = now() WHERE id = NEW.deck_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.flashcard_decks SET updated_at = now() WHERE id = OLD.deck_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deck_updated_at_on_assignment
  AFTER INSERT OR DELETE OR UPDATE ON public.flashcard_deck_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_deck_updated_at_on_assignment();

-- 2. Bump all parent decks when a flashcard's content changes
CREATE OR REPLACE FUNCTION public.update_deck_updated_at_on_flashcard_change()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.flashcard_decks
  SET updated_at = now()
  WHERE id IN (
    SELECT deck_id FROM public.flashcard_deck_assignments WHERE flashcard_id = NEW.id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deck_updated_at_on_flashcard_change
  AFTER UPDATE ON public.flashcards
  FOR EACH ROW
  WHEN (OLD.front IS DISTINCT FROM NEW.front OR OLD.back IS DISTINCT FROM NEW.back)
  EXECUTE FUNCTION public.update_deck_updated_at_on_flashcard_change();
