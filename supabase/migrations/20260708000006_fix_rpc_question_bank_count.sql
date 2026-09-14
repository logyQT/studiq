-- Fix get_accessible_question_banks to include question_count
DROP FUNCTION IF EXISTS public.get_accessible_question_banks(uuid, uuid);
CREATE FUNCTION public.get_accessible_question_banks(p_user_id uuid, p_org_id uuid)
RETURNS TABLE(
  id uuid, organization_id uuid, created_by uuid, name text, description text,
  visibility visibility_type, search_vector tsvector, created_at timestamptz,
  updated_at timestamptz, question_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT b.id, b.organization_id, b.created_by, b.name, b.description,
    b.visibility, b.search_vector, b.created_at, b.updated_at,
    (SELECT COUNT(*) FROM public.question_bank_assignments WHERE bank_id = b.id) AS question_count
  FROM public.question_banks b
  LEFT JOIN public.bank_groups bg ON bg.bank_id = b.id
  LEFT JOIN public.group_members gm ON gm.group_id = bg.group_id AND gm.user_id = p_user_id
  WHERE b.organization_id = p_org_id
    AND (
      (b.visibility = 'personal' AND b.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;
