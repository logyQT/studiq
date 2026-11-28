-- ==========================================
-- Issue #1063 — leech cooldown + persistent card suspension.
--
-- `get_due_flashcards` excluded `is_leech` forever and nothing cleared the flag,
-- so a card that reached the leech threshold left review for good. The session's
-- "Zawieś" action only lived in a React `Set`, so a reload lost it.
--
-- The ladder is now explicit:
--   stage 1 — the lapse that reaches the threshold rests the card 7 days
--   stage 2 — the next qualifying lapse rests it 30 days
--   stage 3 — the third qualifying lapse suspends it indefinitely
-- A correct answer never clears a rest (only an explicit restore does), a
-- suspended card stays visible and restorable, and cram remains zero-write.
--
-- `is_leech` stays as the visible flag. It is no longer the exclusion rule: the
-- rest gate and `suspended_cards` are.
-- ==========================================

ALTER TABLE public.flashcard_review_state
  ADD COLUMN leech_stage smallint NOT NULL DEFAULT 0,
  ADD COLUMN leech_rest_until timestamptz;

COMMENT ON COLUMN public.flashcard_review_state.leech_stage IS
  'Leech ladder step: 0 = never leeched, 1 = 7-day rest, 2 = 30-day rest, 3 = suspended';
COMMENT ON COLUMN public.flashcard_review_state.leech_rest_until IS
  'End of the active leech rest; NULL when no rest is active';

-- Existing leeches keep their flag but start the ladder at stage 1. No rest is
-- set: they return to rotation on the next due check rather than disappearing
-- for a week the user never asked for.
UPDATE public.flashcard_review_state
SET leech_stage = 1
WHERE is_leech AND leech_stage = 0;

-- One row per user and card. `reason` tells an explicit session/deck action
-- ('manual') from the automatic stage-3 suspension ('leech').
CREATE TABLE public.suspended_cards (
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  flashcard_id uuid NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE,
  reason       text NOT NULL DEFAULT 'manual' CHECK (reason IN ('manual', 'leech')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, flashcard_id)
);

CREATE INDEX idx_suspended_cards_user ON public.suspended_cards (user_id);

ALTER TABLE public.suspended_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own suspended cards" ON public.suspended_cards
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.suspended_cards FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.suspended_cards TO authenticated;
GRANT ALL ON public.suspended_cards TO service_role;

-- ==========================================
-- `get_due_flashcards` (latest body: 20261109120000)
--
-- The exclusion changes from "never a leech" to "not suspended and not
-- resting". A suspended card is excluded from `matching`, so it can never come
-- back as a "new" card either (its review state still exists, but the guard
-- should not depend on that).
-- ==========================================

