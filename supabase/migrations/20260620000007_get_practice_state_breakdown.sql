CREATE OR REPLACE FUNCTION public.get_practice_state_breakdown(
  p_user_id uuid,
  p_created_by uuid DEFAULT NULL,
  p_university_id uuid DEFAULT NULL
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
  IF p_created_by IS NOT NULL AND p_university_id IS NOT NULL THEN
    -- "my cards OR from my university" (student scope)
    SELECT COUNT(*) INTO total
    FROM public.flashcards f
    WHERE (f.created_by = p_created_by OR f.university_id = p_university_id)
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
    WHERE (f.created_by = p_created_by OR f.university_id = p_university_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.flashcard_deck_assignments fda
        JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
        WHERE fda.flashcard_id = f.id
      );

  ELSIF p_created_by IS NOT NULL THEN
    -- Only creator filter (own scope)
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
    -- No filter (any scope)
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
