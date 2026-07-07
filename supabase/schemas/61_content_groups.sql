-- ==========================================
-- TABLES: deck_groups, bank_groups, topic_groups
-- M:N assignment between content and groups
-- Depends on: 60_groups.sql, 34_flashcard_decks.sql, 57_question_banks.sql, 31_topics.sql
-- ==========================================

CREATE TABLE public.deck_groups (
  deck_id  uuid NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  PRIMARY KEY (deck_id, group_id)
);
CREATE INDEX idx_deck_groups_group_id ON public.deck_groups(group_id);
CREATE INDEX idx_deck_groups_deck_id ON public.deck_groups(deck_id);

CREATE TABLE public.bank_groups (
  bank_id  uuid NOT NULL REFERENCES public.question_banks(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  PRIMARY KEY (bank_id, group_id)
);
CREATE INDEX idx_bank_groups_group_id ON public.bank_groups(group_id);
CREATE INDEX idx_bank_groups_bank_id ON public.bank_groups(bank_id);

CREATE TABLE public.topic_groups (
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, group_id)
);
CREATE INDEX idx_topic_groups_group_id ON public.topic_groups(group_id);
CREATE INDEX idx_topic_groups_topic_id ON public.topic_groups(topic_id);

-- ==========================================
-- RPC: get_user_group_ids
-- ==========================================

CREATE FUNCTION public.get_user_group_ids(p_user_id uuid, p_org_id uuid)
RETURNS TABLE(group_id uuid) LANGUAGE sql STABLE AS $$
  SELECT gm.group_id
  FROM public.group_members gm
  JOIN public.groups g ON g.id = gm.group_id
  WHERE gm.user_id = p_user_id AND g.organization_id = p_org_id;
$$;

-- ==========================================
-- RPC: get_accessible_flashcard_decks
-- ==========================================

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

-- ==========================================
-- RPC: get_accessible_flashcards
-- ==========================================

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

-- ==========================================
-- RPC: get_accessible_question_banks
-- ==========================================

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

-- ==========================================
-- RPC: get_accessible_questions
-- ==========================================

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

-- ==========================================
-- RPC: get_accessible_topics
-- ==========================================

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
