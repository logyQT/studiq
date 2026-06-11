-- Optimizes getDueCards: single PL/pgSQL function replaces 3 JS round-trips.
-- Accepts RBAC filter metadata + deck/topic filters, returns due cards JSON.
-- Falls back to worst-quality cards when nothing is due.

CREATE OR REPLACE FUNCTION get_due_flashcards(
  p_user_id UUID,
  p_filter_type TEXT DEFAULT 'own',
  p_university_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_deck_ids UUID[] DEFAULT NULL,
  p_topic_ids UUID[] DEFAULT NULL
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
      rs.next_review_at, rs.last_reviewed_at, rs.last_quality
    FROM matching m
    LEFT JOIN flashcard_review_state rs
      ON rs.flashcard_id = m.id AND rs.user_id = p_user_id
  ),
  due AS (
    SELECT * FROM with_state
    WHERE next_review_at IS NULL OR next_review_at <= NOW()
    ORDER BY next_review_at ASC NULLS FIRST
    LIMIT p_limit
  ),
  fallback AS (
    SELECT * FROM with_state
    WHERE next_review_at > NOW()
    ORDER BY last_quality ASC NULLS FIRST
    LIMIT p_limit
  )
  SELECT COALESCE(
    (SELECT json_agg(json_build_object(
      'id', d.id,
      'front', d.front,
      'back', d.back,
      'createdAt', d.created_at,
      'reviewState', CASE WHEN d.easiness_factor IS NOT NULL THEN
        json_build_object(
          'easinessFactor', d.easiness_factor,
          'intervalDays', d.interval_days,
          'repetitions', d.repetitions,
          'nextReviewAt', d.next_review_at,
          'lastReviewedAt', d.last_reviewed_at,
          'lastQuality', d.last_quality
        )
      ELSE NULL END
    )) FROM due),
    (SELECT json_agg(json_build_object(
      'id', f.id,
      'front', f.front,
      'back', f.back,
      'createdAt', f.created_at,
      'reviewState', json_build_object(
        'easinessFactor', f.easiness_factor,
        'intervalDays', f.interval_days,
        'repetitions', f.repetitions,
        'nextReviewAt', f.next_review_at,
        'lastReviewedAt', f.last_reviewed_at,
        'lastQuality', f.last_quality
      )
    )) FROM fallback),
    '[]'::json
  ) INTO v_result;

  RETURN v_result;
END;
$$;
