-- ==========================================
-- Admin dashboard: global statistics and daily activity (#663, ROADMAP 7A)
--
-- Two aggregates for the admin app (`apps/admin`), which talks to the database with the
-- service role. They read across every tenant on purpose, so they are callable by the service
-- role only: no `authenticated` or `anon` user, and no teacher or manager, can reach them.
--
--   * admin_platform_stats(): users (live and in the 30-day trash), organizations, groups,
--     content counts, activity in the last 7 / 30 days and storage used.
--   * admin_daily_stats(days): per UTC day, new accounts, finished quizzes, flashcard study
--     sessions and flashcard reviews, with every day of the window present (zeros included).
--
-- Definitions, used identically by the cards and the daily series:
--   * active user: a live account (not in the trash) with a flashcard review or a quiz recorded
--     in `user_daily_activity` that day; signing in alone, or only spending AI tokens, does not
--     count.
--   * new account: a live account created on a UTC day inside the window (the last N days
--     counting today, like the daily series).
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

-- The aggregates filter on these columns on every page load.
CREATE INDEX IF NOT EXISTS idx_user_daily_activity_date ON public.user_daily_activity(date);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_completed_at
  ON public.quiz_attempts(completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flashcard_study_sessions_completed_at
  ON public.flashcard_study_sessions(completed_at);

REVOKE ALL ON FUNCTION public.admin_platform_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_platform_stats() TO service_role;

REVOKE ALL ON FUNCTION public.admin_daily_stats(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_daily_stats(integer) TO service_role;
