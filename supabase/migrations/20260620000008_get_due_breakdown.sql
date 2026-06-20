CREATE OR REPLACE FUNCTION public.get_due_breakdown(
  p_user_id uuid,
  p_created_by uuid DEFAULT NULL,
  p_university_id uuid DEFAULT NULL,
  p_topic_ids uuid[] DEFAULT NULL,
  p_deck_ids uuid[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  total int;
  next_review_at timestamptz;
  by_topic json;
  by_deck json;
BEGIN
  -- Due cards with accessible flashcards scoped by RBAC
  CREATE TEMP TABLE _due ON COMMIT DROP AS
  SELECT f.id
  FROM public.flashcards f
  JOIN public.flashcard_review_state rs ON rs.flashcard_id = f.id AND rs.user_id = p_user_id
  WHERE rs.next_review_at <= NOW()
    AND (
      (p_created_by IS NULL AND p_university_id IS NULL)  -- any scope
      OR (p_created_by IS NOT NULL AND p_university_id IS NULL AND f.created_by = p_created_by)  -- own scope
      OR (p_created_by IS NULL AND p_university_id IS NOT NULL AND (f.created_by = p_created_by OR f.university_id = p_university_id))  -- university scope
      OR (p_created_by IS NOT NULL AND p_university_id IS NOT NULL AND (f.created_by = p_created_by OR f.university_id = p_university_id))  -- both
    );

  -- Filter by topic/deck if specified
  CREATE TEMP TABLE _filtered ON COMMIT DROP AS
  SELECT d.id FROM _due d
  WHERE (p_topic_ids IS NULL OR EXISTS (
    SELECT 1 FROM public.flashcard_topic_assignments WHERE flashcard_id = d.id AND topic_id = ANY(p_topic_ids)
  ))
  AND (p_deck_ids IS NULL OR EXISTS (
    SELECT 1 FROM public.flashcard_deck_assignments WHERE flashcard_id = d.id AND deck_id = ANY(p_deck_ids)
  ));

  SELECT COUNT(*) INTO total FROM _filtered;

  -- Next review time (earliest future review among ALL accessible cards)
  CREATE TEMP TABLE _accessible ON COMMIT DROP AS
  SELECT f.id
  FROM public.flashcards f
  WHERE (p_created_by IS NULL AND p_university_id IS NULL)
    OR (p_created_by IS NOT NULL AND p_university_id IS NULL AND f.created_by = p_created_by)
    OR (p_created_by IS NULL AND p_university_id IS NOT NULL AND (f.created_by = p_created_by OR f.university_id = p_university_id))
    OR (p_created_by IS NOT NULL AND p_university_id IS NOT NULL AND (f.created_by = p_created_by OR f.university_id = p_university_id));

  SELECT MIN(rs.next_review_at) INTO next_review_at
  FROM _accessible a
  JOIN public.flashcard_review_state rs ON rs.flashcard_id = a.id AND rs.user_id = p_user_id
  WHERE rs.next_review_at > NOW();

  -- Topic breakdown
  SELECT COALESCE(json_agg(json_build_object('topic_id', t.topic_id, 'count', t.cnt)), '[]'::json)
  INTO by_topic
  FROM (
    SELECT fta.topic_id, COUNT(*)::int as cnt
    FROM public.flashcard_topic_assignments fta
    JOIN _filtered d ON d.id = fta.flashcard_id
    GROUP BY fta.topic_id
  ) t;

  -- Deck breakdown
  SELECT COALESCE(json_agg(json_build_object('deck_id', d.deck_id, 'count', d.cnt)), '[]'::json)
  INTO by_deck
  FROM (
    SELECT fda.deck_id, COUNT(*)::int as cnt
    FROM public.flashcard_deck_assignments fda
    JOIN _filtered d ON d.id = fda.flashcard_id
    GROUP BY fda.deck_id
  ) d;

  RETURN json_build_object(
    'total', total,
    'nextReviewAt', next_review_at,
    'byTopic', by_topic,
    'byDeck', by_deck
  );
END;
$$;
