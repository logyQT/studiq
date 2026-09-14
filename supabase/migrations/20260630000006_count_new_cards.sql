-- =============================================
-- count_new_cards — counts flashcards with no
-- review state for the user. Used by getSettings()
-- to show accurate remaining new card count.
-- Pure NOT EXISTS, no array limits, any scale.
-- =============================================

CREATE OR REPLACE FUNCTION count_new_cards(
  p_user_id UUID,
  p_filter_type TEXT DEFAULT 'own',
  p_organization_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM flashcards f
  WHERE
    CASE p_filter_type
      WHEN 'impossible' THEN FALSE
      WHEN 'any' THEN TRUE
      WHEN 'own' THEN f.created_by = p_user_id
      WHEN 'university' THEN f.created_by = p_user_id OR f.organization_id = p_organization_id
      ELSE FALSE
    END
    AND NOT EXISTS (
      SELECT 1 FROM flashcard_review_state rs
      WHERE rs.flashcard_id = f.id AND rs.user_id = p_user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM flashcard_deck_assignments fda
      JOIN suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
      WHERE fda.flashcard_id = f.id
    );

  RETURN v_count;
END;
$$;

GRANT ALL ON FUNCTION count_new_cards TO authenticated, service_role;
