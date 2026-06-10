-- ==========================================
-- Enable Realtime for tables that require it
-- Depends on: 30_flashcards.sql, 35_flashcard_space_assignments.sql
-- ==========================================

DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime;
ALTER PUBLICATION supabase_realtime ADD TABLE public.flashcard_deck_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.flashcards;
