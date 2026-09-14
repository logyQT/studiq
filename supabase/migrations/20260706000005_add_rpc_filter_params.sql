-- Add optional deck/topic filter params to get_accessible_flashcards
CREATE OR REPLACE FUNCTION public.get_accessible_flashcards(
  p_user_id uuid,
  p_org_id uuid,
  p_deck_ids uuid[] DEFAULT NULL,
  p_topic_ids uuid[] DEFAULT NULL
)
RETURNS SETOF public.flashcards LANGUAGE sql STABLE AS $$
  SELECT DISTINCT f.*
  FROM public.flashcards f
  LEFT JOIN public.flashcard_deck_assignments fda ON fda.flashcard_id = f.id
  LEFT JOIN public.flashcard_topic_assignments fta ON fta.flashcard_id = f.id
  LEFT JOIN public.deck_groups dg ON dg.deck_id = fda.deck_id
  LEFT JOIN public.topic_groups tg ON tg.topic_id = fta.topic_id
  LEFT JOIN public.group_members gm ON gm.group_id = dg.group_id AND gm.user_id = p_user_id
  WHERE f.organization_id = p_org_id
    AND (
      (f.visibility = 'personal' AND f.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    )
    AND (p_deck_ids IS NULL OR fda.deck_id = ANY(p_deck_ids))
    AND (p_topic_ids IS NULL OR fta.topic_id = ANY(p_topic_ids));
$$;

-- Add optional bank/topic filter params to get_accessible_questions
CREATE OR REPLACE FUNCTION public.get_accessible_questions(
  p_user_id uuid,
  p_org_id uuid,
  p_bank_ids uuid[] DEFAULT NULL,
  p_topic_ids uuid[] DEFAULT NULL
)
RETURNS SETOF public.questions LANGUAGE sql STABLE AS $$
  SELECT DISTINCT q.*
  FROM public.questions q
  LEFT JOIN public.question_bank_assignments qba ON qba.question_id = q.id
  LEFT JOIN public.question_topic_assignments qta ON qta.question_id = q.id
  LEFT JOIN public.bank_groups bg ON bg.bank_id = qba.bank_id
  LEFT JOIN public.topic_groups tg ON tg.topic_id = qta.topic_id
  LEFT JOIN public.group_members gm ON gm.group_id = bg.group_id AND gm.user_id = p_user_id
  WHERE q.organization_id = p_org_id
    AND (
      (q.visibility = 'personal' AND q.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    )
    AND (p_bank_ids IS NULL OR qba.bank_id = ANY(p_bank_ids))
    AND (p_topic_ids IS NULL OR qta.topic_id = ANY(p_topic_ids));
$$;
