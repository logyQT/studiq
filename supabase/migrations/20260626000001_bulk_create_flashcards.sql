-- =============================================
-- Bulk create flashcards in a single transaction
-- =============================================
-- Replaces 3 separate inserts (flashcards + topic_assignments + deck_assignments)
-- with one atomic RPC call. Removes the orphan risk if step 2 or 3 fails.
--
-- Usage:
--   SELECT * FROM bulk_create_flashcards(
--     '[{"front":"...","back":"..."}]'::jsonb,
--     'user-uuid',
--     'university-uuid',
--     '{"deck-id"}'::uuid[],
--     '{"topic-id"}'::uuid[]
--   );

CREATE OR REPLACE FUNCTION bulk_create_flashcards(
  p_cards JSONB,
  p_user_id UUID,
  p_university_id UUID DEFAULT NULL,
  p_deck_ids UUID[] DEFAULT '{}',
  p_topic_ids UUID[] DEFAULT '{}'
) RETURNS SETOF flashcards AS $$
DECLARE
  v_ids UUID[];
BEGIN
  -- Step 1: Insert all flashcards
  WITH ins AS (
    INSERT INTO flashcards (front, back, created_by, university_id)
    SELECT c->>'front', c->>'back', p_user_id, p_university_id
    FROM jsonb_array_elements(p_cards) AS c
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM ins;

  -- Step 2: Topic assignments (if any)
  -- CROSS JOIN: each card gets every topic ID (N_cards × M_topics rows)
  IF array_length(p_topic_ids, 1) > 0 THEN
    INSERT INTO flashcard_topic_assignments (flashcard_id, topic_id)
    SELECT id, unnest(p_topic_ids) FROM unnest(v_ids) AS id;
  END IF;

  -- Step 3: Deck assignments (if any)
  -- CROSS JOIN: each card gets every deck ID (N_cards × M_decks rows)
  IF array_length(p_deck_ids, 1) > 0 THEN
    INSERT INTO flashcard_deck_assignments (flashcard_id, deck_id)
    SELECT id, unnest(p_deck_ids) FROM unnest(v_ids) AS id;
  END IF;

  -- Return created flashcards
  RETURN QUERY SELECT * FROM flashcards WHERE id = ANY(v_ids);
END;
$$ LANGUAGE plpgsql;
