-- ==========================================
-- TABLE: question_bank_assignments
-- Many-to-many relationship between questions and banks
-- Depends on: 24_questions.sql, 57_question_banks.sql
-- ==========================================

CREATE TABLE public.question_bank_assignments (
  question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  bank_id     uuid REFERENCES public.question_banks(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, bank_id)
);

CREATE INDEX idx_question_bank_assignments_bank ON public.question_bank_assignments(bank_id);
CREATE INDEX idx_qba_bank_question ON public.question_bank_assignments(bank_id, question_id);
