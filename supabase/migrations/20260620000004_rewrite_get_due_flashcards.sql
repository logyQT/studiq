-- Rewrite get_due_flashcards to support learning lifecycle ordering:
-- 1. Learning cards (due for review at their step interval)
-- 2. Review cards (due: next_review_at <= NOW())
-- 3. New cards (no review state row, up to p_new_card_limit)
-- 4. Fallback: worst-quality review cards when nothing else is due
--
-- Daily cap is handled by the service layer, which passes p_new_card_limit.
-- Output shape matches PracticeCardData (see ReviewStateSchema in models).

-- Drop old 6-param overload before creating the new 7-param version
DROP FUNCTION IF EXISTS public.get_due_flashcards(
  p_user_id UUID, p_filter_type TEXT, p_university_id UUID,
  p_limit INTEGER, p_deck_ids UUID[], p_topic_ids UUID[]
);

CREATE OR REPLACE FUNCTION get_due_flashcards(
  p_user_id UUID,
  p_filter_type TEXT DEFAULT 'own',
  p_university_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_deck_ids UUID[] DEFAULT NULL,
  p_topic_ids UUID[] DEFAULT NULL,
  p_new_card_limit INTEGER DEFAULT 5
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
        WHEN 'university' THEN f.created_by = p_user_id OR f.university_id = p_university_id
        ELSE FALSE
      END
      AND (p_deck_ids IS NULL OR f.id IN (
        SELECT flashcard_id FROM flashcard_deck_assignments WHERE deck_id = ANY(p_deck_ids)
      ))
      AND (p_topic_ids IS NULL OR f.id IN (
        SELECT flashcard_id FROM flashcard_topic_assignments WHERE topic_id = ANY(p_topic_ids)
      ))
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
    WHERE learning_state = 'learning' AND next_review_at <= NOW()
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
    WHERE learning_state = 'review' AND next_review_at > NOW()
    ORDER BY last_quality ASC NULLS FIRST
    LIMIT p_limit
  ),
  combined AS (
    SELECT * FROM learning
    UNION ALL
    SELECT * FROM review
    UNION ALL
    SELECT * FROM new_cards
    UNION ALL
    SELECT * FROM fallback
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
      ELSE NULL END
    )) FROM combined c),
    '[]'::json
  ) INTO v_result;

  RETURN v_result;
END;
$$;
