-- ==========================================
-- One running kartkówka attempt per (assignment, student) — #369
--
-- The pre-fix „Kontynuuj” flow always inserted a new `quiz_attempts` row, so a
-- student could pile up unsubmitted attempts for the same assignment and dodge
-- `max_attempts` (only completed attempts were counted).
--
-- Data already produced by that bug: every unsubmitted attempt except the
-- student's newest one is unreachable — `GET /api/v1/assignments/:id` returns
-- the newest attempt, so an older open row can never be finished through the UI
-- but can still be resumed through `POST /start` and submitted, which is the
-- max_attempts bypass this issue reports. Keep the newest attempt per
-- (assignment, student) and drop the older *unsubmitted* orphans. They hold no
-- graded answers; their question snapshots and uploaded images cascade away.
-- Completed attempts are never deleted.
-- ==========================================

DELETE FROM public.quiz_attempts old
USING public.quiz_attempts keep
WHERE old.assignment_id IS NOT NULL
  AND old.assignment_id = keep.assignment_id
  AND old.user_id = keep.user_id
  AND old.completed_at IS NULL
  AND (COALESCE(old.started_at, 'epoch'::timestamptz), old.id)
    < (COALESCE(keep.started_at, 'epoch'::timestamptz), keep.id);

-- At most one running attempt per assignment and student. Completed attempts
-- stay unlimited: `max_attempts` is enforced by the service, not the index.
-- Generated-quiz attempts have `assignment_id IS NULL` and are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_attempts_one_open_per_assignment
  ON public.quiz_attempts (assignment_id, user_id)
  WHERE completed_at IS NULL AND assignment_id IS NOT NULL;
