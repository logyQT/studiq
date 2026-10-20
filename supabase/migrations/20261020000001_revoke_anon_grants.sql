-- Close the unauthenticated PostgREST surface (issue #191).
--
-- Supabase grants `anon` full privileges on every new table in `public`, and
-- most StudiQ tables have no RLS (authorization is done in the app layer), so
-- anyone holding the public anon key could read and write them without logging
-- in. The app never talks to PostgREST as `anon` except for the public pricing
-- data, so remove everything from `anon` and give back only that.
--
-- `authenticated` keeps its grants: the API runs user-scoped queries with that
-- role. Replacing them with RLS policies is tracked separately.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Tables created by later migrations must not be granted to anon automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- Public pricing page (unauthenticated).
GRANT SELECT ON public.subscription_plans TO anon;
GRANT SELECT ON public.plan_features TO anon;
GRANT SELECT ON public.plan_limits TO anon;
