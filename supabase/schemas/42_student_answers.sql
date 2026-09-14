-- ==========================================
-- TABLE: student_answers
-- One row per atomic answer unit for all question types.
-- Depends on: 39_quiz_attempts.sql, 24_questions.sql, 27_question_options.sql
-- ==========================================

CREATE TABLE public.student_answers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id           uuid REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id          uuid REFERENCES public.questions(id) ON DELETE SET NULL,
  question_type        question_type,
  selected_option_id   uuid REFERENCES public.question_options(id) ON DELETE SET NULL,
  is_correct           boolean NOT NULL DEFAULT false,
  points_earned        numeric,
  ai_graded            boolean NOT NULL DEFAULT false,
  teacher_points       int,
  teacher_feedback     text,
  text_answer          text,
  submitted_position   int,
  match_pair_id        uuid
);

CREATE INDEX idx_student_answers_attempt ON public.student_answers(attempt_id);
