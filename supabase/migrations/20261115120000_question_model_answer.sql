-- ==========================================
-- The open item's model answer (#1173, R16).
--
-- A choice item teaches through the explanation of its key; an open item has no key, so its
-- teaching artefact after the close is a model answer. It is a separate column, not a second use
-- of `explanation`: the two artefacts answer different questions ("why is this option right?"
-- vs "what does a good answer contain?"), they are validated by different rules, and the review
-- renders the right one for the item's type.
--
-- `questions` is readable by `authenticated` at the table level, so the new column is closed
-- here: an answer artefact must not become a client-readable PostgREST surface the day it is
-- added (the same class of leak as `question_options.is_correct`, #1165/#1170). A column REVOKE
-- cannot subtract from a table GRANT, so the table grant goes and the reader columns come back
-- without `model_answer`. Readers get it only through the server-side key reader, which is fed
-- ids from a query the caller was already authorized to run.
--
-- `questions.explanation` keeps its current grant on purpose: closing it is #1180's decision, not
-- this migration's, and mixing the two would make one of them unreviewable.
--
-- Deploy: migration first, app in the same release. Nothing selects `model_answer` before this
-- change, so the narrowing breaks no existing path; a `questions(*)` read by an authenticated
-- caller now fails closed (42501) instead of returning the column. The `supabase/schemas/24_questions.sql`
-- mirror and the `99_dev_grants.sql` seed that re-applied the narrowing after a `db reset` have both
-- been deleted; this migration is the only source.
-- ==========================================

ALTER TABLE public.questions
  ADD COLUMN model_answer text;

REVOKE SELECT ON public.questions FROM authenticated, anon;

GRANT SELECT (
  id,
  created_by,
  type,
  content,
  explanation,
  created_at,
  updated_at,
  organization_id,
  search_vector,
  visibility,
  bank_id,
  status,
  version
) ON public.questions TO authenticated;
