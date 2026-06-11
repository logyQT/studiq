-- ==========================================
-- FUNCTION: get_teacher_stats
-- Aggregates teacher dashboard stats server-side
-- to avoid 1000-row Supabase SELECT limits.
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
  -- Deck filter: narrow to cards in the selected deck
  IF p_deck_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT fda.flashcard_id)
    INTO v_flashcard_ids
    FROM public.flashcard_deck_assignments fda
    WHERE fda.flashcard_id = ANY(p_flashcard_ids)
      AND fda.deck_id = p_deck_id;
  ELSE
    v_flashcard_ids := p_flashcard_ids;
  END IF;

  -- Early return if no cards match
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
    -- Teacher's decks
    decks AS (
      SELECT id, name FROM public.flashcard_decks WHERE created_by = p_user_id
    ),
    -- Card-to-deck mappings
    deck_assignments AS (
      SELECT flashcard_id, deck_id
      FROM public.flashcard_deck_assignments
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    -- Card-to-topic mappings
    topic_assignments AS (
      SELECT flashcard_id, topic_id
      FROM public.flashcard_topic_assignments
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    -- Topics
    topics AS (
      SELECT id, name FROM public.flashcard_topics
      WHERE id IN (SELECT DISTINCT topic_id FROM topic_assignments)
    ),
    -- Practice rows
    practices AS (
      SELECT flashcard_id, was_correct, user_id
      FROM public.flashcard_practice
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    -- Review states
    review_states AS (
      SELECT flashcard_id, easiness_factor
      FROM public.flashcard_review_state
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    -- Summary
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
    -- Deck-level stats
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
    -- Topic-level stats
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
    -- Difficulty breakdown (majority vote per card across students)
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
