-- Rename the SM-2 lapse counter so it cannot be mistaken for the user-facing
-- „Pomyłki” metric. Lapses are rating-1 ("Again") answers on a graduated card
-- only and feed leech detection; mistake counts come from flashcard_practice.

ALTER TABLE public.flashcard_review_state
  RENAME COLUMN lapse_count TO sm2_lapse_count;

COMMENT ON COLUMN public.flashcard_review_state.sm2_lapse_count IS
  'SM-2 lapses: rating-1 (Again) answers on a graduated card only. Internal scheduling/leech signal, never a UI mistake count (see flashcard_practice.was_correct).';

COMMENT ON COLUMN public.user_study_settings.leech_threshold IS
  'sm2_lapse_count >= this -> card flagged as leech';

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
          AND (p_organization_id IS NULL OR f.organization_id = p_organization_id)
        WHEN 'university' THEN f.organization_id = p_organization_id
          AND (
            f.created_by = p_user_id
            OR (
              f.visibility = 'group'
              AND EXISTS (
                SELECT 1 FROM deck_groups dg
                JOIN group_members gm ON gm.group_id = dg.group_id
                WHERE dg.deck_id = f.deck_id AND gm.user_id = p_user_id
              )
            )
          )
        ELSE FALSE
      END
      AND (p_deck_ids IS NULL OR f.deck_id = ANY(p_deck_ids))
      AND (p_topic_ids IS NULL OR f.id IN (
        SELECT flashcard_id FROM flashcard_topic_assignments WHERE topic_id = ANY(p_topic_ids)
      ))
      AND NOT EXISTS (
        SELECT 1 FROM suspended_decks sd
        WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
      )
  ),
  with_state AS (
    SELECT
      m.id, m.front, m.back, m.created_at,
      rs.easiness_factor, rs.interval_days, rs.interval_unit, rs.repetitions,
      rs.next_review_at, rs.last_reviewed_at, rs.last_quality,
      rs.learning_state, rs.learning_step, rs.sm2_lapse_count, rs.is_leech
    FROM matching m
    LEFT JOIN flashcard_review_state rs
      ON rs.flashcard_id = m.id AND rs.user_id = p_user_id
  ),
  due_cards AS (
    SELECT * FROM with_state
    WHERE easiness_factor IS NOT NULL
      AND next_review_at <= NOW()
      AND NOT is_leech
    ORDER BY next_review_at ASC
    LIMIT p_limit
  ),
  new_cards AS (
    SELECT * FROM with_state
    WHERE easiness_factor IS NULL
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
          'intervalValue', c.interval_days,
          'intervalUnit', c.interval_unit,
          'repetitions', c.repetitions,
          'nextReviewAt', c.next_review_at,
          'lastReviewedAt', c.last_reviewed_at,
          'lastQuality', c.last_quality,
          'learningState', c.learning_state,
          'learningStep', c.learning_step,
          'sm2LapseCount', c.sm2_lapse_count,
          'isLeech', c.is_leech
        )
      ELSE NULL END,
      'deckName', (SELECT fd.name FROM flashcard_decks fd WHERE fd.id = f.deck_id),
      'topicNames', COALESCE(
        (SELECT array_agg(DISTINCT t.name)
         FROM flashcard_topic_assignments fta
         JOIN topics t ON t.id = fta.topic_id
         WHERE fta.flashcard_id = c.id),
        '{}'
      )
    )) FROM combined c LEFT JOIN flashcards f ON f.id = c.id),
    '[]'::json
  ) INTO v_result;

  RETURN v_result;
END;
$$;
