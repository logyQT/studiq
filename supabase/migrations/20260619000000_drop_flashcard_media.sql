-- Drop media jsonb column from flashcards — media is now inline Markdown
ALTER TABLE public.flashcards DROP COLUMN media;
