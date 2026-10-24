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
-- The invariant this migration establishes has two floors:
--
--   1. TENANT/OWNER FLOOR — a row is visible/writable only by its creator, its
--      user, or a member of the row's organization.
--   2. ROLE-AUTHORITY FLOOR — for control-plane tables (membership,
--      invitations, billing/plan, seats, roles, groups) the caller's org role
--      must also hold the capability the app layer requires for the operation
--      (`member.manage`, `group.manage`).
--
-- Content tables keep only the tenant floor: fine-grained intra-organization
-- authorization (own/group/organization permission scopes, feature flags, role
-- builder) stays in the service layer, exactly as the headers of 20260920000001
-- and 20260925000001 document. Without the role-authority floor a plain member
-- could promote themselves or a peer to org admin, rewrite the org plan or
-- assign themselves a premium seat through PostgREST — all of which the app
-- layer already denies.
--
-- Capability resolution mirrors the ROLE layer of FeatureResolver
-- (packages/server/src/services/feature.resolver.ts): system `admin` holds every
-- capability, an enabled `org_role_features` row grants that capability, and a
-- role with zero feature rows (custom role) inherits the org's `plan_features`.
-- Per-user overrides and seat tiers deliberately do NOT raise this floor.
-- For a SEATED custom role the resolver additionally strips ADMIN_ONLY_FEATURES
-- (`org.manage`, `member.manage`, `role.builder`) so a seat can never grant
-- management authority; `has_org_feature` mirrors that (see the fallback
-- below), because RLS must never exceed the app gate.
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
-- Role-authority helpers.
--
-- `has_org_feature` is the SQL twin of FeatureResolver's role layer: a caller
-- holds an org capability when their role is the system `admin` role, has an
-- enabled `org_role_features` row for it, or is a custom role with no feature
-- rows at all (which inherits the org plan's entitlements).
--
-- These take an explicit actor and are service-role-only; the `rls_caller_*`
-- wrappers below bind them to auth.uid() for use inside policies and are the
-- only ones executable by `authenticated`.
--
-- SECURITY DEFINER so the inner org_members/org_roles/org_role_features lookups
-- bypass RLS and cannot recurse when referenced from those tables' own
-- policies. `SET search_path = ''` forces fully-qualified references.
-- ==========================================
CREATE OR REPLACE FUNCTION public.has_org_feature(
  p_actor uuid,
  p_organization_id uuid,
  p_feature text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members om
    JOIN public.org_roles r
      ON r.id = om.org_role_id
     AND r.organization_id = om.organization_id
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = p_actor
      AND om.organization_id = p_organization_id
      AND (
        (r.is_system AND r.name = 'admin')
        OR EXISTS (
          SELECT 1
          FROM public.org_role_features f
          WHERE f.org_role_id = r.id
            AND f.feature_key = p_feature
            AND f.is_enabled
        )
        OR (
          NOT EXISTS (
            SELECT 1 FROM public.org_role_features f2 WHERE f2.org_role_id = r.id
          )
          -- FeatureResolver parity for SEATED users: a seated role with zero
          -- feature rows inherits the SEAT plan, and the resolver strips
          -- ADMIN_ONLY_FEATURES (`org.manage`, `member.manage`,
          -- `role.builder`) for every seated non-admin role "to prevent
          -- privilege escalation through seats". The org-plan fallback must
          -- not hand those three capabilities to a seated caller, otherwise a
          -- manager-created custom role plus a seat would be an org manager in
          -- RLS while the app denies it (review-1-r2 B1, issue #191).
          AND (
            p_feature NOT IN ('org.manage', 'member.manage', 'role.builder')
            OR NOT EXISTS (
              SELECT 1
              FROM public.org_seat_assignments sa
              JOIN public.org_seat_pools sp ON sp.id = sa.pool_id
              WHERE sa.user_id = p_actor
                AND sa.organization_id = p_organization_id
                AND sp.plan_key IS NOT NULL
            )
          )
          AND EXISTS (
            SELECT 1
            FROM public.plan_features pf
            WHERE pf.plan_key = o.plan
              AND pf.feature_key = p_feature
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_org_feature(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_org_feature(uuid, uuid, text) TO service_role;

-- An org manager is a caller holding `member.manage` (system admin, or a role
-- the org granted member management). The app gates every membership, invite,
-- seat, settings and role mutation on this capability.
CREATE OR REPLACE FUNCTION public.is_org_manager(p_actor uuid, p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT public.has_org_feature(p_actor, p_organization_id, 'member.manage');
$$;

REVOKE ALL ON FUNCTION public.is_org_manager(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_manager(uuid, uuid) TO service_role;

-- May `p_actor` hand out `p_role_id`? Managers may assign any role inside the
-- invitation's organization. The system `teacher` role has one extra
-- capability from the classroom flow (/edu/classroom/invite has no role picker):
-- it may invite students, i.e. grant only the system `member` role.
CREATE OR REPLACE FUNCTION public.can_assign_org_role(p_actor uuid, p_role_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_roles target
    WHERE target.id = p_role_id
      AND (
        public.is_org_manager(p_actor, target.organization_id)
        OR (
          target.is_system
          AND target.name = 'member'
          AND EXISTS (
            SELECT 1
            FROM public.org_members om
            JOIN public.org_roles r ON r.id = om.org_role_id
            WHERE om.user_id = p_actor
              AND om.organization_id = target.organization_id
              AND r.is_system
              AND r.name = 'teacher'
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_assign_org_role(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_assign_org_role(uuid, uuid) TO service_role;

-- ---- RLS wrappers (auth.uid(), authenticated EXECUTE) ---------------------
CREATE OR REPLACE FUNCTION public.rls_caller_has_org_feature(
  p_organization_id uuid,
  p_feature text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT public.has_org_feature(auth.uid(), p_organization_id, p_feature);
$$;

REVOKE ALL ON FUNCTION public.rls_caller_has_org_feature(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_caller_has_org_feature(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rls_caller_is_org_manager(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT public.is_org_manager(auth.uid(), p_organization_id);
$$;

REVOKE ALL ON FUNCTION public.rls_caller_is_org_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_caller_is_org_manager(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rls_caller_can_assign_org_role(p_role_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT public.can_assign_org_role(auth.uid(), p_role_id);
$$;

REVOKE ALL ON FUNCTION public.rls_caller_can_assign_org_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_caller_can_assign_org_role(uuid) TO authenticated, service_role;

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
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END;
$$;

-- ==========================================
-- Public pricing (unauthenticated pricing page).
-- anon keeps its SELECT grant from 20261020000001; RLS needs a matching policy.
-- Writes are revoked from authenticated in 20261023233123.
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
-- organizations: read for members, update for managers. No INSERT/DELETE policy
-- on purpose — provisioning and deletion are service-role operations (a caller
-- is not a member until after the org + roles + default group exist).
-- ==========================================
CREATE POLICY "Org members read organization" ON public.organizations
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

-- Settings (rename/branding) are manager-only. `plan` additionally cannot be
-- changed through PostgREST at all: guard_organization_plan below raises 42501
-- for that column, because plan changes are service-role only
-- (apply_org_plan / Stripe webhook).
CREATE POLICY "Org managers update organization" ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(id)
  )
  WITH CHECK (
    id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(id)
  );

-- Role lists stay readable by every org member (member management UI, withAuth
-- reads the caller's own role permissions on every request); only managers may
-- write them (role.builder is an admin capability).
CREATE POLICY "Org members read roles" ON public.org_roles
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Org managers insert roles" ON public.org_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
  );

CREATE POLICY "Org managers update roles" ON public.org_roles
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
  );

CREATE POLICY "Org managers delete roles" ON public.org_roles
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
  );

-- with-auth.ts reads the caller's org_role_permissions rows on every request, so
-- SELECT stays org-scoped for every member. Writes are manager-only.
CREATE POLICY "Org members read role permissions" ON public.org_role_permissions
  FOR SELECT TO authenticated
  USING (
    org_role_id IN (
      SELECT r.id FROM public.org_roles r
      WHERE r.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  );

CREATE POLICY "Org managers insert role permissions" ON public.org_role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.org_roles r
      WHERE r.id = org_role_id
        AND r.organization_id IN (
          SELECT c.organization_id FROM public.rls_caller_org_ids() c
        )
        AND public.rls_caller_is_org_manager(r.organization_id)
    )
  );

CREATE POLICY "Org managers update role permissions" ON public.org_role_permissions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_roles r
      WHERE r.id = org_role_id
        AND r.organization_id IN (
          SELECT c.organization_id FROM public.rls_caller_org_ids() c
        )
        AND public.rls_caller_is_org_manager(r.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.org_roles r
      WHERE r.id = org_role_id
        AND r.organization_id IN (
          SELECT c.organization_id FROM public.rls_caller_org_ids() c
        )
        AND public.rls_caller_is_org_manager(r.organization_id)
    )
  );

CREATE POLICY "Org managers delete role permissions" ON public.org_role_permissions
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_roles r
      WHERE r.id = org_role_id
        AND r.organization_id IN (
          SELECT c.organization_id FROM public.rls_caller_org_ids() c
        )
        AND public.rls_caller_is_org_manager(r.organization_id)
    )
  );

-- Seat pools: every member may READ (getSeatPlanKey resolves the caller's tier
-- on every feature/limit check), but buying/expanding a pool is a manager
-- operation (seat routes are MANAGER-only in the app).
CREATE POLICY "Org members read seat pools" ON public.org_seat_pools
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Org managers insert seat pools" ON public.org_seat_pools
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
  );

CREATE POLICY "Org managers update seat pools" ON public.org_seat_pools
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
  );

CREATE POLICY "Org managers delete seat pools" ON public.org_seat_pools
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
  );

-- Seat assignments: a member may read their OWN assignment (the resolver needs
-- it) and managers read the org's; writes are manager-only. This closes the
-- self-service premium-seat path through PostgREST.
CREATE POLICY "Own or managed seat assignment read" ON public.org_seat_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
      AND public.rls_caller_is_org_manager(organization_id)
    )
  );

CREATE POLICY "Org managers insert seat assignments" ON public.org_seat_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
  );

CREATE POLICY "Org managers update seat assignments" ON public.org_seat_assignments
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
  );

CREATE POLICY "Org managers delete seat assignments" ON public.org_seat_assignments
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
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
-- Invitations: silo inside the org, minted only by someone who may hand out the
-- target role, and readable/editable only by a manager or the inviter.
--
-- Without the assignment check a plain member could insert an invitation for
-- their own email targeting the org's admin role, read the token back, and let
-- the service-role accept flow promote them. The teacher→member exception is
-- the classroom invite flow; managers may invite into any role.
--
-- Token preview and accept before membership run on the service-role client.
-- ==========================================
CREATE POLICY "Org managers or inviter read invitations" ON public.invitations
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND (
      public.rls_caller_is_org_manager(organization_id)
      OR inviter_id = auth.uid()
    )
  );

CREATE POLICY "Authorized inviter insert invitations" ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND inviter_id = auth.uid()
    AND public.rls_caller_can_assign_org_role(target_org_role_id)
  );

-- WITH CHECK fully replaces USING for the new row, so the base predicate has to
-- be repeated — and the new target role is re-checked against the caller's
-- grant authority (a member cannot retarget their own invite to admin).
CREATE POLICY "Org managers or inviter update invitations" ON public.invitations
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND (
      public.rls_caller_is_org_manager(organization_id)
      OR inviter_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND (
      public.rls_caller_is_org_manager(organization_id)
      OR inviter_id = auth.uid()
    )
    AND public.rls_caller_can_assign_org_role(target_org_role_id)
  );

CREATE POLICY "Org managers or inviter delete invitations" ON public.invitations
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND (
      public.rls_caller_is_org_manager(organization_id)
      OR inviter_id = auth.uid()
    )
  );

-- ==========================================
-- Groups. The read floor is the organization, not group membership: teachers
-- and managers deliberately see/add arbitrary org members to groups
-- (group.service#setGroupMembers), and withAuth reads the caller's own
-- group_members rows on every request. Writes are gated on `group.manage`
-- (admin/teacher), matching the app's route/feature gate — otherwise any member
-- could join any group and inherit its `group`-scoped read access.
-- ==========================================
CREATE POLICY "Org members read groups" ON public.groups
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
  );

CREATE POLICY "Group managers insert groups" ON public.groups
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_has_org_feature(organization_id, 'group.manage')
  );

CREATE POLICY "Group managers update groups" ON public.groups
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_has_org_feature(organization_id, 'group.manage')
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_has_org_feature(organization_id, 'group.manage')
  );

CREATE POLICY "Group managers delete groups" ON public.groups
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_has_org_feature(organization_id, 'group.manage')
  );

