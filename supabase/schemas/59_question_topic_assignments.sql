-- ==========================================
-- TABLE: question_topic_assignments
-- Many-to-many relationship between questions and topics
-- Depends on: 24_questions.sql, 56_topics.sql
-- ==========================================

CREATE TABLE public.question_topic_assignments (
  question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  topic_id    uuid REFERENCES public.topics(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, topic_id)
);

CREATE INDEX idx_question_topic_assignments_topic ON public.question_topic_assignments(topic_id);
CREATE INDEX idx_qta_topic_question ON public.question_topic_assignments(topic_id, question_id);
