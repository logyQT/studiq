CREATE OR REPLACE FUNCTION cleanup_orphan_flashcards()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.flashcards f
  WHERE NOT EXISTS (
    SELECT 1 FROM public.flashcard_deck_assignments
    WHERE flashcard_id = f.id
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_flashcard_deck_assignments_cleanup
  AFTER DELETE ON public.flashcard_deck_assignments
  FOR EACH STATEMENT
  EXECUTE FUNCTION cleanup_orphan_flashcards();