CREATE POLICY "Org members read group members" ON public.group_members
  FOR SELECT TO authenticated
  USING (
    group_id IN (
      SELECT g.id FROM public.groups g
      WHERE g.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  );

CREATE POLICY "Group managers insert group members" ON public.group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_id
        AND g.organization_id IN (
          SELECT c.organization_id FROM public.rls_caller_org_ids() c
        )
        AND public.rls_caller_has_org_feature(g.organization_id, 'group.manage')
    )
  );

CREATE POLICY "Group managers update group members" ON public.group_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_id
        AND g.organization_id IN (
          SELECT c.organization_id FROM public.rls_caller_org_ids() c
        )
        AND public.rls_caller_has_org_feature(g.organization_id, 'group.manage')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_id
        AND g.organization_id IN (
          SELECT c.organization_id FROM public.rls_caller_org_ids() c
        )
        AND public.rls_caller_has_org_feature(g.organization_id, 'group.manage')
    )
  );

CREATE POLICY "Group managers delete group members" ON public.group_members
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_id
        AND g.organization_id IN (
          SELECT c.organization_id FROM public.rls_caller_org_ids() c
        )
        AND public.rls_caller_has_org_feature(g.organization_id, 'group.manage')
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
-- Quiz attempts: the student owns their attempts; every member of a shared
-- organization can read them (this is a same-org floor, not a teacher-only
-- restriction — clients gate it, RLS only proves tenant membership).
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
-- Students write only their own rows; every member of a shared organization can
-- read them (same-org floor; the teacher dashboard is a client-side gate, not
-- the policy). Policies are permissive, so SELECT is the OR of the two below.
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
-- own org_role_id through PostgREST and promote themselves. `user_id <>
-- auth.uid()` alone is not enough either: without the manager check a member
-- could promote a peer (two accounts = self-promotion). Membership is created
-- by org provisioning / invitation accept (both on the service-role client), so
-- there is deliberately no INSERT policy; changes and removals require
-- `member.manage` and never target the caller's own row
-- (organization-member.service rejects targetUserId === ctx.userId too).
--
-- The WITH CHECK also repeats the manager predicate (it replaces USING for the
-- new row) and requires the new role to belong to the same organization; the
-- validate_org_member_org_role trigger enforces that authoritatively for every
-- writer, service role included.
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
    AND public.rls_caller_is_org_manager(organization_id)
    AND user_id <> auth.uid()
  )
  WITH CHECK (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
    AND user_id <> auth.uid()
    AND org_role_id IN (
      SELECT r.id FROM public.org_roles r
      WHERE r.organization_id = org_members.organization_id
    )
  );

