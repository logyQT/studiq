-- ==========================================
-- Migration: 20261024145155
-- Description: #343 - `get_practice_state_breakdown` under-counted a
-- group-scope user's own flashcards in the active org.
--
-- `flashcard.read = group` means "own cards OR cards in decks shared with my
-- groups" (see `accessibleFilter` / `get_accessible_flashcards`). The
-- `p_organization_id`-only branch of this RPC counted group-shared decks only,
-- so the stats summary ("WSZYSTKIE FISZKI" / "NOWE FISZKI") disagreed with the
-- "Tresci" table, which listed the whole organization. Both halves now use the
-- accessible set: own cards + decks shared with the caller's groups.
--
-- The redundant `f.visibility = 'group'` predicate is dropped: `deck_groups` is
-- the actual sharing signal and what `accessibleFilter` /
-- `get_accessible_flashcards` use. Same signature -> CREATE OR REPLACE keeps
-- the existing GRANT EXECUTE ... TO authenticated.
-- ==========================================

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
    WHERE f.created_by = p_created_by AND f.organization_id = p_organization_id
      AND NOT EXISTS (
        SELECT 1 FROM public.suspended_decks sd
        WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
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
    WHERE f.created_by = p_created_by AND f.organization_id = p_organization_id
      AND NOT EXISTS (
        SELECT 1 FROM public.suspended_decks sd
        WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
      );

  ELSIF p_organization_id IS NOT NULL THEN
    SELECT COUNT(*) INTO total
    FROM public.flashcards f
    WHERE f.organization_id = p_organization_id
      AND (
        f.created_by = p_user_id
        OR EXISTS (
          SELECT 1 FROM public.deck_groups dg
          JOIN public.group_members gm ON gm.group_id = dg.group_id
          WHERE dg.deck_id = f.deck_id AND gm.user_id = p_user_id
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.suspended_decks sd
        WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
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
    WHERE f.organization_id = p_organization_id
      AND (
        f.created_by = p_user_id
        OR EXISTS (
          SELECT 1 FROM public.deck_groups dg
          JOIN public.group_members gm ON gm.group_id = dg.group_id
          WHERE dg.deck_id = f.deck_id AND gm.user_id = p_user_id
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.suspended_decks sd
        WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
      );

  ELSIF p_created_by IS NOT NULL THEN
    SELECT COUNT(*) INTO total
    FROM public.flashcards f
    WHERE f.created_by = p_created_by
      AND NOT EXISTS (
        SELECT 1 FROM public.suspended_decks sd
        WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
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
        SELECT 1 FROM public.suspended_decks sd
        WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
      );

  ELSE
    SELECT COUNT(*) INTO total
    FROM public.flashcards f
    WHERE NOT EXISTS (
        SELECT 1 FROM public.suspended_decks sd
        WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
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
        SELECT 1 FROM public.suspended_decks sd
        WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
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
