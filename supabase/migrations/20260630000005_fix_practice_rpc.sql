-- =============================================
-- Fix get_due_flashcards: separate review vs new
-- and exclude leeched cards from both review and count
-- =============================================

-- =============================================
-- 1. get_due_flashcards
-- Two CTEs: due_cards (has review state, due, not leeched)
--           new_cards (no review state = never practiced)
-- =============================================

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
  due_cards AS (
    SELECT * FROM with_state
    WHERE easiness_factor IS NOT NULL       -- has a review state
      AND next_review_at <= NOW()           -- overdue
      AND NOT is_leech                      -- not leeched
    ORDER BY next_review_at ASC
    LIMIT p_limit
  ),
  new_cards AS (
    SELECT * FROM with_state
    WHERE easiness_factor IS NULL           -- no review state = never practiced
    ORDER BY created_at ASC
    LIMIT p_new_card_limit
  ),
  combined AS (
    SELECT * FROM due_cards WHERE NOT p_new_only
    UNION ALL
    SELECT * FROM new_cards WHERE p_new_only
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
-- 2. get_due_breakdown — exclude leeched cards from count
-- =============================================

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
    AND NOT rs.is_leech
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
-- 3. Grant permissions on tables used by practice
-- flashcard_study_sessions had RLS disabled but
-- no GRANT; flashcard_practice and
-- flashcard_review_state were created without
-- RLS or GRANTs entirely; user_daily_activity
-- trigger on flashcard_practice INSERT needs write access.
-- =============================================
GRANT ALL ON public.flashcard_study_sessions TO authenticated, service_role;
GRANT ALL ON public.flashcard_practice TO authenticated, service_role;
GRANT ALL ON public.flashcard_review_state TO authenticated, service_role;
GRANT INSERT, UPDATE ON public.user_daily_activity TO authenticated;
