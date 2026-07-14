-- ==========================================
-- TABLE: assignment_answer_images
-- Depends on: 39_quiz_attempts.sql, 24_questions.sql
-- ==========================================

CREATE TABLE public.assignment_answer_images (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id     uuid REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id    uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  image_url      text NOT NULL,
  uploaded_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_assignment_answer_images_attempt ON public.assignment_answer_images(attempt_id);
