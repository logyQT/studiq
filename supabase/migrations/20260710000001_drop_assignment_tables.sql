-- ==========================================
-- Migration: 20260710000001
-- Description: Replace M:N join tables with direct FK columns
--   - Adds bank_id FK on questions
--   - Adds deck_id FK on flashcards
--   - Migrates data from assignment tables
--   - Drops question_bank_assignments
--   - Drops flashcard_deck_assignments
--   - Removes orphan triggers
--   - Rewrites all RPCs to use direct FKs
-- ==========================================

-- ==========================================
-- STEP 1: Add bank_id to questions
-- ==========================================
ALTER TABLE public.questions
  ADD COLUMN bank_id uuid REFERENCES public.question_banks(id) ON DELETE SET NULL;

CREATE INDEX idx_questions_bank_id ON public.questions(bank_id);

-- Migrate existing data from question_bank_assignments
-- (Each question was in at most one bank in practice; if a question was in
--  multiple banks, we keep the first one by insertion order.)
UPDATE public.questions q
SET bank_id = sub.bank_id
FROM (
  SELECT DISTINCT ON (question_id) question_id, bank_id
  FROM public.question_bank_assignments
  ORDER BY question_id, bank_id
) sub
WHERE q.id = sub.question_id;

-- ==========================================
-- STEP 2: Add deck_id to flashcards
-- ==========================================
ALTER TABLE public.flashcards
  ADD COLUMN deck_id uuid REFERENCES public.flashcard_decks(id) ON DELETE SET NULL;

CREATE INDEX idx_flashcards_deck_id ON public.flashcards(deck_id);

-- Migrate existing data from flashcard_deck_assignments
-- (Each flashcard was in at most one deck in practice; if a flashcard was in
--  multiple decks, we keep the first one by insertion order.)
UPDATE public.flashcards f
SET deck_id = sub.deck_id
FROM (
  SELECT DISTINCT ON (flashcard_id) flashcard_id, deck_id
  FROM public.flashcard_deck_assignments
  ORDER BY flashcard_id, deck_id
) sub
WHERE f.id = sub.flashcard_id;

-- ==========================================
-- STEP 3: Remove triggers on flashcard_deck_assignments
-- ==========================================

-- Drop the orphan cleanup trigger and function
DROP TRIGGER IF EXISTS trg_flashcard_deck_assignments_cleanup ON public.flashcard_deck_assignments;
DROP FUNCTION IF EXISTS public.cleanup_orphan_flashcards();

-- Drop the deck updated_at trigger on assignments
DROP TRIGGER IF EXISTS trg_deck_updated_at_on_assignment ON public.flashcard_deck_assignments;
DROP FUNCTION IF EXISTS public.update_deck_updated_at_on_assignment();

-- ==========================================
-- STEP 4: Rewrite update_deck_updated_at_on_flashcard_change to use direct deck_id
-- ==========================================
CREATE OR REPLACE FUNCTION public.update_deck_updated_at_on_flashcard_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deck_id IS NOT NULL THEN
    UPDATE public.flashcard_decks
    SET updated_at = now()
    WHERE id = NEW.deck_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger on flashcards.deck_id change
DROP TRIGGER IF EXISTS trg_deck_updated_at_on_flashcard_change ON public.flashcards;
CREATE TRIGGER trg_deck_updated_at_on_flashcard_change
  AFTER UPDATE ON public.flashcards
  FOR EACH ROW
  WHEN (OLD.front IS DISTINCT FROM NEW.front
    OR OLD.back IS DISTINCT FROM NEW.back
    OR OLD.deck_id IS DISTINCT FROM NEW.deck_id)
  EXECUTE FUNCTION public.update_deck_updated_at_on_flashcard_change();

-- ==========================================
-- STEP 5: Drop the assignment tables
-- ==========================================

DROP TABLE IF EXISTS public.question_bank_assignments CASCADE;
DROP TABLE IF EXISTS public.flashcard_deck_assignments CASCADE;

