-- =============================================
-- Fix RPC function parameters after rename:
-- universities → organizations, university_id → organization_id
-- =============================================

-- =============================================
-- 1. get_due_flashcards (last defined in 20260620000006_add_session_context.sql)
-- =============================================
DROP FUNCTION IF EXISTS public.get_due_flashcards(
  p_user_id UUID, p_filter_type TEXT, p_university_id UUID,
  p_limit INTEGER, p_deck_ids UUID[], p_topic_ids UUID[], p_new_card_limit INTEGER, p_new_only BOOLEAN
);

CREATE OR REPLACE FUNCTION get_due_flashcards(
  p_user_id UUID,
  p_filter_type TEXT DEFAULT 'own',
  p_organization_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_deck_ids UUID[] DEFAULT NULL,
  p_topic_ids UUID[] DEFAULT NULL,
  p_new_card_limit INTEGER DEFAULT 5,
  p_new_only BOOLEAN DEFAULT false
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_result JSON;
BEGIN
  WITH matching AS (
    SELECT f.id, f.front, f.back, f.created_at
    FROM flashcards f
    WHERE
      CASE p_filter_type
        WHEN 'impossible' THEN FALSE
        WHEN 'any' THEN TRUE
        WHEN 'own' THEN f.created_by = p_user_id
        WHEN 'university' THEN f.created_by = p_user_id OR f.organization_id = p_organization_id
        ELSE FALSE
      END
      AND (p_deck_ids IS NULL OR f.id IN (
        SELECT flashcard_id FROM flashcard_deck_assignments WHERE deck_id = ANY(p_deck_ids)
      ))
      AND (p_topic_ids IS NULL OR f.id IN (
        SELECT flashcard_id FROM flashcard_topic_assignments WHERE topic_id = ANY(p_topic_ids)
      ))
      AND NOT EXISTS (
        SELECT 1 FROM flashcard_deck_assignments fda
        JOIN suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
        WHERE fda.flashcard_id = f.id
      )
  ),
  with_state AS (
    SELECT
      m.id, m.front, m.back, m.created_at,
      rs.easiness_factor, rs.interval_days, rs.repetitions,
      rs.next_review_at, rs.last_reviewed_at, rs.last_quality,
      rs.learning_state, rs.learning_step, rs.lapse_count, rs.is_leech
    FROM matching m
    LEFT JOIN flashcard_review_state rs
      ON rs.flashcard_id = m.id AND rs.user_id = p_user_id
  ),
  learning AS (
    SELECT * FROM with_state
    WHERE learning_state IN ('learning', 'relearning') AND next_review_at <= NOW()
    ORDER BY next_review_at ASC
    LIMIT p_limit
  ),
  review AS (
    SELECT * FROM with_state
    WHERE learning_state = 'review' AND next_review_at <= NOW()
    ORDER BY next_review_at ASC
    LIMIT p_limit
  ),
  new_cards AS (
    SELECT * FROM with_state
    WHERE learning_state IS NULL
    ORDER BY created_at ASC
    LIMIT p_new_card_limit
  ),
  fallback AS (
    SELECT * FROM with_state
    WHERE learning_state IN ('review', 'relearning') AND next_review_at > NOW()
    ORDER BY last_quality ASC NULLS FIRST
    LIMIT p_limit
  ),
  combined AS (
    SELECT * FROM learning WHERE NOT p_new_only
    UNION ALL
    SELECT * FROM review WHERE NOT p_new_only
    UNION ALL
    SELECT * FROM new_cards
    UNION ALL
    SELECT * FROM fallback WHERE NOT p_new_only
    LIMIT p_limit
  )
  SELECT COALESCE(
    (SELECT json_agg(json_build_object(
      'id', c.id,
      'front', c.front,
      'back', c.back,
      'createdAt', c.created_at,
      'reviewState', CASE WHEN c.easiness_factor IS NOT NULL THEN
        json_build_object(
          'easinessFactor', c.easiness_factor,
          'intervalDays', c.interval_days,
          'repetitions', c.repetitions,
          'nextReviewAt', c.next_review_at,
          'lastReviewedAt', c.last_reviewed_at,
          'lastQuality', c.last_quality,
          'learningState', c.learning_state,
          'learningStep', c.learning_step,
          'lapseCount', c.lapse_count,
          'isLeech', c.is_leech
        )
      ELSE NULL END,
      'deckName', (
        SELECT fd.name FROM flashcard_deck_assignments fda
        JOIN flashcard_decks fd ON fd.id = fda.deck_id
        WHERE fda.flashcard_id = c.id LIMIT 1
      ),
      'topicNames', COALESCE(
        (SELECT array_agg(DISTINCT ft.name)
         FROM flashcard_topic_assignments fta
         JOIN flashcard_topics ft ON ft.id = fta.topic_id
         WHERE fta.flashcard_id = c.id),
        '{}'
      )
    )) FROM combined c),
    '[]'::json
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- =============================================
-- 2. search_flashcards (20260615000002_search_flashcards_rpc_ownership.sql)
-- =============================================
DROP FUNCTION IF EXISTS public.search_flashcards(text, int, uuid, uuid);

CREATE OR REPLACE FUNCTION public.search_flashcards(
  search_query text,
  result_limit int DEFAULT 10,
  p_user_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  front text,
  back text,
  rank real,
  deck_id uuid,
  deck_name text
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  en_query tsquery;
  pl_query tsquery;
BEGIN
  IF search_query IS NULL OR trim(search_query) = '' THEN
    RETURN;
  END IF;

  en_query := plainto_tsquery('english', search_query);
  pl_query := plainto_tsquery('polish', search_query);

  RETURN QUERY
  SELECT
    f.id,
    f.front,
    f.back,
    ts_rank(f.search_vector, en_query) + ts_rank(f.search_vector, pl_query) AS rank,
    d.id,
    d.name
  FROM public.flashcards f
  LEFT JOIN public.flashcard_deck_assignments fda ON fda.flashcard_id = f.id
  LEFT JOIN public.flashcard_decks d ON d.id = fda.deck_id
  WHERE (f.search_vector @@ en_query OR f.search_vector @@ pl_query)
    AND (p_user_id IS NULL OR f.created_by = p_user_id OR (p_organization_id IS NOT NULL AND f.organization_id = p_organization_id))
  ORDER BY rank DESC
  LIMIT result_limit;
END;
$$;

-- =============================================
-- 3. get_practice_state_breakdown (20260620000007_get_practice_state_breakdown.sql)
-- =============================================
DROP FUNCTION IF EXISTS public.get_practice_state_breakdown(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_practice_state_breakdown(
  p_user_id uuid,
  p_created_by uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  total int;
  never_practiced int;
  learning_count int;
  review_count int;
  relearning_count int;
  leeched_count int;
BEGIN
  IF p_created_by IS NOT NULL AND p_organization_id IS NOT NULL THEN
    SELECT COUNT(*) INTO total
    FROM public.flashcards f
    WHERE (f.created_by = p_created_by OR f.organization_id = p_organization_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.flashcard_deck_assignments fda
        JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
        WHERE fda.flashcard_id = f.id
      );

    SELECT
      COUNT(*) FILTER (WHERE rs.flashcard_id IS NULL) AS never_practiced,
      COUNT(*) FILTER (WHERE rs.learning_state = 'learning' AND NOT rs.is_leech) AS learning,
      COUNT(*) FILTER (WHERE rs.learning_state = 'review' AND NOT rs.is_leech) AS review,
      COUNT(*) FILTER (WHERE rs.learning_state = 'relearning' AND NOT rs.is_leech) AS relearning,
      COUNT(*) FILTER (WHERE rs.is_leech) AS leeched
    INTO never_practiced, learning_count, review_count, relearning_count, leeched_count
    FROM public.flashcards f
    LEFT JOIN public.flashcard_review_state rs
      ON rs.flashcard_id = f.id AND rs.user_id = p_user_id
    WHERE (f.created_by = p_created_by OR f.organization_id = p_organization_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.flashcard_deck_assignments fda
        JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
        WHERE fda.flashcard_id = f.id
      );

  ELSIF p_created_by IS NOT NULL THEN
    SELECT COUNT(*) INTO total
    FROM public.flashcards f
    WHERE f.created_by = p_created_by
      AND NOT EXISTS (
        SELECT 1 FROM public.flashcard_deck_assignments fda
        JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
        WHERE fda.flashcard_id = f.id
      );

    SELECT
      COUNT(*) FILTER (WHERE rs.flashcard_id IS NULL) AS never_practiced,
      COUNT(*) FILTER (WHERE rs.learning_state = 'learning' AND NOT rs.is_leech) AS learning,
      COUNT(*) FILTER (WHERE rs.learning_state = 'review' AND NOT rs.is_leech) AS review,
      COUNT(*) FILTER (WHERE rs.learning_state = 'relearning' AND NOT rs.is_leech) AS relearning,
      COUNT(*) FILTER (WHERE rs.is_leech) AS leeched
    INTO never_practiced, learning_count, review_count, relearning_count, leeched_count
    FROM public.flashcards f
    LEFT JOIN public.flashcard_review_state rs
      ON rs.flashcard_id = f.id AND rs.user_id = p_user_id
    WHERE f.created_by = p_created_by
      AND NOT EXISTS (
        SELECT 1 FROM public.flashcard_deck_assignments fda
        JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
        WHERE fda.flashcard_id = f.id
      );

  ELSE
    SELECT COUNT(*) INTO total
    FROM public.flashcards f
    WHERE NOT EXISTS (
      SELECT 1 FROM public.flashcard_deck_assignments fda
      JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
      WHERE fda.flashcard_id = f.id
    );

    SELECT
      COUNT(*) FILTER (WHERE rs.flashcard_id IS NULL) AS never_practiced,
      COUNT(*) FILTER (WHERE rs.learning_state = 'learning' AND NOT rs.is_leech) AS learning,
      COUNT(*) FILTER (WHERE rs.learning_state = 'review' AND NOT rs.is_leech) AS review,
      COUNT(*) FILTER (WHERE rs.learning_state = 'relearning' AND NOT rs.is_leech) AS relearning,
      COUNT(*) FILTER (WHERE rs.is_leech) AS leeched
    INTO never_practiced, learning_count, review_count, relearning_count, leeched_count
    FROM public.flashcards f
    LEFT JOIN public.flashcard_review_state rs
      ON rs.flashcard_id = f.id AND rs.user_id = p_user_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.flashcard_deck_assignments fda
      JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
      WHERE fda.flashcard_id = f.id
    );
  END IF;

  RETURN json_build_object(
    'totalCards', total,
    'neverPracticed', never_practiced,
    'learning', learning_count,
    'review', review_count,
    'relearning', relearning_count,
    'leeched', leeched_count
  );
END;
$$;

-- =============================================
-- 4. get_due_breakdown (20260620000008_get_due_breakdown.sql)
-- =============================================
DROP FUNCTION IF EXISTS public.get_due_breakdown(uuid, uuid, uuid, uuid[], uuid[]);

CREATE OR REPLACE FUNCTION public.get_due_breakdown(
  p_user_id uuid,
  p_created_by uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL,
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
  CREATE TEMP TABLE _due ON COMMIT DROP AS
  SELECT f.id
  FROM public.flashcards f
  JOIN public.flashcard_review_state rs ON rs.flashcard_id = f.id AND rs.user_id = p_user_id
  WHERE rs.next_review_at <= NOW()
    AND NOT EXISTS (
      SELECT 1 FROM public.flashcard_deck_assignments fda
      JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
      WHERE fda.flashcard_id = f.id
    )
    AND (
      (p_created_by IS NULL AND p_organization_id IS NULL)
      OR (p_created_by IS NOT NULL AND p_organization_id IS NULL AND f.created_by = p_created_by)
      OR (p_created_by IS NULL AND p_organization_id IS NOT NULL AND (f.created_by = p_created_by OR f.organization_id = p_organization_id))
      OR (p_created_by IS NOT NULL AND p_organization_id IS NOT NULL AND (f.created_by = p_created_by OR f.organization_id = p_organization_id))
    );

  CREATE TEMP TABLE _filtered ON COMMIT DROP AS
  SELECT d.id FROM _due d
  WHERE (p_topic_ids IS NULL OR EXISTS (
    SELECT 1 FROM public.flashcard_topic_assignments WHERE flashcard_id = d.id AND topic_id = ANY(p_topic_ids)
  ))
  AND (p_deck_ids IS NULL OR EXISTS (
    SELECT 1 FROM public.flashcard_deck_assignments WHERE flashcard_id = d.id AND deck_id = ANY(p_deck_ids)
  ));

  SELECT COUNT(*) INTO total FROM _filtered;

  CREATE TEMP TABLE _accessible ON COMMIT DROP AS
  SELECT f.id
  FROM public.flashcards f
  WHERE ( (p_created_by IS NULL AND p_organization_id IS NULL)
    OR (p_created_by IS NOT NULL AND p_organization_id IS NULL AND f.created_by = p_created_by)
    OR (p_created_by IS NULL AND p_organization_id IS NOT NULL AND (f.created_by = p_created_by OR f.organization_id = p_organization_id))
    OR (p_created_by IS NOT NULL AND p_organization_id IS NOT NULL AND (f.created_by = p_created_by OR f.organization_id = p_organization_id)) )
    AND NOT EXISTS (
      SELECT 1 FROM public.flashcard_deck_assignments fda
      JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
      WHERE fda.flashcard_id = f.id
    );

  SELECT MIN(rs.next_review_at) INTO next_review_at
  FROM _accessible a
  JOIN public.flashcard_review_state rs ON rs.flashcard_id = a.id AND rs.user_id = p_user_id
  WHERE rs.next_review_at > NOW();

  SELECT COALESCE(json_agg(json_build_object('topic_id', t.topic_id, 'count', t.cnt)), '[]'::json)
  INTO by_topic
  FROM (
    SELECT fta.topic_id, COUNT(*)::int as cnt
    FROM public.flashcard_topic_assignments fta
    JOIN _filtered d ON d.id = fta.flashcard_id
    GROUP BY fta.topic_id
  ) t;

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

-- =============================================
-- 5. bulk_create_flashcards (20260626000001_bulk_create_flashcards.sql)
-- =============================================
DROP FUNCTION IF EXISTS public.bulk_create_flashcards(jsonb, uuid, uuid, uuid[], uuid[]);

CREATE OR REPLACE FUNCTION bulk_create_flashcards(
  p_cards JSONB,
  p_user_id UUID,
  p_organization_id UUID DEFAULT NULL,
  p_deck_ids UUID[] DEFAULT '{}',
  p_topic_ids UUID[] DEFAULT '{}'
) RETURNS SETOF flashcards AS $$
DECLARE
  v_ids UUID[];
BEGIN
  WITH ins AS (
    INSERT INTO flashcards (front, back, created_by, organization_id)
    SELECT c->>'front', c->>'back', p_user_id, p_organization_id
    FROM jsonb_array_elements(p_cards) AS c
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM ins;

  IF array_length(p_deck_ids, 1) > 0 THEN
    INSERT INTO flashcard_topic_assignments (flashcard_id, topic_id)
    SELECT id, unnest(p_topic_ids) FROM unnest(v_ids) AS id;
  END IF;

  IF array_length(p_deck_ids, 1) > 0 THEN
    INSERT INTO flashcard_deck_assignments (flashcard_id, deck_id)
    SELECT id, unnest(p_deck_ids) FROM unnest(v_ids) AS id;
  END IF;

  RETURN QUERY SELECT * FROM flashcards WHERE id = ANY(v_ids);
END;
$$ LANGUAGE plpgsql;
