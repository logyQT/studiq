-- ==========================================
-- Branding feature flag + plan entitlement.
-- Backfills the "branding" feature key that org logo/brand-color CRUD
-- (20260920000002_org_branding.sql) shipped without ever gating.
-- Additive only: no schema changes.
-- ==========================================

INSERT INTO public.feature_flags (key, name, description) VALUES
  ('branding', 'Custom Branding', 'Organization logo + brand color')
ON CONFLICT DO NOTHING;

-- Marketing copy (plan_hub_desc) already promises branding on Hub; Campus
-- sits above Hub in the org tier ladder and inherits everything Hub has.
--
-- The 12 brand plans (hub/campus included) are seed data
-- (supabase/seeds/00_plans.sql), not migration data, so this can run
-- before those subscription_plans rows exist (e.g. a fresh prod DB where
-- plans are created later through the admin panel). Guarded with EXISTS
-- so it's a no-op rather than an FK violation when that's the case --
-- re-run this INSERT (or add the mapping via the admin panel) once the
-- plan rows are created.
INSERT INTO public.plan_features (plan_key, feature_key)
SELECT t.plan_key, 'branding'
FROM (VALUES ('hub'), ('campus')) AS t(plan_key)
WHERE EXISTS (SELECT 1 FROM public.subscription_plans sp WHERE sp.key = t.plan_key)
ON CONFLICT DO NOTHING;
