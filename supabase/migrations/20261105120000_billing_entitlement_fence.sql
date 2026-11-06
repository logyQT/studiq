-- ==========================================
-- Issue #662: fence entitlement writes against subscription freshness.
--
-- The webhook used to check the mirror and then write the entitlement in two
-- separate statements. A newer cancellation/downgrade could commit between the
-- check and the write, leaving the newer mirror paired with stale paid access.
--
-- `apply_entitlement_fenced` makes the check and the entitlement mutation one
-- transaction:
--
--   1. lock the subscription mirror row (`FOR UPDATE`);
--   2. refuse when the stored `last_event_created` is newer than the event;
--   3. otherwise apply the plan to the profile or organization.
--
-- A concurrent newer event that is still writing the mirror blocks on the row
-- lock. Whichever side commits last either wins the mirror (and then applies
-- its own, newer entitlement) or observes the newer `last_event_created` and
-- skips its stale entitlement. Webhook dispatch always upserts the mirror
-- before calling this function, so the lock orders the two writes.
--
-- Service-role only: this is part of the EntitlementService write surface.
-- ==========================================

CREATE OR REPLACE FUNCTION public.apply_entitlement_fenced(
  p_owner_type text,
  p_owner_id uuid,
  p_plan text,
  p_subscription_id text,
  p_event_created bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_last_event_created bigint;
BEGIN
  IF p_owner_type NOT IN ('user', 'org') THEN
    RAISE EXCEPTION 'owner type must be user or org (got %)', p_owner_type USING ERRCODE = '22023';
  END IF;

  SELECT s.last_event_created
    INTO v_last_event_created
  FROM public.billing_subscriptions s
  WHERE s.stripe_subscription_id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- No mirror row means there is nothing to fence against: refuse rather
    -- than write an unverifiable entitlement.
    RETURN false;
  END IF;

  IF v_last_event_created > p_event_created THEN
    RETURN false;
  END IF;

  IF p_owner_type = 'org' THEN
    PERFORM public.apply_org_plan(p_owner_id, p_plan);
  ELSE
    UPDATE public.profiles
    SET personal_plan_key = p_plan
    WHERE id = p_owner_id;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_entitlement_fenced(text, uuid, text, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_entitlement_fenced(text, uuid, text, text, bigint)
  TO service_role;
