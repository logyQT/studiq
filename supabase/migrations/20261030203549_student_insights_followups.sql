-- ==========================================
-- Follow-up to the student insights aggregate (#657)
--
-- An index for the retention curve: the aggregate partitions the caller's whole review history
-- by card and orders it by time (`lag()` over flashcard_practice), so the per-user scan must not
-- sort every review of the user. This index serves both the partition and its order.
--
-- (`quiz_attempts.is_assignment_attempt`, the durable assignment marker the aggregate filters
-- on, is added at the top of 20261028100200_student_insights.sql so the function never runs
-- against a table it cannot read — see that file for the reasoning.)
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_flashcard_practice_user_card_time
  ON public.flashcard_practice (user_id, flashcard_id, practiced_at);

