-- ==========================================
-- GRANT table permissions for PostgREST
-- 
-- The migration 20260702063644 revoked ALL
-- privileges from all roles on all tables.
-- Every DB reset requires manual re-granting
-- via the Supabase dashboard.
-- 
-- This migration restores the minimum grants
-- needed for the Data API (PostgREST) to
-- function for authenticated users and the
-- service role.
-- 
-- No RLS is used — app-layer auth
-- (buildQueryFilter, checkPermission) is
-- the sole authorization mechanism.
-- ==========================================

-- Allow PostgREST to resolve the schema
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- Full table access for authenticated users + service role
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

-- Function execution for RPCs (get_due_flashcards, count_new_cards, etc.)
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- Sequence access (for any SERIAL/generated columns)
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
