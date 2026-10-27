-- ==========================================
-- Migration: 20261025075744
-- Description: #395 - `get_practice_state_breakdown` gains the three
-- collection-wide aggregates the "Treści" tab shows above the table
-- ("Przećwiczone", "Śr. poprawność", "Śr. łatwość").
--
-- Those three KPI cards were derived client-side from the *paginated and
-- state-filtered* `/practice/cards-stats` page, so clicking a state chip
-- (e.g. "Oporne") reset them to 0 / "--" even though the collection was
-- untouched. `totalCards` / `neverPracticed` already came from this RPC, so the
-- five cards mixed two scopes.
--
-- The four scope branches are collapsed into a single `scoped` CTE (the
-- disjunction is exactly equivalent to the old IF/ELSIF chain):
--   created_by + org  -> created_by = p AND organization_id = p
--   org only          -> organization_id = p AND (own OR deck shared with my group)
--   created_by only   -> created_by = p
--   neither           -> all cards
-- ...plus the suspended-deck exclusion every branch had.
--
-- Semantics of the new aggregates mirror the UI they replace:
--   practicedCards        - accessible cards with >= 1 practice row for the caller
--   averageAccuracy       - unweighted mean of per-card rounded percentages
--   averageEasinessFactor - mean easiness_factor over cards with a review state,
--                           rounded to 2 dp (0 when none -> UI renders "--")
--
-- Same signature -> CREATE OR REPLACE keeps the existing
-- GRANT EXECUTE ... TO authenticated. LANGUAGE sql STABLE (was plpgsql
-- VOLATILE): the body is a single read-only statement, so STABLE is accurate.
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_practice_state_breakdown(
  p_user_id uuid,
  p_created_by uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  WITH scoped AS (
    SELECT f.id
    FROM public.flashcards f
    WHERE (p_created_by IS NULL OR f.created_by = p_created_by)
      AND (p_organization_id IS NULL OR f.organization_id = p_organization_id)
      AND (
        p_organization_id IS NULL           -- created_by-only scope: no org restriction
        OR p_created_by IS NOT NULL         -- own cards inside the org
        OR f.created_by = p_user_id         -- group scope: own
        OR EXISTS (                          -- group scope: deck shared with one of my groups
          SELECT 1
          FROM public.deck_groups dg
          JOIN public.group_members gm ON gm.group_id = dg.group_id
          WHERE dg.deck_id = f.deck_id AND gm.user_id = p_user_id
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.suspended_decks sd
        WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
      )
  ),
  card_state AS (
    SELECT s.id, rs.flashcard_id, rs.learning_state, rs.is_leech, rs.easiness_factor
    FROM scoped s
    LEFT JOIN public.flashcard_review_state rs
      ON rs.flashcard_id = s.id AND rs.user_id = p_user_id
  ),
  card_practice AS (
    SELECT p.flashcard_id,
           COUNT(*) AS attempts,
           COUNT(*) FILTER (WHERE p.was_correct) AS correct
    FROM public.flashcard_practice p
    JOIN scoped s ON s.id = p.flashcard_id
    WHERE p.user_id = p_user_id
    GROUP BY p.flashcard_id
  )
  SELECT json_build_object(
    'totalCards', (SELECT COUNT(*) FROM scoped)::int,
    'neverPracticed', COUNT(*) FILTER (WHERE cs.flashcard_id IS NULL)::int,
    'learning', COUNT(*) FILTER (WHERE cs.learning_state = 'learning' AND NOT cs.is_leech)::int,
    'review', COUNT(*) FILTER (WHERE cs.learning_state = 'review' AND NOT cs.is_leech)::int,
    'relearning', COUNT(*) FILTER (WHERE cs.learning_state = 'relearning' AND NOT cs.is_leech)::int,
    'leeched', COUNT(*) FILTER (WHERE cs.is_leech)::int,
    'practicedCards', COUNT(*) FILTER (WHERE cp.attempts > 0)::int,
    'averageAccuracy', COALESCE(
      ROUND(AVG(CASE WHEN cp.attempts > 0
        THEN ROUND(cp.correct * 100.0 / cp.attempts)   -- per-card %, matches the UI's correctRate
      END)), 0
    )::int,
    'averageEasinessFactor', COALESCE(ROUND(AVG(cs.easiness_factor)::numeric, 2), 0)
  )
  FROM scoped s
  LEFT JOIN card_state cs ON cs.id = s.id
  LEFT JOIN card_practice cp ON cp.flashcard_id = s.id;
$$;
