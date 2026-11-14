-- ==========================================
-- Non-deleted item counts per bank (#1171, slice 1a).
--
-- A soft-deleted item keeps its row, so the `questions(count)` embed counts items the author can
-- no longer see. The bank card renders that number next to a list that already filters
-- `status <> 'deleted'`, which contradicts itself. PostgREST cannot filter an embedded aggregate,
-- so the count is one call.
-- ==========================================

CREATE OR REPLACE FUNCTION public.question_bank_counts(p_bank_ids uuid[])
RETURNS TABLE (bank_id uuid, question_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT q.bank_id, count(*) AS question_count
  FROM public.questions q
  WHERE q.bank_id = ANY (p_bank_ids)
    AND q.status <> 'deleted'
  GROUP BY q.bank_id;
$$;

GRANT EXECUTE ON FUNCTION public.question_bank_counts(uuid[]) TO authenticated, service_role;