create or replace function public.get_due_flashcards(
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
      AND NOT EXISTS (
        SELECT 1 FROM suspended_cards sc
        WHERE sc.flashcard_id = f.id AND sc.user_id = p_user_id
      )
  ),
  with_state AS (
    SELECT
      m.id, m.front, m.back, m.created_at,
      rs.easiness_factor, rs.interval_days, rs.interval_unit, rs.repetitions,
      rs.next_review_at, rs.last_reviewed_at, rs.last_quality,
      rs.learning_state, rs.learning_step, rs.sm2_lapse_count, rs.is_leech,
      rs.leech_stage, rs.leech_rest_until
    FROM matching m
    LEFT JOIN flashcard_review_state rs
      ON rs.flashcard_id = m.id AND rs.user_id = p_user_id
  ),
  due_cards AS (
    SELECT * FROM with_state
    WHERE easiness_factor IS NOT NULL
      AND next_review_at <= NOW()
      AND (leech_rest_until IS NULL OR leech_rest_until <= NOW())
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
          'isLeech', c.is_leech,
          'leechStage', c.leech_stage,
          'leechRestUntil', c.leech_rest_until
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

-- ==========================================
-- `get_due_breakdown` (latest body: 20261024151134)
--
-- `_due` loses `NOT rs.is_leech` and gains the rest gate plus the card
-- suspension exclusion. `_accessible` drives `nextReviewAt`, so a resting card
-- must not advertise its own date there either.
-- ==========================================

create or replace function public.get_due_breakdown(
  p_user_id uuid,
  p_created_by uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL,
  p_topic_ids uuid[] DEFAULT NULL,
  p_deck_ids uuid[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  total int;
  next_review_at timestamptz;
  by_topic json;
  by_deck json;
BEGIN
  CREATE TEMP TABLE _due ON COMMIT DROP AS
  SELECT f.id
  FROM public.flashcards f
  JOIN public.flashcard_review_state rs ON rs.flashcard_id = f.id AND rs.user_id = p_user_id
  WHERE rs.next_review_at <= NOW()
    AND (rs.leech_rest_until IS NULL OR rs.leech_rest_until <= NOW())
    AND NOT EXISTS (
      SELECT 1 FROM public.suspended_decks sd
      WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.suspended_cards sc
      WHERE sc.flashcard_id = f.id AND sc.user_id = p_user_id
    )
    AND (
      (p_created_by IS NULL AND p_organization_id IS NULL)
      OR (p_created_by IS NOT NULL AND p_organization_id IS NOT NULL AND f.created_by = p_created_by AND f.organization_id = p_organization_id)
      OR (p_created_by IS NULL AND p_organization_id IS NOT NULL AND f.organization_id = p_organization_id
          AND (
            f.created_by = p_user_id
            OR (
              f.visibility = 'group'
              AND EXISTS (
                SELECT 1 FROM public.deck_groups dg
                JOIN public.group_members gm ON gm.group_id = dg.group_id
                WHERE dg.deck_id = f.deck_id AND gm.user_id = p_user_id
              )
            )
          ))
      OR (p_created_by IS NOT NULL AND p_organization_id IS NULL AND f.created_by = p_created_by)
    );

  CREATE TEMP TABLE _filtered ON COMMIT DROP AS
  SELECT d.id FROM _due d
  WHERE (p_topic_ids IS NULL OR EXISTS (
    SELECT 1 FROM public.flashcard_topic_assignments WHERE flashcard_id = d.id AND topic_id = ANY(p_topic_ids)
  ))
  AND (p_deck_ids IS NULL OR EXISTS (
    SELECT 1 FROM public.flashcards WHERE id = d.id AND deck_id = ANY(p_deck_ids)
  ));

  SELECT COUNT(*) INTO total FROM _filtered;

  CREATE TEMP TABLE _accessible ON COMMIT DROP AS
  SELECT f.id
  FROM public.flashcards f
  WHERE ( (p_created_by IS NULL AND p_organization_id IS NULL)
    OR (p_created_by IS NOT NULL AND p_organization_id IS NOT NULL AND f.created_by = p_created_by AND f.organization_id = p_organization_id)
    OR (p_created_by IS NULL AND p_organization_id IS NOT NULL AND f.organization_id = p_organization_id
        AND (
          f.created_by = p_user_id
          OR (
            f.visibility = 'group'
            AND EXISTS (
              SELECT 1 FROM public.deck_groups dg
              JOIN public.group_members gm ON gm.group_id = dg.group_id
              WHERE dg.deck_id = f.deck_id AND gm.user_id = p_user_id
            )
          )
        ))
    OR (p_created_by IS NOT NULL AND p_organization_id IS NULL AND f.created_by = p_created_by) )
    AND NOT EXISTS (
      SELECT 1 FROM public.suspended_decks sd
      WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.suspended_cards sc
      WHERE sc.flashcard_id = f.id AND sc.user_id = p_user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.flashcard_review_state rs
      WHERE rs.flashcard_id = f.id AND rs.user_id = p_user_id
        AND rs.leech_rest_until IS NOT NULL AND rs.leech_rest_until > NOW()
    );

  SELECT MIN(rs.next_review_at) INTO next_review_at
  FROM _accessible a
  JOIN public.flashcard_review_state rs ON rs.flashcard_id = a.id AND rs.user_id = p_user_id
  WHERE rs.next_review_at > NOW();

  SELECT COALESCE(json_agg(json_build_object('topic_id', t.topic_id, 'count', t.cnt)), '[]'::json)
  INTO by_topic
  FROM (
    SELECT fta.topic_id, COUNT(*)::int as cnt
    FROM public.flashcard_topic_assignments fta
    JOIN _filtered d ON d.id = fta.flashcard_id
    GROUP BY fta.topic_id
  ) t;

  SELECT COALESCE(json_agg(json_build_object('deck_id', d.deck_id, 'count', d.cnt)), '[]'::json)
  INTO by_deck
  FROM (
    SELECT f.deck_id, COUNT(*)::int as cnt
    FROM public.flashcards f
    JOIN _filtered d ON d.id = f.id
    WHERE f.deck_id IS NOT NULL
    GROUP BY f.deck_id
  ) d;

  RETURN json_build_object(
    'total', total,
    'nextReviewAt', next_review_at,
    'byTopic', by_topic,
    'byDeck', by_deck
  );
END;
$$;

-- ==========================================
-- `get_practice_state_breakdown` (latest body: 20261025075744)
--
-- A suspended card counts once under `suspended` and leaves `learning`,
-- `review`, `relearning` and `leeched`, so the chart's segments still sum to
-- `totalCards`. `totalCards`, `practicedCards` and the two averages do not
-- change: suspension is a per-card flag, not an accessibility rule.
-- ==========================================

create or replace function public.get_practice_state_breakdown(
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
    SELECT s.id, rs.flashcard_id, rs.learning_state, rs.is_leech, rs.easiness_factor,
           EXISTS (
             SELECT 1 FROM public.suspended_cards sc
             WHERE sc.flashcard_id = s.id AND sc.user_id = p_user_id
           ) AS is_suspended
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
    'learning', COUNT(*) FILTER (WHERE cs.learning_state = 'learning' AND NOT cs.is_leech AND NOT cs.is_suspended)::int,
    'review', COUNT(*) FILTER (WHERE cs.learning_state = 'review' AND NOT cs.is_leech AND NOT cs.is_suspended)::int,
    'relearning', COUNT(*) FILTER (WHERE cs.learning_state = 'relearning' AND NOT cs.is_leech AND NOT cs.is_suspended)::int,
    'leeched', COUNT(*) FILTER (WHERE cs.is_leech AND NOT cs.is_suspended)::int,
    'suspended', COUNT(*) FILTER (WHERE cs.is_suspended)::int,
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

-- ==========================================
-- `count_new_cards` (latest body: 20261024151134)
--
-- Defensive: a new card cannot be suspended in this scope (the suspension is
-- written together with a review state), but the count must never include one
-- if that invariant changes.
-- ==========================================

create or replace function public.count_new_cards(
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
    AND NOT EXISTS (
      SELECT 1 FROM flashcard_review_state rs
      WHERE rs.flashcard_id = f.id AND rs.user_id = p_user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM suspended_decks sd
      WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM suspended_cards sc
      WHERE sc.flashcard_id = f.id AND sc.user_id = p_user_id
    );

  RETURN v_count;
END;
$$;
