-- ==========================================
-- GRANT table permissions for PostgREST
-- Runs after all migrations so every table
-- exists when grants are issued.
-- 
-- No RLS is used — app-layer auth
-- (buildQueryFilter, checkPermission) is
-- the sole authorization mechanism.
-- ==========================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- Full table access for authenticated users + service role
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

-- Function execution for RPCs
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Sequence access
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Future-proof: auto-grant on tables created after this seed runs
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO authenticated, service_role;

-- Public read access for unauthenticated pricing page
GRANT SELECT ON public.subscription_plans TO anon;
GRANT SELECT ON public.plan_features TO anon;
GRANT SELECT ON public.plan_limits TO anon;
