-- ============================================
-- FUNCTION: bulk_create_flashcards
-- Atomic multi-table insert for flashcards
-- ============================================
-- Depends on: 30_flashcards.sql, 32_flashcard_topic_assignments.sql, 34_flashcard_decks.sql

CREATE OR REPLACE FUNCTION bulk_create_flashcards(
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
