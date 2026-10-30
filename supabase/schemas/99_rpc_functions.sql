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
      SELECT 1 FROM public.suspended_decks sd
      WHERE sd.deck_id = f.deck_id AND sd.user_id = p_user_id
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
-- get_practice_state_breakdown
-- Counts flashcards by practice state
-- (never_practiced, learning, review,
--  relearning, leeched) and the collection-wide
-- summary (practiced, accuracy, easiness) for a user.
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
  LEFT JOIN public.flashcard_decks d ON d.id = f.deck_id
  WHERE (f.search_vector @@ en_query OR f.search_vector @@ pl_query)
    AND (p_organization_id IS NULL OR f.organization_id = p_organization_id)
    AND (p_user_id IS NULL OR f.created_by = p_user_id)
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
  p_deck_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_flashcard_ids uuid[];
  v_organization_id uuid;
  v_roster_students int;              -- NULL stays NULL: "no org" is not "0 students"
  result jsonb;
BEGIN
  IF p_deck_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT f.id)
    INTO v_flashcard_ids
    FROM public.flashcards f
    WHERE f.id = ANY(p_flashcard_ids)
      AND f.deck_id = p_deck_id;
  ELSE
    v_flashcard_ids := p_flashcard_ids;
  END IF;

  -- Authorization: only the caller's own dashboard, or the service role
  -- (backend/tests), may aggregate. Anything else fails with 42501 instead of
  -- returning another user's practice data.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'get_teacher_stats may only be called for the authenticated user'
        USING ERRCODE = '42501';
    END IF;

    -- SECURITY DEFINER bypasses RLS, so a crafted p_flashcard_ids could still
    -- aggregate practice rows of another tenant's cards. Narrow the request to
    -- cards the caller can read (own, or in one of their organizations) — the
    -- same floor as the public.flashcards policy.
    SELECT ARRAY_AGG(DISTINCT f.id)
    INTO v_flashcard_ids
    FROM public.flashcards f
    WHERE f.id = ANY(v_flashcard_ids)
      AND (
        f.created_by = auth.uid()
        OR f.organization_id IN (
          SELECT c.organization_id FROM public.rls_caller_org_ids() c
        )
      );

    -- #460: SECURITY DEFINER must not trust the org parameter on its own — a
    -- crafted call would otherwise become a cross-tenant roster oracle.
    IF p_organization_id IS NOT NULL
       AND p_organization_id IN (
         SELECT c.organization_id FROM public.rls_caller_org_ids() c
       ) THEN
      v_organization_id := p_organization_id;
    END IF;
  ELSE
    v_organization_id := p_organization_id;   -- service role: backend + integration tests
  END IF;

  -- Roster: distinct learners in the caller's groups of the active
  -- organization. `ctx.groupIds` spans every org, so the groups are re-filtered
  -- by organization, and the group must also contain the caller.
  IF v_organization_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT learner.user_id)::int
    INTO v_roster_students
    FROM public.groups g
    JOIN public.group_members learner ON learner.group_id = g.id
    WHERE g.organization_id = v_organization_id
      AND learner.role = 'member'
      AND learner.user_id <> p_user_id
      AND EXISTS (
        SELECT 1 FROM public.group_members caller
        WHERE caller.group_id = g.id AND caller.user_id = p_user_id
      );
  END IF;

  IF v_flashcard_ids IS NULL OR array_length(v_flashcard_ids, 1) IS NULL OR array_length(v_flashcard_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'summary', jsonb_build_object(
        'totalDecks', 0, 'totalFlashcards', 0, 'totalPractices', 0,
        'practicingStudents', 0,
        'rosterStudents', v_roster_students,
        'overallAccuracy', 0, 'averageEasinessFactor', 0,
        'difficultyBreakdown', jsonb_build_object('easy', 0, 'medium', 0, 'hard', 0, 'new', 0)
      ),
      'byDeck', '[]'::jsonb,
      'byTopic', '[]'::jsonb
    );
  END IF;

  WITH
    deck_assignments AS (
      SELECT f.id AS flashcard_id, f.deck_id
      FROM public.flashcards f
      WHERE f.id = ANY(v_flashcard_ids) AND f.deck_id IS NOT NULL
    ),
    -- Decks represented in the caller's scoped flashcard set. `totalDecks` is
    -- COUNT(*) of this CTE and `byDeck` joins it, so the summary card and the
    -- "Podział na talie" table can never disagree (#149).
    decks AS (
      SELECT d.id, d.name
      FROM public.flashcard_decks d
      WHERE d.created_by = p_user_id
        AND d.id IN (SELECT da.deck_id FROM deck_assignments da)
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
        -- #460: the caller is not a student of their own deck.
        (SELECT COUNT(DISTINCT user_id) FROM practices WHERE user_id <> p_user_id)::int
          AS practicing_students,
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
      'practicingStudents', (SELECT practicing_students FROM summary),
      'rosterStudents', v_roster_students,
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
-- admin_platform_stats / admin_daily_stats (#663, ROADMAP 7A)
-- Platform-wide numbers for the admin app, across every tenant: users, organizations, content,
-- activity, storage, and a per-day series. SECURITY DEFINER and service-role only (the admin app
-- connects as the service role); anyone else gets 42501.
-- ==========================================

CREATE OR REPLACE FUNCTION public.admin_platform_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'admin_platform_stats is for the service role only'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'users', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM public.profiles WHERE deleted_at IS NULL),
      'deleted', (SELECT COUNT(*) FROM public.profiles WHERE deleted_at IS NOT NULL),
      'newLast7Days', (
        SELECT COUNT(*) FROM public.profiles
        WHERE deleted_at IS NULL
          AND (created_at AT TIME ZONE 'UTC')::date >= (now() AT TIME ZONE 'UTC')::date - 6
      ),
      'newLast30Days', (
        SELECT COUNT(*) FROM public.profiles
        WHERE deleted_at IS NULL
          AND (created_at AT TIME ZONE 'UTC')::date >= (now() AT TIME ZONE 'UTC')::date - 29
      )
    ),
    'active', jsonb_build_object(
      'last7Days', (
        SELECT COUNT(DISTINCT a.user_id)
        FROM public.user_daily_activity a
        JOIN public.profiles p ON p.id = a.user_id AND p.deleted_at IS NULL
        WHERE a.date >= (now() AT TIME ZONE 'UTC')::date - 6
          AND (a.reviews_count > 0 OR a.quizzes_count > 0)
      ),
      'last30Days', (
        SELECT COUNT(DISTINCT a.user_id)
        FROM public.user_daily_activity a
        JOIN public.profiles p ON p.id = a.user_id AND p.deleted_at IS NULL
        WHERE a.date >= (now() AT TIME ZONE 'UTC')::date - 29
          AND (a.reviews_count > 0 OR a.quizzes_count > 0)
      )
    ),
    'organizations', (SELECT COUNT(*) FROM public.organizations),
    'groups', (SELECT COUNT(*) FROM public.groups),
    'content', jsonb_build_object(
      'decks', (SELECT COUNT(*) FROM public.flashcard_decks),
      'flashcards', (SELECT COUNT(*) FROM public.flashcards),
      'questionBanks', (SELECT COUNT(*) FROM public.question_banks),
      'questions', (SELECT COUNT(*) FROM public.questions),
      'assignments', (SELECT COUNT(*) FROM public.teacher_assignments),
      'quizAttempts', (SELECT COUNT(*) FROM public.quiz_attempts WHERE completed_at IS NOT NULL)
    ),
    'storage', jsonb_build_object(
      'objects', (SELECT COUNT(*) FROM storage.objects),
      -- the size is a string in the object metadata: only digits are summed, anything else is 0
      'bytes', COALESCE(
        (SELECT SUM(CASE WHEN metadata->>'size' ~ '^[0-9]{1,15}$' THEN (metadata->>'size')::bigint ELSE 0 END)
         FROM storage.objects),
        0
      )
    )
  )
  INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_daily_stats(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_days integer := GREATEST(1, LEAST(COALESCE(p_days, 30), 365));
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'admin_daily_stats is for the service role only'
      USING ERRCODE = '42501';
  END IF;

  WITH days AS (
    SELECT d::date AS day
    FROM generate_series(v_today - (v_days - 1), v_today, interval '1 day') AS d
  ),
  registrations AS (
    SELECT (created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS n
    FROM public.profiles
    WHERE deleted_at IS NULL
      AND (created_at AT TIME ZONE 'UTC')::date >= v_today - (v_days - 1)
    GROUP BY 1
  ),
  attempts AS (
    SELECT (completed_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS n
    FROM public.quiz_attempts
    WHERE completed_at IS NOT NULL AND completed_at >= v_today - (v_days - 1)
    GROUP BY 1
  ),
  sessions AS (
    SELECT (completed_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS n
    FROM public.flashcard_study_sessions
    WHERE completed_at >= v_today - (v_days - 1)
    GROUP BY 1
  ),
  reviews AS (
    SELECT
      a.date AS day,
      SUM(a.reviews_count)::int AS n,
      COUNT(DISTINCT a.user_id) FILTER (WHERE a.reviews_count > 0 OR a.quizzes_count > 0)::int AS users
    FROM public.user_daily_activity a
    JOIN public.profiles p ON p.id = a.user_id AND p.deleted_at IS NULL
    WHERE a.date >= v_today - (v_days - 1)
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'days', v_days,
    'items', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'date', days.day,
          'registrations', COALESCE(registrations.n, 0),
          'quizAttempts', COALESCE(attempts.n, 0),
          'studySessions', COALESCE(sessions.n, 0),
          'reviews', COALESCE(reviews.n, 0),
          'activeUsers', COALESCE(reviews.users, 0)
        )
        ORDER BY days.day
      ),
      '[]'::jsonb
    )
  )
  INTO result
  FROM days
  LEFT JOIN registrations ON registrations.day = days.day
  LEFT JOIN attempts ON attempts.day = days.day
  LEFT JOIN sessions ON sessions.day = days.day
  LEFT JOIN reviews ON reviews.day = days.day;

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
    );

  RETURN v_count;
