-- Fix get_accessible_flashcard_decks to include flashcard_count
DROP FUNCTION IF EXISTS public.get_accessible_flashcard_decks(uuid, uuid);
CREATE FUNCTION public.get_accessible_flashcard_decks(p_user_id uuid, p_org_id uuid)
RETURNS TABLE(
  id uuid, organization_id uuid, created_by uuid, name text, description text,
  visibility visibility_type, search_vector tsvector, created_at timestamptz,
  updated_at timestamptz, flashcard_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT d.id, d.organization_id, d.created_by, d.name, d.description,
    d.visibility, d.search_vector, d.created_at, d.updated_at,
    (SELECT COUNT(*) FROM public.flashcard_deck_assignments WHERE deck_id = d.id) AS flashcard_count
  FROM public.flashcard_decks d
  LEFT JOIN public.deck_groups dg ON dg.deck_id = d.id
  LEFT JOIN public.group_members gm ON gm.group_id = dg.group_id AND gm.user_id = p_user_id
  WHERE d.organization_id = p_org_id
    AND (
      (d.visibility = 'personal' AND d.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;
