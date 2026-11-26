-- ==========================================================
-- #1484: the anonymous pricing read needs the kill switch.
--
-- `GET /api/v1/subscription-plans` and the `/pricing` page now apply the
-- resolver's flag gate (D8) to a surface entitlement before they advertise it:
-- a missing or `is_enabled = false` row drops the key from `features`. `anon`
-- had SELECT on the plan tables but not on `entitlement_flags`, so the new read
-- would answer 42501 and turn every anonymous pricing request into a 403 (the
-- R38 trap: an embed of a table only `authenticated` may select).
--
-- The flag state is public product config — a key and an on/off switch — not
-- authority: it grants nothing, because the resolver still composes access from
-- the plan, role, seat and override layers. Same precedent as
-- `20261122150000_plan_scope_audience_solo.sql` for `entitlement_catalog`:
-- SELECT and a read policy, no write grant.
-- ==========================================================

GRANT SELECT ON public.entitlement_flags TO anon;

DROP POLICY IF EXISTS "Public flags read" ON public.entitlement_flags;
CREATE POLICY "Public flags read" ON public.entitlement_flags
  FOR SELECT TO anon
  USING (true);
