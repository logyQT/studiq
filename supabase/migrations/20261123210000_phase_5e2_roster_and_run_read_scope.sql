-- Phase 5e-2 of the role-authority programme (ADR-0015 §7.1; 2b-9 deferral
-- register row 10 in docs/plans/role-authority-plan.md — the 5e-2 census is
-- in the same file; row 3 stays with phase 6 and is untouched here;
-- decisions D-5e2-1, D-5e2-2, D-5e2-3; R4, R19, R26, R27, R40).
--
-- Row 10 narrows the two reads that are wider than their gate. The reader
-- census (31 org_members sites, 31 teacher_assignments sites in packages +
-- apps, every row re-derived by command) proved which key authorises each
-- reader family; the union below is that census, not D25's four.
--
-- D-5e2-1 — org_members SELECT is a capability union, not the D25 four:
--   self row (user_id = auth.uid(), with-auth/entitlement resolver/
--   listMyOrgs/listMyGroups/listForStudent/assignment-access/invite
--   resolve all read the caller's own row), or a same-org row when the
--   caller covers one of the nine keys that gate exactly one reader family:
--   the D25 roster four (org.member.manage | group.manage | group.invite |
--   org.seat.manage — GET /organization/members), group.member.manage
--   (listAddableMembers), org.role.manage (the role-count embeds and
--   deleteRole's count), assignment.create / assignment.update (the
--   setTargets target picker), stats.read at group+ (the teacher stats and
--   activity cards). covers_permission(...,'own') carries D21's org.admin
--   arm, so the owner needs no separate conjunct; org.admin is not
--   assignable (D16), so the union cannot be self-granted. The system
--   Member holds none of the nine (stats.read only at own, content keys at
--   own/group — none of the nine keys), so a learner reads only their own
--   row. The one reader with no key at all (the ownerless-group report
--   recipient, question-report.service.ts:117) moves to the
--   org_report_recipient RPC below — the reader is fixed, not the policy.
--
-- D-5e2-2 — teacher_assignments SELECT reuses 5e-1's shipped helper
--   (rls_caller_can_read_assignment_targets: author OR targeted student or
--   group member OR rls_caller_has_permission(org,'assignment.read'), the
--   any-scope arm recorded as 5e-1's shipped semantics). One rule for
--   "may read this run" (R40): the parent row and its target list stay
--   consistent. A plain learner sees only runs that target them; the
--   null-org (personal) run stays invisible to PostgREST exactly as today —
--   the floor is not widened.
--
-- D-5e2-3 — the two teacher-dashboard RPCs get the capability, not a persona
--   branch (R43): the JWT account_type wall in get_teacher_group_performance
--   and get_teacher_activity_feed is replaced by
--   rls_caller_covers_permission(p_organization_id, 'stats.read', 'group').
--   5d already gates both endpoints on the stats.insights entitlement at
--   the controller, so the RPC wall is the one authority rule, not defence
--   in depth. The identity check (p_user_id IS DISTINCT FROM auth.uid() ->
--   42501) and the org-membership check stay; a system Member (stats.read at
--   own only) still gets the empty payload.
--
-- Deliberately NOT moved here: the 5e-1 objects (rls_caller_is_sealed_item,
-- the exposure_events and quiz_attempts policies — their file stays their
-- owner; this file only pins the 5e-1 carry-over guard below), all write
-- policies on both tables (INSERT/UPDATE/DELETE clauses unchanged — R25),
-- row 3 (personal-scope permissions, phase 6), route/controller gates and
-- UI.
--
-- Re-runnable: ALTER POLICY / CREATE OR REPLACE plus a guarded DO block —
-- a db reset and a hand re-apply end in the same state (R19). R27: this
-- file is now the newest owner of both SELECT policies and both RPCs, so
-- the replay lists move here.

-- ==========================================
-- 1. org_members SELECT: self row or the nine-key capability union (D-5e2-1).
--    ALTER POLICY, never drop/recreate: the policy name and its other
--    clauses (the UPDATE/DELETE policies below it) stay.
-- ==========================================
ALTER POLICY "Own or same-org membership read" ON public.org_members
  USING (
    user_id = auth.uid()
    OR (
      organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
      AND (
        public.rls_caller_covers_permission(organization_id, 'org.member.manage', 'own')
        OR public.rls_caller_covers_permission(organization_id, 'group.manage', 'own')
        OR public.rls_caller_covers_permission(organization_id, 'group.invite', 'own')
        OR public.rls_caller_covers_permission(organization_id, 'org.seat.manage', 'own')
        OR public.rls_caller_covers_permission(organization_id, 'group.member.manage', 'own')
        OR public.rls_caller_covers_permission(organization_id, 'org.role.manage', 'own')
        OR public.rls_caller_covers_permission(organization_id, 'assignment.create', 'own')
        OR public.rls_caller_covers_permission(organization_id, 'assignment.update', 'own')
        OR public.rls_caller_covers_permission(organization_id, 'stats.read', 'group')
      )
    )
  );

-- ==========================================
-- 2. teacher_assignments SELECT: one rule for "may read this run" —
--    5e-1's shipped cohort helper (D-5e2-2, R40). No second rule is forked.
-- ==========================================
ALTER POLICY "Visible teacher assignments" ON public.teacher_assignments
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_can_read_assignment_targets(id)
  );

-- ==========================================
-- 3. The teacher-dashboard RPCs: capability, not persona (D-5e2-3, R43).
--    Full bodies re-created from 20261028100100 (their newest owner) with
--    only the persona branch replaced; grants restated (R19).
-- ==========================================

CREATE OR REPLACE FUNCTION public.get_teacher_group_performance(
  p_user_id uuid,
  p_organization_id uuid,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
  v_since timestamptz := now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 30), 365)));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'get_teacher_group_performance may only be called for the authenticated user'
        USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL
       OR p_organization_id NOT IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c) THEN
      RETURN '{"groups": [], "totals": {"students": 0, "completedAttempts": 0, "awaitingGrade": 0}}'::jsonb;
    END IF;

    -- D-5e2-3 (R43): the dashboard is a capability, not a persona. The JWT
    -- persona branch is replaced by stats.read at a staff scope; 5d
    -- already gates both endpoints on the stats.insights entitlement at the
    -- controller, so this wall is the one authority rule, not a second one.
    IF NOT public.rls_caller_covers_permission(p_organization_id, 'stats.read', 'group') THEN
      RETURN '{"groups": [], "totals": {"students": 0, "completedAttempts": 0, "awaitingGrade": 0}}'::jsonb;
    END IF;
  END IF;

  IF p_organization_id IS NULL THEN
    RETURN '{"groups": [], "totals": {"students": 0, "completedAttempts": 0, "awaitingGrade": 0}}'::jsonb;
  END IF;

  WITH my_groups AS (
    SELECT g.id, g.name
    FROM public.groups g
    WHERE g.organization_id = p_organization_id
      AND EXISTS (
        SELECT 1 FROM public.group_members me
        WHERE me.group_id = g.id AND me.user_id = p_user_id
      )
  ),
  learners AS (
    SELECT DISTINCT mg.id AS group_id, gm.user_id
    FROM my_groups mg
    JOIN public.group_members gm ON gm.group_id = mg.id
    WHERE gm.role = 'member'
      AND gm.user_id <> p_user_id
  ),
  learner_set AS (
    SELECT DISTINCT user_id FROM learners
  ),
  learner_counts AS (
    SELECT group_id, COUNT(*)::int AS students
    FROM learners
    GROUP BY group_id
  ),
  -- One row per completed attempt of this organization, however many groups its learner is in.
  attempt_rows AS (
    SELECT
      qa.id,
      qa.user_id,
      -- Assignment attempts score in awarded points, practice quizzes in correct answers:
      -- every attempt is normalised to its own scale before averaging (see stats.service).
      LEAST(100, GREATEST(0,
        COALESCE(qa.score, 0) * 100.0
          / GREATEST(COALESCE(qa.total_points, qa.total_questions, 0), 1)
      )) AS pct,
      -- `assignment_id` is ON DELETE SET NULL and a client can clear it; the durable marker
      -- `is_assignment_attempt` (trigger-preserved, #657) is what says this was an assignment.
      (
        qa.is_assignment_attempt
        AND qa.graded_at IS NULL
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.student_answers sa WHERE sa.attempt_id = qa.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.student_answers sa
            LEFT JOIN public.questions q ON q.id = sa.question_id
            WHERE sa.attempt_id = qa.id
              AND COALESCE(
                sa.question_type::text,
                q.type::text,
                CASE WHEN sa.text_answer IS NOT NULL THEN 'open' END
              ) = 'open'
          )
          OR EXISTS (
            SELECT 1
            FROM public.assignment_questions aq
            JOIN public.questions q ON q.id = aq.question_id
            JOIN public.teacher_assignments assignment_org ON assignment_org.id = aq.assignment_id
            WHERE aq.assignment_id = qa.assignment_id
              AND assignment_org.organization_id = p_organization_id
              AND q.type = 'open'
          )
        )
      ) AS awaiting
    FROM learner_set ls
    JOIN public.quiz_attempts qa ON qa.user_id = ls.user_id
    WHERE qa.organization_id = p_organization_id
      AND qa.completed_at IS NOT NULL
      AND qa.completed_at >= v_since
  ),
  attempt_stats AS (
    SELECT
      l.group_id,
      COUNT(*)::int AS completed,
      COUNT(*) FILTER (WHERE ar.awaiting)::int AS awaiting,
      ROUND(AVG(ar.pct) FILTER (WHERE NOT ar.awaiting))::int AS avg_pct
    FROM learners l
    JOIN attempt_rows ar ON ar.user_id = l.user_id
    GROUP BY l.group_id
  ),
  review_rows AS (
    SELECT fp.user_id, fp.was_correct
    FROM learner_set ls
    JOIN public.flashcard_practice fp ON fp.user_id = ls.user_id
    WHERE fp.organization_id = p_organization_id
      AND fp.practiced_at >= v_since
  ),
  review_stats AS (
    SELECT
      l.group_id,
      COUNT(*)::int AS reviews,
      ROUND(COUNT(*) FILTER (WHERE rr.was_correct) * 100.0 / COUNT(*))::int AS accuracy
    FROM learners l
    JOIN review_rows rr ON rr.user_id = l.user_id
    GROUP BY l.group_id
  ),
  group_rows AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'groupId', mg.id,
          'groupName', mg.name,
          'students', COALESCE(lc.students, 0),
          'completedAttempts', COALESCE(ast.completed, 0),
          'awaitingGrade', COALESCE(ast.awaiting, 0),
          -- NULL (not 0) when nothing was graded: "no data" is not "0 %".
          'avgScore', ast.avg_pct,
          'flashcardReviews', COALESCE(rs.reviews, 0),
          'flashcardAccuracy', rs.accuracy
        )
        ORDER BY mg.name
      ),
      '[]'::jsonb
    ) AS data
    FROM my_groups mg
    LEFT JOIN learner_counts lc ON lc.group_id = mg.id
    LEFT JOIN attempt_stats ast ON ast.group_id = mg.id
    LEFT JOIN review_stats rs ON rs.group_id = mg.id
  )
  SELECT jsonb_build_object(
    'groups', (SELECT data FROM group_rows),
    'totals', jsonb_build_object(
      'students', (SELECT COUNT(*) FROM learner_set),
      'completedAttempts', (SELECT COUNT(*) FROM attempt_rows),
      'awaitingGrade', (SELECT COUNT(*) FROM attempt_rows WHERE awaiting)
    )
  )
  INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_teacher_activity_feed(
  p_user_id uuid,
  p_organization_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'get_teacher_activity_feed may only be called for the authenticated user'
        USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL
       OR p_organization_id NOT IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c) THEN
      RETURN '[]'::jsonb;
    END IF;

    -- D-5e2-3 (R43): the dashboard is a capability, not a persona. The JWT
    -- persona branch is replaced by stats.read at a staff scope; 5d
    -- already gates both endpoints on the stats.insights entitlement at the
    -- controller, so this wall is the one authority rule, not a second one.
    IF NOT public.rls_caller_covers_permission(p_organization_id, 'stats.read', 'group') THEN
      RETURN '[]'::jsonb;
    END IF;
  END IF;

  IF p_organization_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH learners AS (
    SELECT DISTINCT gm.user_id
    FROM public.groups g
    JOIN public.group_members gm ON gm.group_id = g.id
    WHERE g.organization_id = p_organization_id
      AND gm.role = 'member'
      AND gm.user_id <> p_user_id
      AND EXISTS (
        SELECT 1 FROM public.group_members me
        WHERE me.group_id = g.id AND me.user_id = p_user_id
      )
  ),
  events AS (
    (
      SELECT
        -- The durable marker, not `assignment_id` (nullable, client-clearable) says what this was:
        -- `is_assignment_attempt` is preserved by its trigger (#657).
        CASE WHEN qa.is_assignment_attempt THEN 'assignment_submitted' ELSE 'quiz_completed' END AS kind,
        qa.completed_at AS at,
        qa.user_id AS person_id,
        -- The id and the title come from the assignment ONLY when it belongs to this organization:
        -- the stamp of the attempt alone must never surface a foreign assignment.
        ta.id AS assignment_id,
        -- A practice quiz keeps no title of its own (its config is the generator request): name it
        -- after its bank. NULL when there is nothing to show; the UI then drops the quoted title.
        COALESCE(ta.title, qa.config->>'title', qb.name) AS title,
        LEAST(100, GREATEST(0,
          COALESCE(qa.score, 0) * 100.0
            / GREATEST(COALESCE(qa.total_points, qa.total_questions, 0), 1)
        ))::int AS score_pct,
        (
          qa.is_assignment_attempt
          AND qa.graded_at IS NULL
          AND (
            NOT EXISTS (
              SELECT 1 FROM public.student_answers sa WHERE sa.attempt_id = qa.id
            )
            OR EXISTS (
              SELECT 1
              FROM public.student_answers sa
              LEFT JOIN public.questions q ON q.id = sa.question_id
              WHERE sa.attempt_id = qa.id
                AND COALESCE(
                  sa.question_type::text,
                  q.type::text,
                  CASE WHEN sa.text_answer IS NOT NULL THEN 'open' END
                ) = 'open'
            )
            OR EXISTS (
              SELECT 1
              FROM public.assignment_questions aq
              JOIN public.questions q ON q.id = aq.question_id
              JOIN public.teacher_assignments assignment_org ON assignment_org.id = aq.assignment_id
              WHERE aq.assignment_id = qa.assignment_id
                AND assignment_org.organization_id = p_organization_id
                AND q.type = 'open'
            )
          )
        ) AS needs_grading,
        NULL::uuid AS question_id
      FROM learners l
      JOIN public.quiz_attempts qa ON qa.user_id = l.user_id
      LEFT JOIN public.teacher_assignments ta
        ON ta.id = qa.assignment_id AND ta.organization_id = p_organization_id
      LEFT JOIN public.question_banks qb
        ON qb.organization_id = p_organization_id
       AND qb.id = CASE
             WHEN qa.config->>'bankId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
             THEN (qa.config->>'bankId')::uuid
           END
      WHERE qa.organization_id = p_organization_id
        AND qa.completed_at IS NOT NULL
      ORDER BY qa.completed_at DESC
      LIMIT v_limit
    )
    UNION ALL
    (
      SELECT
        'report_opened',
        qr.created_at,
        qr.reported_by,
        NULL::uuid,
        LEFT(q.content, 120),
        NULL::int,
        false,
        qr.question_id
      FROM public.question_reports qr
      -- Mirrors the questions read policy within the scoped organization: a member may report any
      -- known question id, so the excerpt must not leak one outside their read scope. Group
      -- reports (question_id IS NULL) still show, with title NULL.
      LEFT JOIN public.questions q
        ON q.id = qr.question_id
       AND (q.created_by = p_user_id OR q.organization_id = p_organization_id)
      WHERE qr.teacher_id = p_user_id
        AND qr.organization_id = p_organization_id
        AND qr.status = 'open'
      ORDER BY qr.created_at DESC
      LIMIT v_limit
    )
  ),
  newest AS (
    SELECT * FROM events ORDER BY at DESC LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'kind', n.kind,
        'at', n.at,
        'personName', COALESCE(NULLIF(p.full_name, ''), split_part(p.email, '@', 1)),
        'title', n.title,
        'scorePct', n.score_pct,
        'needsGrading', n.needs_grading,
        'assignmentId', n.assignment_id,
        'questionId', n.question_id
      )
      ORDER BY n.at DESC
    ),
    '[]'::jsonb
  )
  INTO result
  FROM newest n
  -- Mirrors the profiles read policy ("Own or same-org profile read"): SECURITY DEFINER bypasses
  -- RLS, so a client-chosen reporter id must not surface a foreign user's name.
  LEFT JOIN public.profiles p
    ON p.id = n.person_id
   AND (
     auth.role() = 'service_role'
     OR p.id = p_user_id
     OR p.id IN (SELECT c.user_id FROM public.rls_caller_org_user_ids() c)
   );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_group_performance(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_group_performance(uuid, uuid, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_teacher_activity_feed(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_activity_feed(uuid, uuid, integer)
  TO authenticated, service_role;

-- ==========================================
-- 4. org_report_recipient: the learner's report-routing read has no
--    capability, so the reader moves to a definer RPC instead of widening
--    the policy (question-report.service.ts:117). It reproduces the old
--    embed's semantics exactly: the first org member (by joined_at) whose
--    role holds org.report.manage at a non-null scope. SECURITY DEFINER +
--    search_path = '' (R18), granted to authenticated + service_role only
--    (R19).
-- ==========================================
CREATE OR REPLACE FUNCTION public.org_report_recipient(p_organization_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT om.user_id
  FROM public.org_members om
  JOIN public.org_roles r ON r.id = om.org_role_id
  JOIN public.org_role_permissions rp ON rp.org_role_id = r.id
  WHERE om.organization_id = p_organization_id
    AND rp.permission_key = 'org.report.manage'
    AND rp.scope IS NOT NULL
  ORDER BY om.joined_at ASC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.org_report_recipient(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_report_recipient(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.org_report_recipient(uuid) TO authenticated, service_role;

-- ==========================================
-- Closing guard (R26): every object this file creates exists AND carries the
-- predicate it is supposed to carry — count(*) = 1 per policy keyed by
-- name, so a dropped policy fails instead of passing vacuously. The 5e-1
-- carry-over pins the seal's org-wide arm on the <> 'all' operator (the
-- 5e-1 delta review's nit: its own guard checked only the presence of
-- entitlement_profile, not the operator).
-- ==========================================
do $$
declare
  v_def text;
  v_name text;
begin
  -- 1. org_members SELECT: the self branch plus all nine union keys, and no
  --    WITH CHECK (the policy is SELECT-only; the write policies are
  --    untouched and still carry org.member.manage).
  if (
    select count(*)
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'org_members'
      and p.policyname = 'Own or same-org membership read'
      and p.cmd = 'SELECT'
      and p.qual is not null
      and p.with_check is null
      and position('user_id = auth.uid()' in p.qual) > 0
      and position('rls_caller_org_ids' in p.qual) > 0
      and position('org.member.manage' in p.qual) > 0
      and position('group.manage' in p.qual) > 0
      and position('group.invite' in p.qual) > 0
      and position('org.seat.manage' in p.qual) > 0
      and position('group.member.manage' in p.qual) > 0
      and position('org.role.manage' in p.qual) > 0
      and position('assignment.create' in p.qual) > 0
      and position('assignment.update' in p.qual) > 0
      and position('stats.read' in p.qual) > 0
      and position('rls_caller_covers_permission' in p.qual) > 0
      and position('account_type' in p.qual) = 0
  ) <> 1
  then
    raise exception 'the org_members SELECT policy no longer carries the self branch plus the nine-key D-5e2-1 union (or gained a WITH CHECK / a persona conjunct)';
  end if;

  -- 2. teacher_assignments SELECT: exactly one row, naming both the tenant
  --    floor and 5e-1's cohort helper (D-5e2-2).
  if (
    select count(*)
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'teacher_assignments'
      and p.policyname = 'Visible teacher assignments'
      and p.cmd = 'SELECT'
      and p.qual is not null
      and position('rls_caller_org_ids' in p.qual) > 0
      and position('rls_caller_can_read_assignment_targets' in p.qual) > 0
      and position('account_type' in p.qual) = 0
  ) <> 1
  then
    raise exception 'the teacher_assignments SELECT policy no longer delegates to rls_caller_can_read_assignment_targets inside the rls_caller_org_ids tenant floor';
  end if;

  -- 3. Both dashboard RPCs: the capability is in, the persona branch is out,
  --    the definer/search_path shape and the authenticated + service_role
  --    grants are kept.
  foreach v_name in array array['get_teacher_group_performance', 'get_teacher_activity_feed']
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = v_name;

    if v_def is null
       or position('stats.read' in v_def) = 0
       or position('rls_caller_covers_permission' in v_def) = 0
       or position('app_metadata' in v_def) > 0
       or position('account_type' in v_def) > 0
    then
      raise exception 'the teacher-dashboard RPC % lost the stats.read capability check or still reads the JWT persona', v_name;
    end if;
  end loop;

  if (
    select count(*)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('get_teacher_group_performance', 'get_teacher_activity_feed')
      and p.prosecdef
      and p.proconfig @> array['search_path=""']::text[]
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
  ) <> 2
  then
    raise exception 'a teacher-dashboard RPC lost its definer/search_path shape or its authenticated + service_role grants (anon must stay revoked)';
  end if;

  -- 4. org_report_recipient: definer, search_path pinned, executable by
  --    authenticated + service_role, not by anon, and it still names the
  --    org.report.manage key with a non-null scope.
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'org_report_recipient';

  if v_def is null
     or position('org.report.manage' in v_def) = 0
     or position('scope IS NOT NULL' in v_def) = 0
     or position('joined_at' in v_def) = 0
     or not exists (
       select 1
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'org_report_recipient'
         and p.prosecdef
         and p.proconfig @> array['search_path=""']::text[]
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')
         and has_function_privilege('service_role', p.oid, 'EXECUTE')
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
     )
  then
    raise exception 'org_report_recipient no longer carries the org.report.manage routing (definer, search_path pinned, authenticated + service_role only)';
  end if;

  -- 5. The 5e-1 carry-over: rls_caller_is_sealed_item's org-wide arm must
  --    still be the <> 'all' operator, not a revert to = 'learner' (the 5e-1
  --    guard checked only the presence of entitlement_profile).
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'rls_caller_is_sealed_item';

  if v_def is null
     or position('entitlement_profile' in v_def) = 0
     or position('<> ''all''' in v_def) = 0
     or position('= ''learner''' in v_def) > 0
  then
    raise exception 'rls_caller_is_sealed_item lost the entitlement_profile <> ''all'' org-wide arm (or reverted to = ''learner'')';
  end if;
end;
$$;
