-- ==========================================
-- TABLE: flashcard_topic_assignments
-- Many-to-many relationship between flashcards and topics
-- Depends on: 30_flashcards.sql, 31_flashcard_topics.sql
-- ==========================================

CREATE TABLE public.flashcard_topic_assignments (
  flashcard_id uuid REFERENCES public.flashcards(id) ON DELETE CASCADE,
  topic_id     uuid REFERENCES public.flashcard_topics(id) ON DELETE CASCADE,
  PRIMARY KEY (flashcard_id, topic_id)
);

CREATE INDEX idx_flashcard_topic_assignments_topic ON public.flashcard_topic_assignments(topic_id);
CREATE INDEX idx_fta_topic_flashcard ON public.flashcard_topic_assignments (topic_id, flashcard_id);