END;
$$;

// ==========================================
// get_student_insights (#657, ROADMAP 5C)
// Study time, per-topic mastery and the retention curve of the caller, aggregated in SQL
// (the volume is every review and answer of the window). SECURITY INVOKER: the caller's own
// rows only, RLS stays the floor. Assignment attempts are excluded from mastery because a
// teacher may withhold their results — keyed on the durable `is_assignment_attempt` marker,
// not on `assignment_id`, which becomes NULL when the assignment is deleted.
// ==========================================

CREATE OR REPLACE FUNCTION public.get_student_insights(
  p_user_id uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_days integer := GREATEST(1, LEAST(COALESCE(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
  result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'get_student_insights may only be called for the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  WITH time_rows AS (
    -- Both sources are clamped the same way: the session duration is sent by the client, so an
    -- open tab must not become eight hours of study.
    SELECT
      (fs.completed_at AT TIME ZONE 'UTC')::date AS day,
      GREATEST(0, LEAST(fs.duration_ms::bigint, 7200000)) AS ms
    FROM public.flashcard_study_sessions fs
    WHERE fs.user_id = p_user_id AND fs.completed_at >= v_since
    UNION ALL
    -- A quiz counts from start to finish, capped at two hours: an attempt left open overnight
    -- is not eight hours of study.
    SELECT
      (qa.completed_at AT TIME ZONE 'UTC')::date,
      GREATEST(0, LEAST(EXTRACT(EPOCH FROM (qa.completed_at - qa.started_at)) * 1000, 7200000))::bigint
    FROM public.quiz_attempts qa
    WHERE qa.user_id = p_user_id
      AND qa.completed_at IS NOT NULL
      AND qa.completed_at >= v_since
      AND qa.started_at IS NOT NULL
  ),
  by_day AS (
    SELECT day, SUM(ms)::bigint AS ms FROM time_rows GROUP BY day
  ),
  by_weekday AS (
    SELECT EXTRACT(ISODOW FROM day)::int AS weekday, SUM(ms)::bigint AS ms
    FROM by_day GROUP BY 1
  ),
  study_time AS (
    SELECT jsonb_build_object(
      'totalMs', COALESCE((SELECT SUM(ms) FROM by_day), 0),
      'activeDays', (SELECT COUNT(*) FROM by_day),
      'avgMsPerActiveDay', COALESCE((SELECT ROUND(AVG(ms)) FROM by_day), 0),
      'byDay', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('date', day, 'ms', ms) ORDER BY day) FROM by_day),
        '[]'::jsonb
      ),
      -- index 0 = Monday ... 6 = Sunday
      'byWeekday', (
        SELECT jsonb_agg(COALESCE(w.ms, 0) ORDER BY d.n)
        FROM generate_series(1, 7) AS d(n)
        LEFT JOIN by_weekday w ON w.weekday = d.n
      )
    ) AS data
  ),
  quiz_answers AS (
    SELECT sa.attempt_id, sa.question_id, bool_or(sa.is_correct) AS was_correct
    FROM public.student_answers sa
    JOIN public.quiz_attempts qa ON qa.id = sa.attempt_id
    JOIN public.questions q ON q.id = sa.question_id
    WHERE qa.user_id = p_user_id
      AND qa.completed_at IS NOT NULL
      AND qa.completed_at >= v_since
      -- Durable marker, not `assignment_id`: it becomes NULL when the assignment is deleted.
      AND NOT qa.is_assignment_attempt
      AND q.type <> 'open'
    GROUP BY sa.attempt_id, sa.question_id
  ),
  quiz_by_topic AS (
    SELECT qta.topic_id, COUNT(*)::int AS answers, COUNT(*) FILTER (WHERE qz.was_correct)::int AS correct
    FROM quiz_answers qz
    JOIN public.question_topic_assignments qta ON qta.question_id = qz.question_id
    GROUP BY qta.topic_id
  ),
  card_by_topic AS (
    SELECT fta.topic_id, COUNT(*)::int AS reviews, COUNT(*) FILTER (WHERE fp.was_correct)::int AS correct
    FROM public.flashcard_practice fp
    JOIN public.flashcard_topic_assignments fta ON fta.flashcard_id = fp.flashcard_id
    WHERE fp.user_id = p_user_id AND fp.practiced_at >= v_since
    GROUP BY fta.topic_id
  ),
  topic_ids AS (
    SELECT topic_id FROM quiz_by_topic UNION SELECT topic_id FROM card_by_topic
  ),
  mastery AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'topicId', t.id,
          'name', t.name,
          'quizAnswers', COALESCE(qb.answers, 0),
          'quizAccuracy', CASE WHEN COALESCE(qb.answers, 0) > 0
                               THEN ROUND(qb.correct * 100.0 / qb.answers)::int END,
          'flashcardReviews', COALESCE(cb.reviews, 0),
          'flashcardAccuracy', CASE WHEN COALESCE(cb.reviews, 0) > 0
                                    THEN ROUND(cb.correct * 100.0 / cb.reviews)::int END,
          'accuracy', ROUND(
            (COALESCE(qb.correct, 0) + COALESCE(cb.correct, 0)) * 100.0
              / (COALESCE(qb.answers, 0) + COALESCE(cb.reviews, 0))
          )::int
        )
        ORDER BY (COALESCE(qb.answers, 0) + COALESCE(cb.reviews, 0)) DESC, t.name
      ),
      '[]'::jsonb
    ) AS data
    FROM topic_ids ti
    JOIN public.topics t ON t.id = ti.topic_id
    LEFT JOIN quiz_by_topic qb ON qb.topic_id = ti.topic_id
    LEFT JOIN card_by_topic cb ON cb.topic_id = ti.topic_id
  ),
  gaps AS (
    SELECT
      fp.was_correct,
      fp.practiced_at,
      EXTRACT(EPOCH FROM (
        fp.practiced_at - LAG(fp.practiced_at) OVER (PARTITION BY fp.flashcard_id ORDER BY fp.practiced_at)
      )) / 86400.0 AS gap_days
    FROM public.flashcard_practice fp
    WHERE fp.user_id = p_user_id
  ),
  buckets AS (
    SELECT
      CASE
        WHEN gap_days < 1 THEN 0
        WHEN gap_days < 2 THEN 1
        WHEN gap_days < 4 THEN 2
        WHEN gap_days < 8 THEN 3
        WHEN gap_days < 15 THEN 4
        WHEN gap_days < 31 THEN 5
        ELSE 6
      END AS idx,
      was_correct
    FROM gaps
    WHERE gap_days IS NOT NULL AND practiced_at >= v_since
  ),
  retention AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bucket', b.key,
          'reviews', COALESCE(s.reviews, 0),
          'accuracy', CASE WHEN COALESCE(s.reviews, 0) > 0
                           THEN ROUND(s.correct * 100.0 / s.reviews)::int END
        )
        ORDER BY b.idx
      ),
      '[]'::jsonb
    ) AS data
    FROM (VALUES (0, 'd0'), (1, 'd1'), (2, 'd2_3'), (3, 'd4_7'), (4, 'd8_14'), (5, 'd15_30'), (6, 'd31_plus'))
      AS b(idx, key)
    LEFT JOIN (
      SELECT idx, COUNT(*)::int AS reviews, COUNT(*) FILTER (WHERE was_correct)::int AS correct
      FROM buckets GROUP BY idx
    ) s ON s.idx = b.idx
  )
  SELECT jsonb_build_object(
    'days', v_days,
    'studyTime', (SELECT data FROM study_time),
    'mastery', (SELECT data FROM mastery),
    'retention', (SELECT data FROM retention)
  )
  INTO result;

  RETURN result;