-- ==========================================
-- STEP 6: Update get_accessible_flashcard_decks to use direct FK count
-- ==========================================
DROP FUNCTION IF EXISTS public.get_accessible_flashcard_decks(uuid, uuid);
CREATE FUNCTION public.get_accessible_flashcard_decks(p_user_id uuid, p_org_id uuid)
RETURNS TABLE(
  id uuid, organization_id uuid, created_by uuid, name text, description text,
  visibility visibility_type, search_vector tsvector, created_at timestamptz,
  updated_at timestamptz, flashcard_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT d.id, d.organization_id, d.created_by, d.name, d.description,
    d.visibility, d.search_vector, d.created_at, d.updated_at,
    (SELECT COUNT(*) FROM public.flashcards WHERE deck_id = d.id) AS flashcard_count
  FROM public.flashcard_decks d
  LEFT JOIN public.deck_groups dg ON dg.deck_id = d.id
  LEFT JOIN public.group_members gm ON gm.group_id = dg.group_id AND gm.user_id = p_user_id
  WHERE d.organization_id = p_org_id
    AND (
      (d.visibility = 'personal' AND d.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;

-- ==========================================
-- STEP 7: Update get_accessible_flashcards to use direct FK
-- ==========================================
DROP FUNCTION IF EXISTS public.get_accessible_flashcards(uuid, uuid);
CREATE FUNCTION public.get_accessible_flashcards(p_user_id uuid, p_org_id uuid)
RETURNS SETOF public.flashcards LANGUAGE sql STABLE AS $$
  SELECT DISTINCT f.*
  FROM public.flashcards f
  LEFT JOIN public.deck_groups dg ON dg.deck_id = f.deck_id
  LEFT JOIN public.group_members gm ON gm.group_id = dg.group_id AND gm.user_id = p_user_id
  WHERE f.organization_id = p_org_id
    AND (
      (f.visibility = 'personal' AND f.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;

-- ==========================================
-- STEP 8: Update get_accessible_question_banks to use direct FK count
-- ==========================================
DROP FUNCTION IF EXISTS public.get_accessible_question_banks(uuid, uuid);
CREATE FUNCTION public.get_accessible_question_banks(p_user_id uuid, p_org_id uuid)
RETURNS TABLE(
  id uuid, organization_id uuid, created_by uuid, name text, description text,
  visibility visibility_type, search_vector tsvector, created_at timestamptz,
  updated_at timestamptz, question_count bigint
) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT b.id, b.organization_id, b.created_by, b.name, b.description,
    b.visibility, b.search_vector, b.created_at, b.updated_at,
    (SELECT COUNT(*) FROM public.questions WHERE bank_id = b.id) AS question_count
  FROM public.question_banks b
  LEFT JOIN public.bank_groups bg ON bg.bank_id = b.id
  LEFT JOIN public.group_members gm ON gm.group_id = bg.group_id AND gm.user_id = p_user_id
  WHERE b.organization_id = p_org_id
    AND (
      (b.visibility = 'personal' AND b.created_by = p_user_id)
      OR
      gm.id IS NOT NULL
    );
$$;

-- ==========================================
-- STEP 9: Update get_accessible_questions to use direct FK
-- ==========================================
DROP FUNCTION IF EXISTS public.get_accessible_questions(uuid, uuid, text, uuid, uuid[], uuid[], text);
CREATE FUNCTION public.get_accessible_questions(
  p_user_id uuid,
  p_org_id uuid DEFAULT NULL,
  p_scope text DEFAULT 'own',
  p_question_id uuid DEFAULT NULL,
  p_bank_ids uuid[] DEFAULT NULL,
  p_topic_ids uuid[] DEFAULT NULL,
  p_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid, organization_id uuid, created_by uuid,
  type text, content text, explanation text,
  visibility visibility_type, search_vector tsvector,
  created_at timestamptz, updated_at timestamptz,
  question_answers jsonb
)
LANGUAGE sql STABLE AS $$
  WITH accessible AS (
    SELECT DISTINCT q.*
    FROM public.questions q
    LEFT JOIN public.question_topic_assignments qta ON qta.question_id = q.id
    LEFT JOIN public.bank_groups bg ON bg.bank_id = q.bank_id
    LEFT JOIN public.topic_groups tg ON tg.topic_id = qta.topic_id
    LEFT JOIN public.group_members gm ON gm.group_id = bg.group_id AND gm.user_id = p_user_id
    WHERE (p_org_id IS NULL OR q.organization_id = p_org_id)
      AND (
        CASE p_scope
          WHEN 'own'   THEN q.created_by = p_user_id
          WHEN 'group' THEN (q.created_by = p_user_id) OR gm.id IS NOT NULL
          ELSE TRUE
        END
      )
      AND (p_bank_ids IS NULL   OR q.bank_id = ANY(p_bank_ids))
      AND (p_topic_ids IS NULL  OR qta.topic_id = ANY(p_topic_ids))
      AND (p_question_id IS NULL OR q.id = p_question_id)
      AND (p_type IS NULL        OR q.type::text = p_type)
  )
  SELECT a.id, a.organization_id, a.created_by, a.type::text, a.content, a.explanation,
         a.visibility, a.search_vector, a.created_at, a.updated_at,
         CASE WHEN p_question_id IS NOT NULL THEN (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', qa.id,
               'question_id', qa.question_id,
               'content', qa.content,
               'is_correct', qa.is_correct,
               'order_index', qa.order_index
             ) ORDER BY qa.order_index
           )
           FROM public.question_answers qa
           WHERE qa.question_id = a.id
         ) ELSE NULL END AS question_answers
  FROM accessible a
  ORDER BY a.created_at DESC;
$$;

-- ==========================================
-- STEP 10: Update get_due_flashcards to use direct FK
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
        WHEN 'own' THEN f.created_by = p_user_id AND f.organization_id = p_organization_id
        WHEN 'university' THEN f.organization_id = p_organization_id AND f.visibility = 'group'
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
-- STEP 11: Update get_due_breakdown to use direct FK
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
      OR (p_created_by IS NULL AND p_organization_id IS NOT NULL AND f.organization_id = p_organization_id AND f.visibility = 'group')
      OR (p_created_by IS NOT NULL AND p_organization_id IS NULL AND f.created_by = p_created_by AND f.organization_id = p_organization_id)
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
    OR (p_created_by IS NULL AND p_organization_id IS NOT NULL AND f.organization_id = p_organization_id AND f.visibility = 'group')
    OR (p_created_by IS NOT NULL AND p_organization_id IS NULL AND f.created_by = p_created_by AND f.organization_id = p_organization_id) )
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
-- STEP 12: Update get_practice_state_breakdown to use direct FK + suspended_decks
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
    WHERE f.organization_id = p_organization_id AND f.visibility = 'group'
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
    WHERE f.organization_id = p_organization_id AND f.visibility = 'group'
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

-- ==========================================
-- STEP 13: Update search_flashcards to use direct FK
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
-- STEP 14: Update count_new_cards to use direct FK + suspended_decks
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
      WHEN 'own' THEN f.created_by = p_user_id AND f.organization_id = p_organization_id
      WHEN 'university' THEN f.organization_id = p_organization_id AND f.visibility = 'group'
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

-- ==========================================
-- STEP 15: Update get_teacher_stats to use direct FK
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
    SELECT ARRAY_AGG(DISTINCT f.id)
    INTO v_flashcard_ids
    FROM public.flashcards f
    WHERE f.id = ANY(p_flashcard_ids)
      AND f.deck_id = p_deck_id;
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
      SELECT f.id AS flashcard_id, f.deck_id
      FROM public.flashcards f
      WHERE f.id = ANY(v_flashcard_ids) AND f.deck_id IS NOT NULL
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
-- STEP 16: Drop indexes on removed tables
-- ==========================================
DROP INDEX IF EXISTS public.idx_fda_deck_flashcard;
DROP INDEX IF EXISTS public.idx_question_bank_assignments_bank;
DROP INDEX IF EXISTS public.idx_qba_bank_question;
DROP INDEX IF EXISTS public.idx_flashcard_deck_assignments_deck;

-- ==========================================
-- STEP 17: Update bulk_create_flashcards RPC to use direct deck_id
-- ==========================================
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
  -- Use the first deck_id if provided (1:N means a flashcard can only belong to one deck)
  IF array_length(p_deck_ids, 1) > 0 THEN
    v_deck_id := p_deck_ids[1];
  END IF;

  -- Step 1: Insert all flashcards with direct deck_id
  WITH ins AS (
    INSERT INTO flashcards (front, back, created_by, organization_id, visibility, deck_id)
    SELECT
      c->>'front',
      c->>'back',
      p_user_id,
      p_organization_id,
      p_visibility,
      v_deck_id
    FROM jsonb_array_elements(p_cards) AS c
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM ins;

  -- Step 2: Topic assignments (if any)
  IF array_length(p_topic_ids, 1) > 0 THEN
    INSERT INTO flashcard_topic_assignments (flashcard_id, topic_id)
    SELECT id, unnest(p_topic_ids) FROM unnest(v_ids) AS id;
  END IF;

  -- Return created flashcards
  RETURN QUERY SELECT * FROM flashcards WHERE id = ANY(v_ids);
END;
$$ LANGUAGE plpgsql;
