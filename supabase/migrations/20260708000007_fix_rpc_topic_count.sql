-- Fix get_accessible_topics to include flashcard_count and question_count
DROP FUNCTION IF EXISTS public.get_accessible_topics(uuid, uuid);
CREATE FUNCTION public.get_accessible_topics(p_user_id uuid, p_org_id uuid)
RETURNS TABLE(
  id uuid, organization_id uuid, created_by uuid, name text, visibility visibility_type,
  search_vector tsvector, created_at timestamptz,
  flashcard_count bigint, question_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT t.id, t.organization_id, t.created_by, t.name, t.visibility,
    t.search_vector, t.created_at,
    (SELECT COUNT(*) FROM public.flashcard_topic_assignments WHERE topic_id = t.id) AS flashcard_count,
    (SELECT COUNT(*) FROM public.question_topic_assignments WHERE topic_id = t.id) AS question_count
  FROM public.topics t
  LEFT JOIN public.topic_groups tg ON tg.topic_id = t.id
  LEFT JOIN public.group_members gm ON gm.group_id = tg.group_id AND gm.user_id = p_user_id
  WHERE t.organization_id = p_org_id
    AND (
      (t.visibility = 'personal' AND t.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;
