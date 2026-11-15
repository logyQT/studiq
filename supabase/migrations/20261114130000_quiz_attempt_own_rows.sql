-- ==========================================
-- A student reads their own attempts; staff keeps the class view (#1165 follow-up, #1170).
--
-- The old policy was a same-org floor: every member of a shared organisation could read every
-- other member's attempts — and, through the `attempt_id IN (SELECT …)` policies, their answer
-- sheet and attempt questions too. A classmate could read a peer's answers before or after
-- submitting.
--
-- Students now see their own rows only. A teacher or manager of the same organisation keeps the
-- class view, because the teacher dashboard and the grader pages already read other users' rows
-- through the user-session client (`rls_caller_org_user_ids()` exists for exactly that). The
-- account type comes from the JWT and fails closed: a token without `app_metadata.account_type`
-- is treated as a student.
--
-- The child tables (`quiz_attempt_questions`, `student_answers`, `assignment_answer_images`)
-- need no change: their policies scope through `quiz_attempts`, whose RLS filters that subquery.
-- ==========================================

DROP POLICY "Own or same-org quiz attempts" ON public.quiz_attempts;

CREATE POLICY "Own or staff quiz attempts" ON public.quiz_attempts
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      (auth.jwt() -> 'app_metadata' ->> 'account_type') IN ('educator', 'manager')
      AND user_id IN (SELECT u.user_id FROM public.rls_caller_org_user_ids() u)
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (
      (auth.jwt() -> 'app_metadata' ->> 'account_type') IN ('educator', 'manager')
      AND user_id IN (SELECT u.user_id FROM public.rls_caller_org_user_ids() u)
    )
  );
