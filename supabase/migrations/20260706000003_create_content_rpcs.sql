-- ==========================================
-- Migration: 20260706000003
-- Description: Create RPCs for group-scoped content access
-- Phase: P2 — Content scoping by group
-- ==========================================

-- Helper: get user's group IDs within an org
CREATE FUNCTION public.get_user_group_ids(p_user_id uuid, p_org_id uuid)
RETURNS TABLE(group_id uuid) LANGUAGE sql STABLE AS $$
  SELECT gm.group_id
  FROM public.group_members gm
  JOIN public.groups g ON g.id = gm.group_id
  WHERE gm.user_id = p_user_id AND g.organization_id = p_org_id;
$$;

-- Flashcard decks accessible to a user (own personal + group-scoped)
CREATE FUNCTION public.get_accessible_flashcard_decks(p_user_id uuid, p_org_id uuid)
RETURNS SETOF public.flashcard_decks LANGUAGE sql STABLE AS $$
  SELECT DISTINCT d.*
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

-- Flashcards accessible to a user (own personal + group-scoped via deck)
CREATE FUNCTION public.get_accessible_flashcards(p_user_id uuid, p_org_id uuid)
RETURNS SETOF public.flashcards LANGUAGE sql STABLE AS $$
  SELECT DISTINCT f.*
  FROM public.flashcards f
  LEFT JOIN public.flashcard_deck_assignments fda ON fda.flashcard_id = f.id
  LEFT JOIN public.deck_groups dg ON dg.deck_id = fda.deck_id
  LEFT JOIN public.group_members gm ON gm.group_id = dg.group_id AND gm.user_id = p_user_id
  WHERE f.organization_id = p_org_id
    AND (
      (f.visibility = 'personal' AND f.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;

-- Question banks accessible to a user (own personal + group-scoped)
CREATE FUNCTION public.get_accessible_question_banks(p_user_id uuid, p_org_id uuid)
RETURNS SETOF public.question_banks LANGUAGE sql STABLE AS $$
  SELECT DISTINCT b.*
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

-- Questions accessible to a user (own personal + group-scoped via bank)
CREATE FUNCTION public.get_accessible_questions(p_user_id uuid, p_org_id uuid)
RETURNS SETOF public.questions LANGUAGE sql STABLE AS $$
  SELECT DISTINCT q.*
  FROM public.questions q
  LEFT JOIN public.question_bank_assignments qba ON qba.question_id = q.id
  LEFT JOIN public.bank_groups bg ON bg.bank_id = qba.bank_id
  LEFT JOIN public.group_members gm ON gm.group_id = bg.group_id AND gm.user_id = p_user_id
  WHERE q.organization_id = p_org_id
    AND (
      (q.visibility = 'personal' AND q.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;

-- Topics accessible to a user (own personal + group-scoped)
CREATE FUNCTION public.get_accessible_topics(p_user_id uuid, p_org_id uuid)
RETURNS SETOF public.topics LANGUAGE sql STABLE AS $$
  SELECT DISTINCT t.*
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
