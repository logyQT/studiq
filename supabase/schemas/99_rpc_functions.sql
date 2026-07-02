-- ==========================================
-- RPC FUNCTIONS
-- Application-facing functions used by the
-- backend service layer. All use the latest
-- parameter signatures (organization_id, etc.).
-- ==========================================

-- ==========================================
-- get_due_flashcards
-- Returns due + new flashcards for a user,
-- scoped by RBAC filter. Separates review vs
-- new and excludes leeched cards.
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
        WHEN 'university' THEN f.created_by = p_user_id OR f.organization_id = p_organization_id
        ELSE FALSE
      END
      AND (p_deck_ids IS NULL OR f.id IN (
        SELECT flashcard_id FROM flashcard_deck_assignments WHERE deck_id = ANY(p_deck_ids)
      ))
      AND (p_topic_ids IS NULL OR f.id IN (
        SELECT flashcard_id FROM flashcard_topic_assignments WHERE topic_id = ANY(p_topic_ids)
      ))
      AND NOT EXISTS (
        SELECT 1 FROM flashcard_deck_assignments fda
        JOIN suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
        WHERE fda.flashcard_id = f.id
      )
  ),
  with_state AS (
    SELECT
      m.id, m.front, m.back, m.created_at,
      rs.easiness_factor, rs.interval_days, rs.repetitions,
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
          'intervalDays', c.interval_days,
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
      'deckName', (
        SELECT fd.name FROM flashcard_deck_assignments fda
        JOIN flashcard_decks fd ON fd.id = fda.deck_id
        WHERE fda.flashcard_id = c.id LIMIT 1
      ),
      'topicNames', COALESCE(
        (SELECT array_agg(DISTINCT t.name)
         FROM flashcard_topic_assignments fta
         JOIN topics t ON t.id = fta.topic_id
         WHERE fta.flashcard_id = c.id),
        '{}'
      )
    )) FROM combined c),
    '[]'::json
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ==========================================
-- get_due_breakdown
-- Counts due cards per topic and deck, plus
-- next review time. Excludes leeched cards.
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_due_breakdown(
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
    AND NOT rs.is_leech
    AND NOT EXISTS (
      SELECT 1 FROM public.flashcard_deck_assignments fda
      JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
      WHERE fda.flashcard_id = f.id
    )
    AND (
      (p_created_by IS NULL AND p_organization_id IS NULL)
      OR (p_created_by IS NOT NULL AND p_organization_id IS NULL AND f.created_by = p_created_by)
      OR (p_created_by IS NULL AND p_organization_id IS NOT NULL AND (f.created_by = p_created_by OR f.organization_id = p_organization_id))
      OR (p_created_by IS NOT NULL AND p_organization_id IS NOT NULL AND (f.created_by = p_created_by OR f.organization_id = p_organization_id))
    );

  CREATE TEMP TABLE _filtered ON COMMIT DROP AS
  SELECT d.id FROM _due d
  WHERE (p_topic_ids IS NULL OR EXISTS (
    SELECT 1 FROM public.flashcard_topic_assignments WHERE flashcard_id = d.id AND topic_id = ANY(p_topic_ids)
  ))
  AND (p_deck_ids IS NULL OR EXISTS (
    SELECT 1 FROM public.flashcard_deck_assignments WHERE flashcard_id = d.id AND deck_id = ANY(p_deck_ids)
  ));

  SELECT COUNT(*) INTO total FROM _filtered;

  CREATE TEMP TABLE _accessible ON COMMIT DROP AS
  SELECT f.id
  FROM public.flashcards f
  WHERE ( (p_created_by IS NULL AND p_organization_id IS NULL)
    OR (p_created_by IS NOT NULL AND p_organization_id IS NULL AND f.created_by = p_created_by)
    OR (p_created_by IS NULL AND p_organization_id IS NOT NULL AND (f.created_by = p_created_by OR f.organization_id = p_organization_id))
    OR (p_created_by IS NOT NULL AND p_organization_id IS NOT NULL AND (f.created_by = p_created_by OR f.organization_id = p_organization_id)) )
    AND NOT EXISTS (
      SELECT 1 FROM public.flashcard_deck_assignments fda
      JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
      WHERE fda.flashcard_id = f.id
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
    SELECT fda.deck_id, COUNT(*)::int as cnt
    FROM public.flashcard_deck_assignments fda
    JOIN _filtered d ON d.id = fda.flashcard_id
    GROUP BY fda.deck_id
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
-- get_practice_state_breakdown
-- Counts flashcards by practice state
-- (never_practiced, learning, review,
--  relearning, leeched) for a user.
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
    WHERE (f.created_by = p_created_by OR f.organization_id = p_organization_id)
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
    WHERE (f.created_by = p_created_by OR f.organization_id = p_organization_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.flashcard_deck_assignments fda
        JOIN public.suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
        WHERE fda.flashcard_id = f.id
      );

  ELSIF p_created_by IS NOT NULL THEN
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

-- ==========================================
-- search_flashcards
-- Bilingual full-text search across flashcards
-- with RBAC ownership scope filtering.
-- ==========================================

CREATE OR REPLACE FUNCTION public.search_flashcards(
  search_query text,
  result_limit int DEFAULT 10,
  p_user_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  front text,
  back text,
  rank real,
  deck_id uuid,
  deck_name text
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  en_query tsquery;
  pl_query tsquery;
BEGIN
  IF search_query IS NULL OR trim(search_query) = '' THEN
    RETURN;
  END IF;

  en_query := plainto_tsquery('english', search_query);
  pl_query := plainto_tsquery('polish', search_query);

  RETURN QUERY
  SELECT
    f.id,
    f.front,
    f.back,
    ts_rank(f.search_vector, en_query) + ts_rank(f.search_vector, pl_query) AS rank,
    d.id,
    d.name
  FROM public.flashcards f
  LEFT JOIN public.flashcard_deck_assignments fda ON fda.flashcard_id = f.id
  LEFT JOIN public.flashcard_decks d ON d.id = fda.deck_id
  WHERE (f.search_vector @@ en_query OR f.search_vector @@ pl_query)
    AND (p_user_id IS NULL OR f.created_by = p_user_id OR (p_organization_id IS NOT NULL AND f.organization_id = p_organization_id))
  ORDER BY rank DESC
  LIMIT result_limit;
END;
$$;

-- ==========================================
-- get_teacher_stats
-- Aggregates teacher dashboard stats server-side
-- to avoid large SELECT limits.
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_teacher_stats(
  p_flashcard_ids uuid[],
  p_user_id uuid,
  p_deck_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_flashcard_ids uuid[];
  result jsonb;
BEGIN
  IF p_deck_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT fda.flashcard_id)
    INTO v_flashcard_ids
    FROM public.flashcard_deck_assignments fda
    WHERE fda.flashcard_id = ANY(p_flashcard_ids)
      AND fda.deck_id = p_deck_id;
  ELSE
    v_flashcard_ids := p_flashcard_ids;
  END IF;

  IF v_flashcard_ids IS NULL OR array_length(v_flashcard_ids, 1) IS NULL OR array_length(v_flashcard_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'summary', jsonb_build_object(
        'totalDecks', 0, 'totalFlashcards', 0, 'totalPractices', 0,
        'totalStudents', 0, 'overallAccuracy', 0, 'averageEasinessFactor', 0,
        'difficultyBreakdown', jsonb_build_object('easy', 0, 'medium', 0, 'hard', 0, 'new', 0)
      ),
      'byDeck', '[]'::jsonb,
      'byTopic', '[]'::jsonb
    );
  END IF;

  WITH
    decks AS (
      SELECT id, name FROM public.flashcard_decks WHERE created_by = p_user_id
    ),
    deck_assignments AS (
      SELECT flashcard_id, deck_id
      FROM public.flashcard_deck_assignments
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    topic_assignments AS (
      SELECT flashcard_id, topic_id
      FROM public.flashcard_topic_assignments
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    topics AS (
      SELECT id, name FROM public.topics
      WHERE id IN (SELECT DISTINCT topic_id FROM topic_assignments)
    ),
    practices AS (
      SELECT flashcard_id, was_correct, user_id
      FROM public.flashcard_practice
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    review_states AS (
      SELECT flashcard_id, easiness_factor
      FROM public.flashcard_review_state
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    summary AS (
      SELECT
        (SELECT COUNT(*) FROM decks)::int AS total_decks,
        array_length(v_flashcard_ids, 1) AS total_flashcards,
        (SELECT COUNT(*) FROM practices)::int AS total_practices,
        (SELECT COUNT(DISTINCT user_id) FROM practices)::int AS total_students,
        CASE
          WHEN (SELECT COUNT(*) FROM practices) > 0
          THEN ROUND(
            (SELECT COUNT(*) FILTER (WHERE was_correct) FROM practices) * 100.0 /
            (SELECT COUNT(*) FROM practices)
          )::int
          ELSE 0
        END AS overall_accuracy,
        COALESCE(
          (SELECT ROUND(AVG(easiness_factor)::numeric, 2) FROM review_states),
          0
        )::numeric(5,2) AS avg_ef
    ),
    deck_fc_count AS (
      SELECT da.deck_id, COUNT(DISTINCT da.flashcard_id)::int AS flashcard_count
      FROM deck_assignments da
      GROUP BY da.deck_id
    ),
    deck_practices AS (
      SELECT
        da.deck_id,
        COUNT(*)::int AS practice_count,
        COUNT(*) FILTER (WHERE p.was_correct)::int AS correct_count
      FROM deck_assignments da
      JOIN practices p ON p.flashcard_id = da.flashcard_id
      GROUP BY da.deck_id
    ),
    deck_ef AS (
      SELECT
        da.deck_id,
        ROUND(AVG(rs.easiness_factor)::numeric, 2)::numeric(5,2) AS avg_ef
      FROM deck_assignments da
      JOIN review_states rs ON rs.flashcard_id = da.flashcard_id
      GROUP BY da.deck_id
    ),
    by_deck AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'deckId', d.id,
          'deckName', d.name,
          'flashcardCount', COALESCE(dfc.flashcard_count, 0),
          'practiceCount', COALESCE(dp.practice_count, 0),
          'correctCount', COALESCE(dp.correct_count, 0),
          'accuracy', CASE
            WHEN COALESCE(dp.practice_count, 0) > 0
            THEN ROUND(dp.correct_count * 100.0 / dp.practice_count)::int
            ELSE 0
          END,
          'avgEasinessFactor', COALESCE(de.avg_ef, 0)::numeric(5,2)
        )
        ORDER BY COALESCE(dp.practice_count, 0) DESC
      ) AS data
      FROM decks d
      JOIN deck_fc_count dfc ON dfc.deck_id = d.id
      LEFT JOIN deck_practices dp ON dp.deck_id = d.id
      LEFT JOIN deck_ef de ON de.deck_id = d.id
      WHERE dfc.flashcard_count > 0
    ),
    topic_fc_count AS (
      SELECT ta.topic_id, COUNT(DISTINCT ta.flashcard_id)::int AS flashcard_count
      FROM topic_assignments ta
      GROUP BY ta.topic_id
    ),
    topic_practices AS (
      SELECT
        ta.topic_id,
        COUNT(*)::int AS practice_count,
        COUNT(*) FILTER (WHERE p.was_correct)::int AS correct_count
      FROM topic_assignments ta
      JOIN practices p ON p.flashcard_id = ta.flashcard_id
      GROUP BY ta.topic_id
    ),
    by_topic AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'topicId', t.id,
          'topicName', t.name,
          'flashcardCount', COALESCE(tfc.flashcard_count, 0),
          'practiceCount', COALESCE(tp.practice_count, 0),
          'accuracy', CASE
            WHEN COALESCE(tp.practice_count, 0) > 0
            THEN ROUND(tp.correct_count * 100.0 / tp.practice_count)::int
            ELSE 0
          END
        )
        ORDER BY COALESCE(tp.practice_count, 0) DESC
      ) AS data
      FROM topics t
      JOIN topic_fc_count tfc ON tfc.topic_id = t.id
      LEFT JOIN topic_practices tp ON tp.topic_id = t.id
      WHERE tfc.flashcard_count > 0
    ),
    student_card_diff AS (
      SELECT
        p.flashcard_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE p.was_correct) * 1.0 / COUNT(*) >= 0.8 THEN 'easy'
          WHEN COUNT(*) FILTER (WHERE p.was_correct) * 1.0 / COUNT(*) >= 0.5 THEN 'medium'
          ELSE 'hard'
        END::text AS bucket
      FROM practices p
      GROUP BY p.flashcard_id, p.user_id
    ),
    card_votes AS (
      SELECT
        flashcard_id,
        COUNT(*) FILTER (WHERE bucket = 'easy')::int AS easy_votes,
        COUNT(*) FILTER (WHERE bucket = 'medium')::int AS medium_votes,
        COUNT(*) FILTER (WHERE bucket = 'hard')::int AS hard_votes
      FROM student_card_diff
      GROUP BY flashcard_id
    ),
    card_majority AS (
      SELECT
        CASE
          WHEN hard_votes >= medium_votes AND hard_votes >= easy_votes THEN 'hard'
          WHEN medium_votes >= easy_votes THEN 'medium'
          ELSE 'easy'
        END::text AS bucket
      FROM card_votes
    ),
    difficulty_breakdown AS (
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE bucket = 'easy'), 0)::int AS easy,
        COALESCE(COUNT(*) FILTER (WHERE bucket = 'medium'), 0)::int AS medium,
        COALESCE(COUNT(*) FILTER (WHERE bucket = 'hard'), 0)::int AS hard
      FROM card_majority
    ),
    new_count AS (
      SELECT COUNT(*)::int AS new
      FROM UNNEST(v_flashcard_ids) AS id
      WHERE id NOT IN (SELECT DISTINCT flashcard_id FROM practices)
    )

  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'totalDecks', (SELECT total_decks FROM summary),
      'totalFlashcards', (SELECT total_flashcards FROM summary),
      'totalPractices', (SELECT total_practices FROM summary),
      'totalStudents', (SELECT total_students FROM summary),
      'overallAccuracy', (SELECT overall_accuracy FROM summary),
      'averageEasinessFactor', (SELECT avg_ef FROM summary),
      'difficultyBreakdown', jsonb_build_object(
        'easy', (SELECT easy FROM difficulty_breakdown),
        'medium', (SELECT medium FROM difficulty_breakdown),
        'hard', (SELECT hard FROM difficulty_breakdown),
        'new', (SELECT new FROM new_count)
      )
    ),
    'byDeck', COALESCE((SELECT data FROM by_deck), '[]'::jsonb),
    'byTopic', COALESCE((SELECT data FROM by_topic), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- ==========================================
-- count_new_cards
-- Counts flashcards with no review state for
-- the user. Used to show accurate remaining
-- new card count in settings.
-- ==========================================

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
