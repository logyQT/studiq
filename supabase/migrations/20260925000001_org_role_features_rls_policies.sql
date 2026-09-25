-- ==========================================
-- Fix #124: org_role_features + org_limits have RLS enabled but ZERO policies
--
-- 20260707000005_org_role_features_and_limits.sql enabled ROW LEVEL SECURITY
-- on both tables and never added a CREATE POLICY, so Postgres denies every row
-- to non-service-role clients. Both tables are read through the user-session
-- client (packages/server/src/services/feature.resolver.ts and
-- limits.resolver.ts via createClient()), which meant a real logged-in user
-- always got [] back while service-role queries (admin panel, scripts, tests)
-- bypassed RLS and looked fine:
--
--   * FeatureResolver.resolveFeatures()'s "not seated" branch never fired —
--     org members fell through to the org-plan / personal-plan fallback
--     instead of their role's filtered entitlement, over-granting features the
--     org trigger deliberately strips from non-admin roles (e.g.
--     member.manage / org.manage for the plain member role).
--   * LimitsResolver's org_limits override was silently ignored, so
--     per-org capacity caps never applied to real sessions.
--
-- Scope follows 20260920000001_reenable_rls_sensitive_tables.sql: the outer
-- bound is the caller's own organization, resolved via the SECURITY DEFINER
-- helper public.rls_caller_org_ids() (a plain subquery on org_members from
-- inside org_members' own policy is self-recursive — see that migration's
-- header). org_role_features reaches its organization through org_roles,
-- which has no RLS enabled, so that hop cannot recurse.
--
-- SELECT only: every write to these tables comes from SECURITY DEFINER
-- seeding triggers (handle_new_organization et al. — executed as the function
-- owner, which bypasses RLS), from service_role, or from migration-owner
-- paths. No application code writes them through a user-session client, so no
-- INSERT/UPDATE/DELETE policy is granted.
-- ==========================================

-- Belt-and-braces for the service role (it already bypasses RLS via
-- BYPASSRLS; mirrors 20260920000001's pattern).
CREATE POLICY "Service role full access" ON public.org_role_features
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON public.org_limits
  FOR ALL USING (auth.role() = 'service_role');

-- Org-scoped read: members of an organization may read the per-role feature
-- grants of that organization (FeatureResolver reads the caller's own role's
-- rows; keeping the boundary at the org keeps role-feature metadata inside
-- the org that owns it, and leaves room for role-comparison UIs).
-- TO authenticated keeps anon out cleanly (anon has table grants via default
-- privileges but no EXECUTE on rls_caller_org_ids — evaluating the policy
-- would raise instead of returning zero rows).
CREATE POLICY "Org members read role features" ON public.org_role_features
  FOR SELECT
  TO authenticated
  USING (
    org_role_id IN (
      SELECT r.id
      FROM public.org_roles r
      WHERE r.organization_id IN (
        SELECT c.organization_id FROM public.rls_caller_org_ids() c
      )
    )
  );

-- Org-scoped read: members of an organization may read that organization's
-- limit overrides (LimitsResolver.getEffectiveLimit / checkOrgLimit).
CREATE POLICY "Org members read limits" ON public.org_limits
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT c.organization_id FROM public.rls_caller_org_ids() c
    )
  );
