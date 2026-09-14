-- ==========================================
-- Development grants for PostgREST access
-- These are automatically applied by the
-- Supabase dashboard on database reset.
-- 
-- No RLS is used — app-layer auth
-- (buildQueryFilter, checkPermission) is
-- the sole authorization mechanism in dev.
-- ==========================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

