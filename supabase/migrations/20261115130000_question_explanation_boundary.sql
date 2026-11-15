-- ==========================================
-- The explanation joins the answer-key boundary (#1180, phase 3 slice A of #1172).
--
-- `questions.explanation` was the last answer-bearing column still readable by any authenticated
-- caller who could see the question: the API stripped it, but PostgREST handed it out, so a
-- student could read it before or during an assessment (R4). The generated `search_vector` indexes
-- the explanation, so it leaves with it — otherwise the vector is a searchable echo of the key.
--
-- A column REVOKE cannot subtract from a table-wide GRANT, so the table grant goes and the reader
-- columns come back: `explanation`, `model_answer` (#1173) and `search_vector` are the only
-- columns `authenticated` may no longer select. Writes stay column-complete and RLS-scoped.
--
-- Deploy: this migration first, the app in the same release — every user-session read of
-- `explanation` must go through `readQuestionKeys` (service role, ids from a query the caller was
-- already authorized to run), and a `questions(*)` read by an authenticated caller now fails
-- closed (42501) instead of returning the column. Mirrored in `supabase/schemas/24_questions.sql`
-- and both `99_dev_grants.sql` files, which re-apply the narrowing after a `db reset`.
-- ==========================================

REVOKE SELECT ON public.questions FROM authenticated, anon;

GRANT SELECT (
  id,
  created_by,
  type,
  content,
  created_at,
  updated_at,
  organization_id,
  visibility,
  bank_id,
  status,
  version
) ON public.questions TO authenticated;
