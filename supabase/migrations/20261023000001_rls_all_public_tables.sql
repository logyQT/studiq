-- ==========================================
-- Tenant isolation: enable RLS on every public table and add org/owner policies.
-- Closes issue #191 (SEC-13).
--
-- 20261020000001_revoke_anon_grants.sql removed `anon`'s table privileges, but
-- `authenticated` still had GRANT ALL on all 47 public tables and 41 of them had
-- no RLS at all. Because authorization lives in the service layer
-- (buildQueryFilter / checkAccess), any signed-in user could talk to PostgREST
-- directly and read/write any row of any organization.
--
-- The invariant this migration establishes is a tenant/owner FLOOR, not a
-- replacement for app-layer authz:
--
--   a row is visible/writable only by its creator, its user, or a member of the
--   row's organization.
--
-- Fine-grained intra-organization authorization (own/group/organization
-- permission scopes, feature flags, role builder) stays in the service layer,
-- exactly as the headers of 20260920000001 and 20260925000001 document. Org
-- members can still write org-scoped rows of another member through PostgREST
-- (see the follow-up recorded in the design doc); cross-tenant access and the
-- anonymous surface are closed.
--
-- What is NOT allowed by policy and therefore moves to the service-role client
-- in the same PR:
--   * INSERT/DELETE on public.organizations (org provisioning),
--   * INSERT on public.org_members (invite accept),
-- and pre-membership reads performed while provisioning an org or previewing an
-- invitation token (see organization.service / classroom.service /
-- invitation.service).
--
-- `service_role` bypasses RLS (BYPASSRLS) and `postgres` owns the tables, so
-- migrations, seeds, the admin app and integration-test fixtures are unaffected.
--
-- Helper `rls_caller_org_ids()` already exists (20260920000001). The sibling
-- `rls_caller_org_user_ids()` is added here: the teacher dashboard legitimately
-- reads *other* users' profiles / activity / attempts through the user-session
-- client (activity.service.ts, /api/v1/stats/teacher/*), and those users are
-- always members of the caller's organizations.
--
-- Every policy is scoped `TO authenticated` (or `anon, authenticated` for the
-- public pricing tables) instead of PUBLIC so anon can never evaluate a policy
-- that calls a helper it has no EXECUTE privilege on, and so a future accidental
-- grant to anon fails closed instead of opening a table.
-- ==========================================

-- ==========================================
-- Helper: users who share at least one organization with the caller.
-- SECURITY DEFINER so the inner org_members lookup bypasses RLS and cannot
-- recurse when referenced from org_members' own policy.
-- ==========================================
CREATE OR REPLACE FUNCTION public.rls_caller_org_user_ids()
RETURNS TABLE(user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT DISTINCT om.user_id
  FROM public.org_members om
  WHERE om.organization_id IN (
    SELECT c.organization_id FROM public.rls_caller_org_ids() c
  );
$$;

REVOKE ALL ON FUNCTION public.rls_caller_org_user_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_caller_org_user_ids() TO authenticated, service_role;

-- ==========================================
-- Enable RLS on EVERY public table.
--
-- A DO loop instead of 41 hand-written ALTERs guarantees a table can never be
-- silently missed: a missed table now fails closed (no policy => no rows)
-- instead of staying world-readable. The loop is idempotent for the six tables
-- that already have RLS (flashcards, flashcard_decks, org_limits, org_members,
-- org_role_features, questions).
-- ==========================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END;
$$;

-- ==========================================
-- Public pricing (unauthenticated pricing page).
-- anon keeps its SELECT grant from 20261020000001; RLS needs a matching policy.
-- Writes are revoked from authenticated in 20261023000002.
-- ==========================================
CREATE POLICY "Public pricing read" ON public.subscription_plans
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public pricing read" ON public.plan_features
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public pricing read" ON public.plan_limits
  FOR SELECT TO anon, authenticated USING (true);

-- ==========================================
-- Catalog data: readable by every signed-in user, written only by the admin app
-- (service role) and seeds (postgres). Writes are revoked in migration 2.
-- ==========================================
CREATE POLICY "Authenticated catalog read" ON public.feature_flags
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated catalog read" ON public.permissions
  FOR SELECT TO authenticated USING (true);

-- Dead table (no application references outside migrations), but it carries
-- per-user rows, so keep it owner-readable rather than public.
CREATE POLICY "Own resource permissions" ON public.resource_permissions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ==========================================
-- Organization core.
--
-- organizations: read/update only for members. No INSERT/DELETE policy on
-- purpose — provisioning and deletion are service-role operations (a caller is
-- not a member until after the org + roles + default group exist).
-- ==========================================
CREATE POLICY "Org members read organization" ON public.organizations
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Org members update organization" ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  )
  WITH CHECK (
    id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Org members manage roles" ON public.org_roles
  FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Org members manage role permissions" ON public.org_role_permissions
  FOR ALL TO authenticated
  USING (
    org_role_id IN (
      SELECT r.id FROM public.org_roles r
      WHERE r.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  )
  WITH CHECK (
    org_role_id IN (
      SELECT r.id FROM public.org_roles r
      WHERE r.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  );

CREATE POLICY "Org members manage seat pools" ON public.org_seat_pools
  FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Org members manage seat assignments" ON public.org_seat_assignments
  FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

-- ==========================================
-- profiles: own row, plus the rows of everyone in a shared organization (org
-- rosters, teacher activity dashboard, report authors). No write policy: writes
-- stay revoked by 20261022000001 and the SECURITY DEFINER handle_new_user()
-- trigger / service role keep working.
-- ==========================================
CREATE POLICY "Own or same-org profile read" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR id IN (SELECT u.user_id FROM public.rls_caller_org_user_ids() u)
  );

-- ==========================================
-- Invitations: an org's invitations are visible/manageable inside that org.
-- Token preview and accept before membership moved to the service-role client.
-- ==========================================
CREATE POLICY "Org members manage invitations" ON public.invitations
  FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

-- ==========================================
-- Groups. The floor is the organization, not group membership: teachers and
-- managers deliberately add arbitrary org members to groups
-- (group.service#setGroupMembers), so a "only my groups" policy would break
-- roster management.
-- ==========================================
CREATE POLICY "Org members manage groups" ON public.groups
  FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Org members manage group members" ON public.group_members
  FOR ALL TO authenticated
  USING (
    group_id IN (
      SELECT g.id FROM public.groups g
      WHERE g.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  )
  WITH CHECK (
    group_id IN (
      SELECT g.id FROM public.groups g
      WHERE g.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  );

-- ==========================================
-- Content the caller owns or that belongs to their organization. Mirrors the
-- existing "Own or same-org access" policy on public.questions.
-- ==========================================
CREATE POLICY "Own or same-org questions banks" ON public.question_banks
  FOR ALL TO authenticated
  USING (
    created_by = auth.uid()
    OR organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  )
  WITH CHECK (
    created_by = auth.uid()
    OR organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Own or same-org topics" ON public.topics
  FOR ALL TO authenticated
  USING (
    created_by = auth.uid()
    OR organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  )
  WITH CHECK (
    created_by = auth.uid()
    OR organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

-- ==========================================
-- Child rows: visibility follows the parent row's policy. Nested RLS means the
-- parent subquery is itself filtered (e.g. question_options only sees options of
-- questions the caller can read), which is exactly the desired behaviour and is
-- acyclic.
-- ==========================================
CREATE POLICY "Visible question options" ON public.question_options
  FOR ALL TO authenticated
  USING (
    question_id IN (SELECT q.id FROM public.questions q)
  )
  WITH CHECK (
    question_id IN (SELECT q.id FROM public.questions q)
  );

-- Flashcard <-> topic links are shared content: a student may read the topic
-- names of a deck shared with their org, and a teacher may link their own card
-- to an org topic. Allow a row if either endpoint is visible.
CREATE POLICY "Visible flashcard topic links" ON public.flashcard_topic_assignments
  FOR ALL TO authenticated
  USING (
    flashcard_id IN (SELECT f.id FROM public.flashcards f)
    OR topic_id IN (SELECT t.id FROM public.topics t)
  )
  WITH CHECK (
    flashcard_id IN (SELECT f.id FROM public.flashcards f)
    OR topic_id IN (SELECT t.id FROM public.topics t)
  );

CREATE POLICY "Visible question topic links" ON public.question_topic_assignments
  FOR ALL TO authenticated
  USING (
    question_id IN (SELECT q.id FROM public.questions q)
  )
  WITH CHECK (
    question_id IN (SELECT q.id FROM public.questions q)
  );

-- ==========================================
-- Group sharing links (deck/bank/topic <-> group). The group must be in the
-- caller's organization.
-- ==========================================
CREATE POLICY "Org members manage deck groups" ON public.deck_groups
  FOR ALL TO authenticated
  USING (
    group_id IN (
      SELECT g.id FROM public.groups g
      WHERE g.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  )
  WITH CHECK (
    group_id IN (
      SELECT g.id FROM public.groups g
      WHERE g.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  );

CREATE POLICY "Org members manage bank groups" ON public.bank_groups
  FOR ALL TO authenticated
  USING (
    group_id IN (
      SELECT g.id FROM public.groups g
      WHERE g.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  )
  WITH CHECK (
    group_id IN (
      SELECT g.id FROM public.groups g
      WHERE g.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  );

CREATE POLICY "Org members manage topic groups" ON public.topic_groups
  FOR ALL TO authenticated
  USING (
    group_id IN (
      SELECT g.id FROM public.groups g
      WHERE g.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  )
  WITH CHECK (
    group_id IN (
      SELECT g.id FROM public.groups g
      WHERE g.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  );

-- ==========================================
-- Quizzes and assignments.
-- ==========================================
CREATE POLICY "Org members manage quizzes" ON public.quizzes
  FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Visible quiz questions" ON public.quiz_questions
  FOR ALL TO authenticated
  USING (
    quiz_id IN (SELECT z.id FROM public.quizzes z)
  )
  WITH CHECK (
    quiz_id IN (SELECT z.id FROM public.quizzes z)
  );

CREATE POLICY "Org members manage teacher assignments" ON public.teacher_assignments
  FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Visible assignment questions" ON public.assignment_questions
  FOR ALL TO authenticated
  USING (
    assignment_id IN (SELECT a.id FROM public.teacher_assignments a)
  )
  WITH CHECK (
    assignment_id IN (SELECT a.id FROM public.teacher_assignments a)
  );

CREATE POLICY "Visible assignment targets" ON public.assignment_targets
  FOR ALL TO authenticated
  USING (
    assignment_id IN (SELECT a.id FROM public.teacher_assignments a)
  )
  WITH CHECK (
    assignment_id IN (SELECT a.id FROM public.teacher_assignments a)
  );

-- ==========================================
-- Quiz attempts: the student owns their attempts; teachers/graders read the
-- attempts of users in their organizations (activity + grading dashboards).
-- ==========================================
CREATE POLICY "Own or same-org quiz attempts" ON public.quiz_attempts
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR user_id IN (SELECT u.user_id FROM public.rls_caller_org_user_ids() u)
  )
  WITH CHECK (
    user_id = auth.uid()
    OR user_id IN (SELECT u.user_id FROM public.rls_caller_org_user_ids() u)
  );

CREATE POLICY "Visible attempt questions" ON public.quiz_attempt_questions
  FOR ALL TO authenticated
  USING (
    attempt_id IN (SELECT a.id FROM public.quiz_attempts a)
  )
  WITH CHECK (
    attempt_id IN (SELECT a.id FROM public.quiz_attempts a)
  );

CREATE POLICY "Visible student answers" ON public.student_answers
  FOR ALL TO authenticated
  USING (
    attempt_id IN (SELECT a.id FROM public.quiz_attempts a)
  )
  WITH CHECK (
    attempt_id IN (SELECT a.id FROM public.quiz_attempts a)
  );

CREATE POLICY "Visible assignment answer images" ON public.assignment_answer_images
  FOR ALL TO authenticated
  USING (
    attempt_id IN (SELECT a.id FROM public.quiz_attempts a)
  )
  WITH CHECK (
    attempt_id IN (SELECT a.id FROM public.quiz_attempts a)
  );

-- ==========================================
-- Reports: reporter, recipient teacher, or anyone in the org the report belongs
-- to. organization_id is nullable on legacy/orphaned rows, so the owner checks
-- carry those.
-- ==========================================
CREATE POLICY "Report participants or org members" ON public.question_reports
  FOR ALL TO authenticated
  USING (
    reported_by = auth.uid()
    OR teacher_id = auth.uid()
    OR organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  )
  WITH CHECK (
    reported_by = auth.uid()
    OR teacher_id = auth.uid()
    OR organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Visible report messages" ON public.question_report_messages
  FOR ALL TO authenticated
  USING (
    report_id IN (SELECT r.id FROM public.question_reports r)
  )
  WITH CHECK (
    report_id IN (SELECT r.id FROM public.question_reports r)
  );

-- ==========================================
-- Personal activity with a same-org read exception.
--
-- Students write only their own rows; teachers read the rows of users in their
-- organizations (activity.service.ts, /api/v1/stats/teacher/*). Policies are
-- permissive, so SELECT is the OR of the two policies below.
-- ==========================================
CREATE POLICY "Own activity write" ON public.flashcard_practice
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Own or same-org practice read" ON public.flashcard_practice
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR user_id IN (SELECT u.user_id FROM public.rls_caller_org_user_ids() u)
  );

CREATE POLICY "Own activity write" ON public.user_daily_activity
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Own or same-org daily activity read" ON public.user_daily_activity
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR user_id IN (SELECT u.user_id FROM public.rls_caller_org_user_ids() u)
  );

-- ==========================================
-- Strictly personal flashcard state.
-- ==========================================
CREATE POLICY "Own review state" ON public.flashcard_review_state
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Own study sessions" ON public.flashcard_study_sessions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Own suspended decks" ON public.suspended_decks
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Own study settings" ON public.user_study_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Per-user feature overrides are admin/service-role written; a user may only see
-- their own. Writes are revoked in migration 2.
CREATE POLICY "Own feature overrides read" ON public.user_feature_overrides
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ==========================================
-- org_members: replace the 20260920000001 FOR ALL policy.
--
-- The old policy allowed `user_id = auth.uid()`, so a member could PATCH their
-- own org_role_id through PostgREST and promote themselves to the org admin
-- role. Membership is created by org provisioning / invitation accept (both on
-- the service-role client now), so there is deliberately no INSERT policy and no
-- self-UPDATE/DELETE. Managers operate on other members —
-- organization-member.service already rejects targetUserId === ctx.userId.
-- ==========================================
DROP POLICY "Own or same-org membership access" ON public.org_members;

CREATE POLICY "Own or same-org membership read" ON public.org_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Org managers update other members" ON public.org_members
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND user_id <> auth.uid()
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND user_id <> auth.uid()
  );

CREATE POLICY "Org managers delete other members" ON public.org_members
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND user_id <> auth.uid()
  );

-- ==========================================
-- Fail the migration (and therefore the deploy) if a public table is still
-- unprotected. A missed table must never silently ship world-readable.
-- ==========================================
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
  INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is still disabled on public table(s): %', missing;
  END IF;
END;
$$;
