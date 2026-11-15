-- ==========================================
-- Durable close and attempt expiry (#1171, slice 3 — R7/R12/R19)
--
-- An assessment used to end only because the clock passed `deadline`: nothing recorded that it had
-- ended, so moving the deadline back (a live edit, #1191) silently reopened a run whose results had
-- already been revealed, and an attempt started before the deadline could still be submitted with a
-- 60-second grace afterwards.
--
-- The close is now a fact in the row:
--
--   * `teacher_assignments.closed_at` is written by the natural expiry (at the deadline) and by an
--     explicit close (at the instant of the close). A trigger makes it once-only: no later clock
--     change, edit, re-publish or reopen can clear or move it (R12 — the repair path is a new
--     assessment).
--   * `quiz_attempts.expired_at` records the in-progress attempts that the close ended. They count
--     as consumed and cannot be submitted: the submit RPC refuses them itself, so a caller that
--     bypasses the service cannot revive one.
--
-- The seal predicate stops at `closed_at` instead of the clock, so closing a run really does release
-- its items (R2) — with the withheld-item exception that slice 3's later migration adds.
--
-- Deploy: migration first, app in the same release. Pre-existing rows have `closed_at IS NULL` and
-- `expired_at IS NULL`, so they keep behaving exactly as before until the next read settles them.
-- ==========================================

ALTER TABLE public.teacher_assignments
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_expired_at
  ON public.quiz_attempts(expired_at) WHERE expired_at IS NOT NULL;

-- One running attempt per (assignment, student) still holds; an expired attempt is terminal, so it
-- no longer blocks a start the way an open one does (#369).
DROP INDEX IF EXISTS public.quiz_attempts_one_open_per_assignment;

CREATE UNIQUE INDEX quiz_attempts_one_open_per_assignment
  ON public.quiz_attempts (assignment_id, user_id)
  WHERE completed_at IS NULL AND expired_at IS NULL AND assignment_id IS NOT NULL;

-- `closed_at` is durable: once written it cannot be cleared or moved by any later update.
CREATE OR REPLACE FUNCTION public.teacher_assignments_close_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'teacher_assignments.closed_at is durable: a closed assessment cannot be reopened'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teacher_assignments_close_once ON public.teacher_assignments;

CREATE TRIGGER trg_teacher_assignments_close_once
  BEFORE UPDATE ON public.teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION public.teacher_assignments_close_once();

-- The seal ends at the durable close. Everything else is unchanged from the slice-2b predicate.
CREATE OR REPLACE FUNCTION public.rls_caller_is_sealed_item(p_question_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'account_type', '') = 'student'
    AND EXISTS (
      SELECT 1
      FROM public.assignment_questions aq
      JOIN public.teacher_assignments a ON a.id = aq.assignment_id
      WHERE aq.question_id = p_question_id
        AND a.status = 'published'
        AND a.closed_at IS NULL
        AND (a.start_time IS NULL OR a.start_time <= now())
        AND (a.deadline IS NULL OR a.deadline > now())
        AND (
          (
            a.seal_org_wide
            AND a.organization_id IN (
              SELECT c.organization_id FROM public.rls_caller_org_ids() c
            )
          )
          OR EXISTS (
            SELECT 1
            FROM public.assignment_targets t
            WHERE t.assignment_id = a.id
              AND (
                t.student_id = auth.uid()
                OR EXISTS (
                  SELECT 1
                  FROM public.group_members gm
                  WHERE gm.group_id = t.group_id
                    AND gm.user_id = auth.uid()
                )
              )
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.rls_caller_is_sealed_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_caller_is_sealed_item(uuid) TO authenticated, service_role;

-- The submit RPC refuses an expired attempt itself: the service check is the friendly refusal, this
-- is the boundary one.
CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(
  p_attempt_id uuid,
  p_user_id uuid,
  p_score int,
  p_answers jsonb
) RETURNS TABLE (completed_attempt_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_completed_at timestamptz;
  v_expired_at timestamptz;
  v_completed_id uuid;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN;
  END IF;

  SELECT att.completed_at, att.expired_at INTO v_completed_at, v_expired_at
  FROM public.quiz_attempts att
  WHERE att.id = p_attempt_id
    AND att.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_completed_at IS NOT NULL OR v_expired_at IS NOT NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.student_answers (
    attempt_id,
    question_id,
    question_type,
    selected_option_id,
    text_answer,
    is_correct
  )
  SELECT
    p_attempt_id,
    ans.question_id,
    ans.question_type,
    ans.selected_option_id,
    ans.text_answer,
    ans.is_correct
  FROM jsonb_to_recordset(COALESCE(p_answers, '[]'::jsonb)) AS ans(
    question_id uuid,
    question_type public.question_type,
    selected_option_id uuid,
    text_answer text,
    is_correct boolean
  )
  ON CONFLICT (attempt_id, question_id) DO NOTHING;

  UPDATE public.quiz_attempts AS att
  SET score = p_score,
      completed_at = now(),
      draft_answers = '{}'::jsonb
  WHERE att.id = p_attempt_id
    AND att.user_id = p_user_id
    AND att.completed_at IS NULL
    AND att.expired_at IS NULL
  RETURNING att.id INTO v_completed_id;

  IF v_completed_id IS NULL THEN
    RAISE EXCEPTION 'submit_quiz_attempt: attempt % completed concurrently', p_attempt_id
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT v_completed_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quiz_attempt(uuid, uuid, int, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt(uuid, uuid, int, jsonb)
  TO authenticated, service_role;
