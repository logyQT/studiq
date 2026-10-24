-- ==========================================
-- Function and grant hardening for issue #191 (SEC-13), part 2.
--
-- Part 1 (20261023233122_rls_all_public_tables.sql) enabled RLS everywhere and
-- added the org/owner policies. This migration closes the remaining
-- unauthenticated surface — Postgres FUNCTIONS — and gives `authenticated` only
-- the table/function privileges the web app actually uses.
--
-- Why functions need their own treatment:
--   * Supabase's default privileges grant EXECUTE on new `public` functions to
--     PUBLIC, so every function was callable with the public anon key.
--     `get_teacher_stats` is SECURITY DEFINER and therefore bypasses RLS: an
--     anonymous caller could POST /rest/v1/rpc/get_teacher_stats with a real
--     flashcard id and read another user's practice aggregates.
--   * `20261020000001_revoke_anon_grants.sql` only touched tables/sequences.
--   * `supabase/seeds/99_dev_grants.sql` re-granted everything on every
--     `db reset`, undoing even the explicit revokes in
--     20261020000002_apply_org_plan.sql. The seed is fixed in the same PR.
--
-- The grant matrix below is the contract the seed mirrors:
--   service_role     : EXECUTE on every function (backend + tests + admin)
--   authenticated    : EXECUTE only on the RPCs the web app calls + the RLS
--                      helpers used by the part-1 policies + the three
--                      rls_caller_* role-authority wrappers
--   anon / PUBLIC    : nothing
--
-- `authenticated`'s Supabase default EXECUTE grant is revoked too (not just
-- PUBLIC/anon): leaving it in place would auto-grant every future function to
-- every signed-in user — the same class of bug as #191. Internal helpers
-- (`has_org_feature`, `is_org_manager`, `can_assign_org_role`), `apply_org_plan`,
-- `rls_audit` and `get_accessible_*` stay service-role-only.
-- ==========================================

-- ==========================================
-- 1. get_teacher_stats: SECURITY DEFINER + callable by anon was the remaining
--    unauthenticated data leak. Guard the caller and intersect the requested
--    cards with the caller's own/visible cards.
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
-- 2. Function grants.
-- ==========================================
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Future functions must not be executable by PUBLIC/anon/authenticated either
-- (Supabase's default privileges grant EXECUTE to PUBLIC on functions created by
-- postgres, which also reaches `authenticated`).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

-- Backend, admin app, seeds and integration tests.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Service-role-only functions: repeat explicitly (they may have been granted to
-- authenticated by an older migration or the dev seed).
REVOKE ALL ON FUNCTION public.apply_org_plan(uuid, text) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.get_accessible_flashcard_decks(uuid, uuid, uuid) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.get_accessible_flashcards(uuid, uuid, uuid[], uuid[], uuid, uuid) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.get_accessible_question_banks(uuid, uuid, uuid) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.get_accessible_questions(uuid, uuid, text, uuid, uuid[], uuid[], text) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.get_accessible_topics(uuid, uuid, uuid) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.has_org_feature(uuid, uuid, text) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.is_org_manager(uuid, uuid) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.can_assign_org_role(uuid, uuid) FROM authenticated, anon;

