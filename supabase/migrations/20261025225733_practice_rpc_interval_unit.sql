-- ==========================================
-- Migration: 20261025222207
-- Description: #617 - `get_due_flashcards` emitted `intervalDays` only, so a
-- 1-minute learning step and a 1-day review interval were indistinguishable to
-- the session client. The stats read models already report the magnitude plus
-- its unit (`getAllCardStats`, `getCardsForPractice`: `intervalValue` /
-- `intervalUnit`, #341); this migration makes the due-card RPC consistent.
--
-- Two field changes inside the function body, copied verbatim from the latest
-- definition (`20261024151134_practice_rpc_include_own_cards.sql`):
--   * `rs.interval_unit` added to the `with_state` select list;
--   * `'intervalDays', c.interval_days` replaced with
--     `'intervalValue', c.interval_days, 'intervalUnit', c.interval_unit`.
--
-- No DDL and no data change: the signature is identical, so `CREATE OR REPLACE`
-- keeps the existing `GRANT EXECUTE ... TO authenticated`
-- (`20261024124757_rls_function_and_grant_hardening.sql:323`). The key rename is
-- intentional — the session client reads `intervalValue`/`intervalUnit` and no
-- consumer reads `intervalDays`.
-- ==========================================

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
      rs.learning_state, rs.learning_step, rs.lapse_count, rs.is_leech
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
          'lapseCount', c.lapse_count,
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
