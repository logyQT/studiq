set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.cleanup_orphan_flashcards()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM public.flashcards f
  WHERE NOT EXISTS (
    SELECT 1 FROM public.flashcard_deck_assignments
    WHERE flashcard_id = f.id
  );
  RETURN NULL;
END;
$function$
;

CREATE TRIGGER trg_flashcard_deck_assignments_cleanup AFTER DELETE ON public.flashcard_deck_assignments FOR EACH STATEMENT EXECUTE FUNCTION public.cleanup_orphan_flashcards();