CREATE POLICY "Org managers delete other members" ON public.org_members
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT c.organization_id FROM public.rls_caller_org_ids() c)
    AND public.rls_caller_is_org_manager(organization_id)
    AND user_id <> auth.uid()
  );

-- ==========================================
-- Integrity guards. These are DATA invariants, not only RLS: they fire for every
-- writer, including the service role, so the accept/provisioning paths cannot
-- persist a cross-org role reference either.
-- ==========================================

-- An invitation may only target a role of its own organization. Without this,
-- acceptInvitation (service role) could write another org's role onto a member
-- row and leak that org's permission scopes into withAuth.
CREATE OR REPLACE FUNCTION public.validate_invitation_target_org_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_role_org uuid;
BEGIN
  SELECT r.organization_id INTO v_role_org
  FROM public.org_roles r
  WHERE r.id = NEW.target_org_role_id;

  IF v_role_org IS NULL OR v_role_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'invitation target role % does not belong to organization %',
      NEW.target_org_role_id, NEW.organization_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_invitation_target_org_role() FROM PUBLIC;

-- Fail closed at deploy: no pre-existing cross-org invitation may survive.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(i.id::text, ', ' ORDER BY i.id)
  INTO bad
  FROM public.invitations i
  JOIN public.org_roles r ON r.id = i.target_org_role_id
  WHERE r.organization_id IS DISTINCT FROM i.organization_id;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'invitation(s) target a role from another organization: %', bad;
  END IF;
