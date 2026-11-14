-- ==========================================
-- The answer key leaves the client-readable surface (#1165, #1170).
--
-- `is_correct` was readable by any authenticated caller who could see the parent question, and
-- the `FOR ALL` policy let them forge it onto an option somebody else authored. A column-level
-- REVOKE cannot subtract from a table-wide GRANT, so the table grant goes and the reader
-- columns come back: `is_correct` is the one column authenticated may no longer select, while
-- writes stay column-complete and author-scoped.
--
-- Deploy: this migration first, the app in the same release — a `question_options(*)` embed is
-- 42501 until it projects explicit columns.
-- ==========================================

REVOKE SELECT ON public.question_options FROM authenticated, anon;

GRANT SELECT (id, question_id, content, order_index, match_group, match_side)
  ON public.question_options TO authenticated;

DROP POLICY "Visible question options" ON public.question_options;

CREATE POLICY "Visible question options" ON public.question_options
  FOR SELECT TO authenticated
  USING (
    question_id IN (SELECT q.id FROM public.questions q)
  );

CREATE POLICY "Authored question options insert" ON public.question_options
  FOR INSERT TO authenticated
  WITH CHECK (
    question_id IN (SELECT q.id FROM public.questions q WHERE q.created_by = auth.uid())
  );

CREATE POLICY "Authored question options update" ON public.question_options
  FOR UPDATE TO authenticated
  USING (
    question_id IN (SELECT q.id FROM public.questions q WHERE q.created_by = auth.uid())
  )
  WITH CHECK (
    question_id IN (SELECT q.id FROM public.questions q WHERE q.created_by = auth.uid())
  );

CREATE POLICY "Authored question options delete" ON public.question_options
  FOR DELETE TO authenticated
  USING (
    question_id IN (SELECT q.id FROM public.questions q WHERE q.created_by = auth.uid())
  );