-- The RPCs the web app calls through the user-session client, plus the RLS
-- helpers and role-authority wrappers used inside the part-1 policies.
GRANT EXECUTE ON FUNCTION public.bulk_create_flashcards(jsonb, uuid, uuid, text, uuid[], uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_new_cards(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_breakdown(uuid, uuid, uuid, uuid[], uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_flashcards(uuid, text, uuid, integer, uuid[], uuid[], integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_practice_state_breakdown(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_stats(uuid[], uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_group_ids(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_flashcards(text, integer, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_caller_org_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_caller_org_user_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_caller_has_org_feature(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_caller_is_org_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_caller_can_assign_org_role(uuid) TO authenticated;

-- ==========================================
-- 3. Table grants.
--
-- `authenticated` keeps SELECT/INSERT/UPDATE/DELETE on the operational tables
-- (RLS is the floor now), but loses destructive maintenance privileges and write
-- access to the read-only catalogs. Rows on those catalogs are written by the
-- admin app (service role) and seeds (postgres) only.
-- ==========================================
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated, anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.subscription_plans,
     public.plan_features,
     public.plan_limits,
     public.feature_flags,
     public.permissions,
     public.resource_permissions,
     public.user_feature_overrides,
     public.profiles
  FROM authenticated;

-- Defensive repeat of 20261020000001: anon must never hold table privileges.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

GRANT SELECT ON public.subscription_plans TO anon;
GRANT SELECT ON public.plan_features TO anon;
GRANT SELECT ON public.plan_limits TO anon;

-- ==========================================
-- 4. CI/ops guard: a callable audit of the invariants above.
--
-- Integration tests call it through the service-role client (see
-- __tests__/integration/rls-tenant-isolation.test.ts); operators can call it
-- after a hosted deploy to verify the same state remotely.
-- ==========================================
CREATE OR REPLACE FUNCTION public.rls_audit()
RETURNS TABLE(
  table_name text,
  rls_enabled boolean,
  anon_select boolean,
  anon_insert boolean,
  authenticated_update boolean,
  authenticated_truncate boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT
    c.relname::text,
    c.relrowsecurity,
    has_table_privilege('anon', c.oid, 'SELECT'),
    has_table_privilege('anon', c.oid, 'INSERT'),
    has_table_privilege('authenticated', c.oid, 'UPDATE'),
    has_table_privilege('authenticated', c.oid, 'TRUNCATE')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ORDER BY c.relname;
$$;

REVOKE ALL ON FUNCTION public.rls_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_audit() TO service_role;

-- ==========================================
-- 5. Fail closed at deploy time:
--      * no table without RLS (global — fail safe),
--      * no anon write anywhere, anon SELECT only on the public pricing tables
--        (scoped to non-extension objects so a hosted project with e.g. PostGIS
--        `spatial_ref_sys` in `public` does not abort the deploy),
--      * no anon EXECUTE on any public function,
--      * no authenticated EXECUTE on an internal helper / service-role RPC.
-- ==========================================
DO $$
DECLARE
  bad_rls text;
  bad_anon text;
  bad_anon_fn text;
  bad_auth_fn text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
  INTO bad_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity = false;

  IF bad_rls IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is disabled on public table(s): %', bad_rls;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
  INTO bad_anon
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.oid NOT IN (SELECT d.objid FROM pg_depend d WHERE d.deptype = 'e')
    AND (
      has_table_privilege('anon', c.oid, 'INSERT')
      OR has_table_privilege('anon', c.oid, 'UPDATE')
      OR has_table_privilege('anon', c.oid, 'DELETE')
      OR has_table_privilege('anon', c.oid, 'TRUNCATE')
      OR (
        has_table_privilege('anon', c.oid, 'SELECT')
        AND c.relname NOT IN ('subscription_plans', 'plan_features', 'plan_limits')
      )
    );

  IF bad_anon IS NOT NULL THEN
    RAISE EXCEPTION 'anon still holds privileges on public table(s): %', bad_anon;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
  INTO bad_anon_fn
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF bad_anon_fn IS NOT NULL THEN
    RAISE EXCEPTION 'anon can still EXECUTE public function(s): %', bad_anon_fn;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
  INTO bad_auth_fn
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'apply_org_plan',
      'rls_audit',
      'has_org_feature',
      'is_org_manager',
      'can_assign_org_role'
    )
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF bad_auth_fn IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated can EXECUTE internal function(s): %', bad_auth_fn;
  END IF;
END;
$$;

-- PostgREST caches the schema and its privileges.
NOTIFY pgrst, 'reload schema';
