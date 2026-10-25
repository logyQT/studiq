-- #233 (Q4): `max_storage_mb` was display-only — advertised on Master/Campus
-- but never read by any enforcement path. Remove the rows so the catalog and
-- the pricing pages stop advertising a limit that does nothing.
--
-- The seed (`supabase/seeds/00_plans.sql`) no longer inserts the key; this
-- data-only migration applies the same change to already-seeded environments.
DELETE FROM public.plan_limits WHERE limit_key = 'max_storage_mb';
