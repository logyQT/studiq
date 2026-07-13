-- Drop all stale overloads of get_accessible_flashcards
DROP FUNCTION IF EXISTS public.get_accessible_flashcards(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_accessible_flashcards(uuid, uuid, uuid[], uuid[]);
DROP FUNCTION IF EXISTS public.get_accessible_flashcards(uuid, uuid, uuid[], uuid[], uuid, uuid);

-- Drop all stale overloads of get_accessible_questions
DROP FUNCTION IF EXISTS public.get_accessible_questions(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_accessible_questions(uuid, uuid, uuid[], uuid[]);
DROP FUNCTION IF EXISTS public.get_accessible_questions(uuid, uuid, text, uuid, uuid[], uuid[], text);
DROP FUNCTION IF EXISTS public.get_accessible_questions(uuid, uuid, text, uuid, uuid[], uuid[], text, uuid);

-- Recreate get_accessible_flashcards
CREATE FUNCTION public.get_accessible_flashcards(
  p_user_id uuid,
  p_org_id uuid DEFAULT NULL,
  p_deck_ids uuid[] DEFAULT NULL,
  p_topic_ids uuid[] DEFAULT NULL,
  p_deck_id uuid DEFAULT NULL,
  p_flashcard_id uuid DEFAULT NULL
)
RETURNS SETOF public.flashcards LANGUAGE sql STABLE AS $$
  SELECT DISTINCT f.*
  FROM public.flashcards f
  LEFT JOIN public.flashcard_topic_assignments fta ON fta.flashcard_id = f.id
  LEFT JOIN public.deck_groups dg ON dg.deck_id = f.deck_id
  LEFT JOIN public.topic_groups tg ON tg.topic_id = fta.topic_id
  LEFT JOIN public.group_members gm ON gm.group_id = dg.group_id AND gm.user_id = p_user_id
  WHERE (p_org_id IS NULL OR f.organization_id = p_org_id)
    AND (
      (f.visibility = 'personal' AND f.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    )
    AND (p_deck_ids IS NULL OR f.deck_id = ANY(p_deck_ids))
    AND (p_topic_ids IS NULL OR fta.topic_id = ANY(p_topic_ids))
    AND (p_deck_id IS NULL OR f.deck_id = p_deck_id)
    AND (p_flashcard_id IS NULL OR f.id = p_flashcard_id);
$$;

-- Recreate get_accessible_questions
CREATE FUNCTION public.get_accessible_questions(
  p_user_id uuid,
  p_org_id uuid DEFAULT NULL,
  p_scope text DEFAULT 'own',
  p_question_id uuid DEFAULT NULL,
  p_bank_ids uuid[] DEFAULT NULL,
  p_topic_ids uuid[] DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_bank_id uuid DEFAULT NULL
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
    LEFT JOIN public.question_topic_assignments qta ON qta.question_id = q.id
    LEFT JOIN public.bank_groups bg ON bg.bank_id = q.bank_id
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
      AND (p_bank_ids IS NULL   OR q.bank_id = ANY(p_bank_ids))
      AND (p_topic_ids IS NULL  OR qta.topic_id = ANY(p_topic_ids))
      AND (p_question_id IS NULL OR q.id = p_question_id)
      AND (p_type IS NULL        OR q.type::text = p_type)
      AND (p_bank_id IS NULL    OR q.bank_id = p_bank_id)
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

-- ==========================================
-- STEP 7: Drop stale overloads of bulk_create_flashcards
-- ==========================================
DROP FUNCTION IF EXISTS public.bulk_create_flashcards(jsonb, uuid, uuid, uuid[], uuid[]);
DROP FUNCTION IF EXISTS public.bulk_create_flashcards(jsonb, uuid, uuid, text, uuid[], uuid[]);
DROP FUNCTION IF EXISTS public.bulk_create_flashcards(jsonb, uuid, uuid, visibility_type, uuid[], uuid[]);

CREATE FUNCTION public.bulk_create_flashcards(
  p_cards JSONB,
  p_user_id UUID,
  p_organization_id UUID DEFAULT NULL,
  p_visibility TEXT DEFAULT 'personal',
  p_deck_ids UUID[] DEFAULT '{}',
  p_topic_ids UUID[] DEFAULT '{}'
) RETURNS SETOF flashcards AS $$
DECLARE
  v_ids UUID[];
  v_deck_id UUID;
BEGIN
  IF array_length(p_deck_ids, 1) > 0 THEN
    v_deck_id := p_deck_ids[1];
  END IF;

  WITH ins AS (
    INSERT INTO flashcards (front, back, created_by, organization_id, visibility, deck_id)
    SELECT
      c->>'front',
      c->>'back',
      p_user_id,
      p_organization_id,
      p_visibility::visibility_type,
      v_deck_id
    FROM jsonb_array_elements(p_cards) AS c
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM ins;

  IF array_length(p_topic_ids, 1) > 0 THEN
    INSERT INTO flashcard_topic_assignments (flashcard_id, topic_id)
    SELECT id, unnest(p_topic_ids) FROM unnest(v_ids) AS id;
  END IF;

  RETURN QUERY SELECT * FROM flashcards WHERE id = ANY(v_ids);
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- Drop and recreate get_accessible_flashcard_decks
-- ==========================================
DROP FUNCTION IF EXISTS public.get_accessible_flashcard_decks(uuid, uuid);

CREATE FUNCTION public.get_accessible_flashcard_decks(
  p_user_id uuid,
  p_org_id uuid DEFAULT NULL,
  p_deck_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid, organization_id uuid, created_by uuid, name text, description text,
  visibility visibility_type, search_vector tsvector, created_at timestamptz,
  updated_at timestamptz, flashcard_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT d.id, d.organization_id, d.created_by, d.name, d.description,
    d.visibility, d.search_vector, d.created_at, d.updated_at,
    (SELECT COUNT(*) FROM public.flashcards WHERE deck_id = d.id) AS flashcard_count
  FROM public.flashcard_decks d
  LEFT JOIN public.deck_groups dg ON dg.deck_id = d.id
  LEFT JOIN public.group_members gm ON gm.group_id = dg.group_id AND gm.user_id = p_user_id
  WHERE (p_org_id IS NULL OR d.organization_id = p_org_id)
    AND (
      (d.visibility = 'personal' AND d.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    )
    AND (p_deck_id IS NULL OR d.id = p_deck_id);
$$;

-- ==========================================
-- Drop and recreate get_accessible_question_banks
-- ==========================================
DROP FUNCTION IF EXISTS public.get_accessible_question_banks(uuid, uuid);

CREATE FUNCTION public.get_accessible_question_banks(
  p_user_id uuid,
  p_org_id uuid DEFAULT NULL,
  p_bank_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid, organization_id uuid, created_by uuid, name text, description text,
  visibility visibility_type, search_vector tsvector, created_at timestamptz,
  updated_at timestamptz, question_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT b.id, b.organization_id, b.created_by, b.name, b.description,
    b.visibility, b.search_vector, b.created_at, b.updated_at,
    (SELECT COUNT(*) FROM public.questions WHERE bank_id = b.id) AS question_count
  FROM public.question_banks b
  LEFT JOIN public.bank_groups bg ON bg.bank_id = b.id
  LEFT JOIN public.group_members gm ON gm.group_id = bg.group_id AND gm.user_id = p_user_id
  WHERE (p_org_id IS NULL OR b.organization_id = p_org_id)
    AND (
      (b.visibility = 'personal' AND b.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    )
    AND (p_bank_id IS NULL OR b.id = p_bank_id);
$$;

-- ==========================================
-- Drop and recreate get_accessible_topics
-- ==========================================
DROP FUNCTION IF EXISTS public.get_accessible_topics(uuid, uuid);

CREATE FUNCTION public.get_accessible_topics(
  p_user_id uuid,
  p_org_id uuid DEFAULT NULL,
  p_topic_id uuid DEFAULT NULL
)
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
  WHERE (p_org_id IS NULL OR t.organization_id = p_org_id)
    AND (
      (t.visibility = 'personal' AND t.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    )
    AND (p_topic_id IS NULL OR t.id = p_topic_id);
$$;
