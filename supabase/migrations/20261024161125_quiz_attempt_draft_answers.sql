-- ==========================================
-- Partial quiz progress (#349): while an attempt is in progress the browser
-- autosaves the answers it has so far, so „Kontynuuj" resumes with them.
--
-- Shape: { "<questionId>": { "selected_answer_id": uuid|null,
--                            "text_answer": text|null } }
-- Never graded and never surfaced as `is_correct`; cleared on submit.
-- ==========================================

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS draft_answers jsonb NOT NULL DEFAULT '{}'::jsonb
  CONSTRAINT quiz_attempts_draft_answers_object CHECK (jsonb_typeof(draft_answers) = 'object');

COMMENT ON COLUMN public.quiz_attempts.draft_answers IS
  'In-progress answers keyed by question id; written by the take page, cleared on submit, never graded.';
