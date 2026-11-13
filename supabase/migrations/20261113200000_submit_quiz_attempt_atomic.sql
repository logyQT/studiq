-- ==========================================
-- submit_quiz_attempt(attempt, user, score, answers) — one transaction for the
-- whole submit (#1064)
--
-- `submit` wrote the completion and the answer sheet as two independent
-- PostgREST calls, completion first. A failing insert (constraint, timeout, a
-- dropped connection) left the attempt completed with `draft_answers` cleared
-- and no answer rows, and the retry was refused as a re-submit — the sheet was
-- unrecoverable.
--
-- This function keeps both writes in one transaction: the attempt row is locked
-- (`FOR UPDATE`), its `completed_at` is read before anything is written, the
-- answer rows are inserted, and only then is `completed_at` stamped. A failing
-- row aborts the call with the sheet, so the attempt stays open and retryable.
-- Two racing submits serialise on the lock; the loser gets no rows back, which
-- `submit` answers as a re-submit — #1066's "complete once" is unchanged, and
-- `ON CONFLICT (attempt_id, question_id) DO NOTHING` keeps the sheet idempotent.
--
-- Scoring stays in the service; zero rows back means "not completed".
-- ==========================================

CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(
  p_attempt_id uuid,
  p_user_id uuid,
  p_score int,
  p_answers jsonb
) RETURNS TABLE (completed_attempt_id uuid)
LANGUAGE plpgsql
-- Invoker rights on purpose: the caller is the student's own client, and the RLS
-- policies on `quiz_attempts` / `student_answers` stay the outer authority. The
-- function grants no privilege the app did not already use.
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_completed_at timestamptz;
  v_completed_id uuid;
BEGIN
  -- The service-role client (server-side) names the owner explicitly; an end
  -- user may only ever name themselves, even though RLS already scopes both
  -- writes. `auth.role()` is the same service-role test the other RPCs use.
  IF auth.uid() IS DISTINCT FROM p_user_id
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN;
  END IF;

  SELECT att.completed_at INTO v_completed_at
  FROM public.quiz_attempts att
  WHERE att.id = p_attempt_id
    AND att.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_completed_at IS NOT NULL THEN
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

  -- Last write of the transaction: the graded rows are the record from now on,
  -- so the draft copy goes with the completion.
  UPDATE public.quiz_attempts AS att
  SET score = p_score,
      completed_at = now(),
      draft_answers = '{}'::jsonb
  WHERE att.id = p_attempt_id
    AND att.user_id = p_user_id
    AND att.completed_at IS NULL
  RETURNING att.id INTO v_completed_id;

  IF v_completed_id IS NULL THEN
    -- Unreachable while the row lock above is held. Raising rolls the inserted
    -- rows back instead of committing an open attempt that already has a sheet.
    RAISE EXCEPTION 'submit_quiz_attempt: attempt % completed concurrently', p_attempt_id
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT v_completed_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quiz_attempt(uuid, uuid, int, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt(uuid, uuid, int, jsonb) TO authenticated, service_role;
