-- Add updated_at column to flashcard_decks
ALTER TABLE public.flashcard_decks ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Trigger: bump updated_at on direct deck row update (name, description)
DROP TRIGGER IF EXISTS set_flashcard_decks_updated_at ON public.flashcard_decks;
CREATE TRIGGER set_flashcard_decks_updated_at
  BEFORE UPDATE ON public.flashcard_decks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger function: bump parent deck's updated_at when a flashcard is added/removed from it
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

DROP TRIGGER IF EXISTS trg_deck_updated_at_on_assignment ON public.flashcard_deck_assignments;
CREATE TRIGGER trg_deck_updated_at_on_assignment
  AFTER INSERT OR DELETE OR UPDATE ON public.flashcard_deck_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_deck_updated_at_on_assignment();

-- Trigger function: bump all parent decks' updated_at when a flashcard's content changes
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

DROP TRIGGER IF EXISTS trg_deck_updated_at_on_flashcard_change ON public.flashcards;
CREATE TRIGGER trg_deck_updated_at_on_flashcard_change
  AFTER UPDATE ON public.flashcards
  FOR EACH ROW
  WHEN (OLD.front IS DISTINCT FROM NEW.front OR OLD.back IS DISTINCT FROM NEW.back)
  EXECUTE FUNCTION public.update_deck_updated_at_on_flashcard_change();
