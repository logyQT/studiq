-- ==========================================
-- GRANT table permissions for PostgREST
-- Runs after all migrations so every table
-- exists when grants are issued.
--
-- RLS is the authorization floor for PostgREST access
-- (20261023000001_rls_all_public_tables.sql): a row is visible/writable only by
-- its creator or by a member of the row's organization and, for control-plane
-- tables (membership, invitations, billing, seats, roles, groups), only by a
-- caller whose org role holds the capability the app layer requires
-- (member.manage / group.manage). Fine-grained intra-organization authorization
-- (own/group/organization permission scopes, feature flags) still lives in the
-- app layer (buildQueryFilter, checkPermission).
--
-- Supabase grants `authenticated` ALL on every table by default, so the blanket
-- grants below are immediately narrowed to what the app actually needs — the
-- same narrowing the migrations apply. This file MUST stay in sync with
-- 20261023000002_rls_function_and_grant_hardening.sql: seeds run after
-- migrations, so anything not repeated here would be re-opened on every
-- `supabase db reset` (this is how apply_org_plan ended up executable by
-- `authenticated` locally despite its own migration revoking it).
-- ==========================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- Full table access for authenticated users + service role. RLS policies bound
-- what each role can actually read/write; the revokes below remove the
-- privileges no user-session code path uses.
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

-- Sequence access
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Future-proof: auto-grant on tables created after this seed runs
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO authenticated, service_role;

-- ==========================================
-- Read-only tables: written by the admin app (service role) and seeds (postgres)
-- only. Keep SELECT for authenticated.
-- ==========================================
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

-- Destructive maintenance privileges are never used through PostgREST.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated, anon;

-- ==========================================
-- Functions: never executable by PUBLIC/anon/authenticated by default.
-- service_role gets everything; `authenticated` gets only the RPCs the web app
-- calls plus the RLS helpers/wrappers used by the policies. Revoking
-- `authenticated` matters because Supabase's default privileges grant it
-- EXECUTE directly on every new function.
-- ==========================================
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Service-role only: plan changes, audit helper, the role-authority helpers and
-- the unused get_accessible_* family (only integration tests call those, with
-- the service client).
REVOKE ALL ON FUNCTION public.apply_org_plan(uuid, text) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.rls_audit() FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.has_org_feature(uuid, uuid, text) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.is_org_manager(uuid, uuid) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.can_assign_org_role(uuid, uuid) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.get_accessible_flashcard_decks(uuid, uuid, uuid) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.get_accessible_flashcards(uuid, uuid, uuid[], uuid[], uuid, uuid) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.get_accessible_question_banks(uuid, uuid, uuid) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.get_accessible_questions(uuid, uuid, text, uuid, uuid[], uuid[], text) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.get_accessible_topics(uuid, uuid, uuid) FROM authenticated, anon;

-- Application RPCs + RLS helpers/wrappers used by the policies.
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

-- Public read access for the unauthenticated pricing page (no write; the RLS SELECT policy
-- is the only policy on these three tables).
GRANT SELECT ON public.subscription_plans TO anon;
GRANT SELECT ON public.plan_features TO anon;
GRANT SELECT ON public.plan_limits TO anon;
