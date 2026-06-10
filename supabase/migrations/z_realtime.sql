-- db diff does not pick this up as schema diff and ignores it so it's here directly as a migration
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime;
ALTER PUBLICATION supabase_realtime ADD TABLE public.flashcard_deck_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.flashcards;
ALTER PUBLICATION supabase_realtime ADD TABLE public.flashcard_decks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.flashcard_topics;
ALTER PUBLICATION supabase_realtime ADD TABLE public.flashcard_topic_assignments;