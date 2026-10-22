-- ==========================================
-- Close authenticated users' write access to public.profiles.
--
-- `profiles` has RLS disabled and, like every table created by the initial
-- Supabase migration, grants INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
-- to `authenticated` (and had the same grants on `anon` until
-- 20261020000001_revoke_anon_grants.sql). Authorization is done in the app
-- layer, but the table is still reachable through PostgREST with the public
-- anon key + any signed-in JWT, so any signed-in user could write any row.
-- Concretely: PATCH the victim's `purge_at` to the past, then wait for the
-- next admin list load to run the purge job, and the account is hard-deleted
-- (PR #130, admin user management).
--
-- The application never writes profiles as a user:
--   - rows are created by the SECURITY DEFINER handle_new_user() trigger,
--   - the admin soft-delete/purge flow runs on the service-role client
--     (apps/admin/src/lib/supabase/admin-client.ts).
-- No user-scoped code path may write profiles after this migration either; use
-- the service-role client or a SECURITY DEFINER function instead.
--
-- `authenticated` keeps SELECT (every resolver reads profiles with the
-- user-scoped client). `service_role` and `postgres` are unaffected: they are
-- separate roles and keep the table owner / service grants.
--
-- REVOKE of a privilege that is not granted is a no-op, so this is safe to
-- re-run and safe on databases where the default grants were already removed.
-- ==========================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.profiles
  FROM authenticated, anon;

GRANT SELECT ON public.profiles TO authenticated;
