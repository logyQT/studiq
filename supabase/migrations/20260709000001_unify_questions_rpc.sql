-- Unify get_accessible_questions with p_scope, nullable p_org_id, p_question_id, answers inline

CREATE OR REPLACE FUNCTION public.get_accessible_questions(
  p_user_id uuid,
  p_org_id uuid DEFAULT NULL,
  p_scope text DEFAULT 'own',
  p_question_id uuid DEFAULT NULL,
  p_bank_ids uuid[] DEFAULT NULL,
  p_topic_ids uuid[] DEFAULT NULL,
  p_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid, organization_id uuid, created_by uuid,
  type text, content text, explanation text,
  visibility visibility_type, search_vector tsvector,
  created_at timestamptz, updated_at timestamptz,
  question_answers jsonb
)
LANGUAGE sql STABLE AS $$
  WITH accessible AS (
    SELECT DISTINCT q.*
    FROM public.questions q
    LEFT JOIN public.question_bank_assignments qba ON qba.question_id = q.id
    LEFT JOIN public.question_topic_assignments qta ON qta.question_id = q.id
    LEFT JOIN public.bank_groups bg ON bg.bank_id = qba.bank_id
    LEFT JOIN public.topic_groups tg ON tg.topic_id = qta.topic_id
    LEFT JOIN public.group_members gm ON gm.group_id = bg.group_id AND gm.user_id = p_user_id
    WHERE (p_org_id IS NULL OR q.organization_id = p_org_id)
      AND (
        CASE p_scope
          WHEN 'own'   THEN q.created_by = p_user_id
          WHEN 'group' THEN (q.created_by = p_user_id) OR gm.id IS NOT NULL
          ELSE TRUE
        END
      )
      AND (p_bank_ids IS NULL   OR qba.bank_id = ANY(p_bank_ids))
      AND (p_topic_ids IS NULL  OR qta.topic_id = ANY(p_topic_ids))
      AND (p_question_id IS NULL OR q.id = p_question_id)
      AND (p_type IS NULL        OR q.type::text = p_type)
  )
  SELECT a.id, a.organization_id, a.created_by, a.type::text, a.content, a.explanation,
         a.visibility, a.search_vector, a.created_at, a.updated_at,
         CASE WHEN p_question_id IS NOT NULL THEN (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', qa.id,
               'question_id', qa.question_id,
               'content', qa.content,
               'is_correct', qa.is_correct,
               'order_index', qa.order_index
             ) ORDER BY qa.order_index
           )
           FROM public.question_answers qa
           WHERE qa.question_id = a.id
         ) ELSE NULL END AS question_answers
  FROM accessible a
  ORDER BY a.created_at DESC;
$$;