END;
$$;

CREATE TRIGGER validate_invitation_target_org_role
  BEFORE INSERT OR UPDATE OF target_org_role_id, organization_id ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.validate_invitation_target_org_role();

-- Same rule for memberships: an org_members row must reference one of its own
-- org's roles (cross-tenant role references would leak scopes into withAuth).
CREATE OR REPLACE FUNCTION public.validate_org_member_org_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_role_org uuid;
BEGIN
  SELECT r.organization_id INTO v_role_org
  FROM public.org_roles r
  WHERE r.id = NEW.org_role_id;

  IF v_role_org IS NULL OR v_role_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'org member role % does not belong to organization %',
      NEW.org_role_id, NEW.organization_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_org_member_org_role() FROM PUBLIC;

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(om.id::text, ', ' ORDER BY om.id)
  INTO bad
  FROM public.org_members om
  JOIN public.org_roles r ON r.id = om.org_role_id
  WHERE r.organization_id IS DISTINCT FROM om.organization_id;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'org_member(s) reference a role from another organization: %', bad;
  END IF;
END;
$$;

CREATE TRIGGER validate_org_member_org_role
  BEFORE INSERT OR UPDATE OF org_role_id, organization_id ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.validate_org_member_org_role();

-- Plan changes are service-role only (apply_org_plan / Stripe webhook). The
-- policy already limits UPDATE to managers; this closes the billing escalation
-- for managers too and keeps every other column editable.
CREATE OR REPLACE FUNCTION public.guard_organization_plan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan AND auth.role() = 'authenticated' THEN
    RAISE EXCEPTION 'organization plan changes are service-role only'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_organization_plan() FROM PUBLIC;

CREATE TRIGGER guard_organization_plan
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.guard_organization_plan();

-- The manager helper keys on the system `admin` role name, so renaming a system
-- role (or flipping is_system) through PostgREST must be impossible. No DELETE
-- guard: deleting an organization cascades to its roles.
CREATE OR REPLACE FUNCTION public.guard_system_org_role_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND OLD.is_system THEN
    IF NEW.name IS DISTINCT FROM OLD.name
      OR NEW.is_system IS DISTINCT FROM OLD.is_system
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'system org roles cannot be renamed or moved'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_system_org_role_identity() FROM PUBLIC;

CREATE TRIGGER guard_system_org_role_identity
  BEFORE UPDATE ON public.org_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_system_org_role_identity();

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
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity = false;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is still disabled on public table(s): %', missing;
  END IF;
END;
$$;
