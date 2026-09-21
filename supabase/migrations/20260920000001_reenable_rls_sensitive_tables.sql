-- ==========================================
-- Re-enable RLS on sensitive tables (defense-in-depth)
--
-- Addresses finding F5 / hardening item H5 from
-- docs/plans/agent-security.md. RLS was disabled system-wide in
-- 20260703000008_grant_table_permissions.sql; app-layer authorization
-- (buildQueryFilter/checkPermission/accessibleFilter in
-- packages/server/src/lib/authz.ts) remains the primary enforcement
-- mechanism and already scopes queries by own/organization/group.
--
-- These policies do not attempt to replicate that per-permission
-- group-level granularity in SQL — doing so would require exposing the
-- caller's active organization as Postgres session state, which the
-- app does not currently set. Instead they provide a floor an
-- application-layer bug cannot breach: a row is only visible/writable
-- by its creator or by a fellow member of the same organization.
-- Confirmed safe against current + role-builder-configurable scopes:
-- DEFAULT_ROLE_PERMISSIONS never exceeds 'organization' scope for
-- flashcard/deck/question permissions, and the role builder's schema
-- (packages/server/src/models/org-role.model.ts) only allows
-- 'own' | 'group' | 'organization' — 'any' is not assignable, so no
-- legitimate query ever needs to see rows outside the caller's own
-- organizations.
--
-- service_role (storage.service.ts, and all of apps/admin) bypasses
-- RLS entirely and is unaffected.
--
-- "Which orgs is the caller in" is resolved via a SECURITY DEFINER
-- helper rather than a plain subquery on org_members. A plain subquery
-- referencing org_members from inside org_members' own policy is
-- self-recursive — confirmed locally, Postgres raises
-- "42P17 infinite recursion detected in policy for relation
-- org_members" — because evaluating the subquery re-triggers RLS on
-- the same table. Wrapping it in a SECURITY DEFINER function runs that
-- inner lookup as the function owner, bypassing RLS for just that
-- lookup and breaking the cycle. This is the pattern Supabase's own
-- docs recommend for self-referencing membership tables.
-- ==========================================

CREATE OR REPLACE FUNCTION public.rls_caller_org_ids()
RETURNS TABLE(organization_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT om.organization_id FROM public.org_members om WHERE om.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.rls_caller_org_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_caller_org_ids() TO authenticated, service_role;

ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.flashcards
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.flashcard_decks
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.questions
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON public.org_members
  FOR ALL USING (auth.role() = 'service_role');

-- Own content, or content belonging to an organization the caller is a
-- member of. organization_id is nullable (personal, non-org content).
CREATE POLICY "Own or same-org access" ON public.flashcards
  FOR ALL
  USING (
    created_by = auth.uid()
    OR organization_id IN (SELECT organization_id FROM public.rls_caller_org_ids())
  )
  WITH CHECK (
    created_by = auth.uid()
    OR organization_id IN (SELECT organization_id FROM public.rls_caller_org_ids())
  );

CREATE POLICY "Own or same-org access" ON public.flashcard_decks
  FOR ALL
  USING (
    created_by = auth.uid()
    OR organization_id IN (SELECT organization_id FROM public.rls_caller_org_ids())
  )
  WITH CHECK (
    created_by = auth.uid()
    OR organization_id IN (SELECT organization_id FROM public.rls_caller_org_ids())
  );

CREATE POLICY "Own or same-org access" ON public.questions
  FOR ALL
  USING (
    created_by = auth.uid()
    OR organization_id IN (SELECT organization_id FROM public.rls_caller_org_ids())
  )
  WITH CHECK (
    created_by = auth.uid()
    OR organization_id IN (SELECT organization_id FROM public.rls_caller_org_ids())
  );

-- org_members: a caller can see/manage membership rows for
-- organizations they themselves belong to (their own row, or a fellow
-- member's row in a shared org) — needed for org rosters, invites,
-- role changes and removals, all performed via the user-session
-- client (packages/server/src/services/organization-member.service.ts).
-- Fine-grained "who is allowed to invite/remove/change roles" stays an
-- app-layer decision (checkPermission); this is only the outer bound
-- that prevents cross-organization exposure.
CREATE POLICY "Own or same-org membership access" ON public.org_members
  FOR ALL
  USING (
    user_id = auth.uid()
    OR organization_id IN (SELECT organization_id FROM public.rls_caller_org_ids())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR organization_id IN (SELECT organization_id FROM public.rls_caller_org_ids())
  );