END;
$$;

-- ==========================================
-- get_teacher_problematic_questions (#204, EDU-ST-02)
-- Per-question accuracy for the caller's own questions, aggregated in SQL so
-- the PostgREST 1000-row cap cannot truncate the answer sample. One answer per
-- (attempt, question) via bool_or, matching the submit scoring rule; `open`
-- questions are excluded because an ungraded row is `is_correct = false`.
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_teacher_problematic_questions(
  p_user_id uuid,
  p_organization_id uuid DEFAULT NULL,
  p_bank_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'get_teacher_problematic_questions may only be called for the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  WITH scoped_questions AS (
    SELECT q.id, q.type::text AS type, q.content
    FROM public.questions q
    WHERE q.created_by = p_user_id
      AND (p_organization_id IS NULL OR q.organization_id = p_organization_id)
      AND (p_bank_id IS NULL OR q.bank_id = p_bank_id)
  ),
  visible_students AS (
    SELECT DISTINCT om.user_id
    FROM public.org_members om
    JOIN public.org_roles r ON r.id = om.org_role_id
    WHERE r.name = 'member'
      AND om.organization_id IN (
        SELECT mine.organization_id
        FROM public.org_members mine
        WHERE mine.user_id = p_user_id
          AND (p_organization_id IS NULL OR mine.organization_id = p_organization_id)
      )
  ),
  attempt_answers AS (
    SELECT sa.question_id, sa.attempt_id, bool_or(sa.is_correct) AS was_correct
    FROM public.student_answers sa
    JOIN public.quiz_attempts qa ON qa.id = sa.attempt_id
    JOIN scoped_questions sq ON sq.id = sa.question_id
    WHERE qa.completed_at IS NOT NULL
      AND qa.user_id IS DISTINCT FROM p_user_id
      AND qa.user_id IN (SELECT user_id FROM visible_students)
    GROUP BY sa.question_id, sa.attempt_id
  ),
  answer_stats AS (
    SELECT question_id,
           COUNT(*)::int AS total_answers,
           COUNT(*) FILTER (WHERE was_correct)::int AS correct_answers
    FROM attempt_answers
    GROUP BY question_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sq.id,
        'content', sq.content,
        'type', sq.type,
        'correctRate', ROUND(st.correct_answers::numeric / st.total_answers, 4),
        'totalAnswers', st.total_answers
      )
      ORDER BY st.correct_answers::numeric / st.total_answers ASC, sq.content ASC
    ),
    '[]'::jsonb
  )
  INTO result
  FROM scoped_questions sq
  JOIN answer_stats st ON st.question_id = sq.id
  WHERE sq.type <> 'open'
    AND st.correct_answers::numeric / st.total_answers < 0.5;

  RETURN result;
END;
$$;
