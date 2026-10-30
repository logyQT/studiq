-- ==========================================
-- Student statistics: study time, topic mastery, retention curve (#657, ROADMAP 5C)
--
-- One aggregate for the three new blocks of /app/stats, in SQL because the volume is every
-- review and answer of a window (PostgREST would cut the rows at 1000, same reason as #204).
--
--   * studyTime: time spent in flashcard sessions and quizzes, total, per active day and per
--     weekday (UTC dates, like the rest of the activity stats).
--   * mastery: per topic, the accuracy of the student's quiz answers and flashcard reviews.
--     Assignment attempts are left out on purpose: a teacher may withhold their results
--     (`show_results = false`) and a per-topic accuracy would leak them. The durable marker
--     `quiz_attempts.is_assignment_attempt` is used, not `assignment_id`, which becomes NULL
--     when the assignment is deleted. Open questions are left out too: an ungraded free-text
--     answer is `is_correct = false`.
--   * retention: how often a flashcard is answered correctly as a function of the time since
--     it was last reviewed (0 days, 1, 2-3, 4-7, 8-14, 15-30, 31+).
--
-- SECURITY INVOKER: only the caller's own rows, RLS stays the floor. The function refuses to
-- run for another user.
-- ==========================================

-- The durable assignment marker the mastery block filters on. `quiz_attempts.assignment_id` is
-- `ON DELETE SET NULL`, so deleting an assignment would otherwise turn its finished attempts
-- into practice quizzes; the marker is written once, when the attempt is created, and survives
-- the deletion. It is added here, before the function that reads it, so a live `db push` never
-- exposes a function that references a column the table does not have yet.
ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS is_assignment_attempt boolean NOT NULL DEFAULT false;

-- Best effort for rows created before the marker: attempts whose assignment still exists keep
-- their provenance. An attempt whose assignment was already deleted cannot be recovered.
UPDATE public.quiz_attempts
SET is_assignment_attempt = true
WHERE assignment_id IS NOT NULL;

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

REVOKE ALL ON FUNCTION public.get_student_insights(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_insights(uuid, integer)
  TO authenticated, service_role;
