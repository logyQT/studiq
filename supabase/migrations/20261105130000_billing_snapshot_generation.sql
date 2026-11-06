-- ==========================================
-- Issue #662 security review: same-second snapshot ordering.
--
-- `last_event_created` has one-second resolution, and two valid events can
-- carry the same `created` value. A worker that retrieved an active
-- subscription before a same-second cancellation could therefore pass the
-- `last_event_created <= eventCreated` fence and restore paid access.
--
-- Add a per-subscription write generation. The webhook reads the generation
-- before it retrieves the Stripe snapshot and must write it back atomically
-- with the mirror update. The entitlement function then verifies that the
-- generation it is applying still owns the mirror, so an older snapshot cannot
-- authorize an entitlement after a newer write.
-- ==========================================

ALTER TABLE public.billing_subscriptions
  ADD COLUMN snapshot_generation bigint NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS public.apply_entitlement_fenced(text, uuid, text, text, bigint);

CREATE OR REPLACE FUNCTION public.apply_entitlement_fenced(
  p_owner_type text,
  p_owner_id uuid,
  p_plan text,
  p_subscription_id text,
  p_event_created bigint,
  p_snapshot_generation bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_last_event_created bigint;
  v_snapshot_generation bigint;
BEGIN
  IF p_owner_type NOT IN ('user', 'org') THEN
    RAISE EXCEPTION 'owner type must be user or org (got %)', p_owner_type USING ERRCODE = '22023';
  END IF;

  SELECT s.last_event_created, s.snapshot_generation
    INTO v_last_event_created, v_snapshot_generation
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

  -- `last_event_created` cannot order two events from the same second. The
  -- generation is the write-order tiebreaker: this snapshot may only apply
  -- while it still owns the row it wrote.
  IF v_snapshot_generation <> p_snapshot_generation THEN
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

REVOKE ALL ON FUNCTION public.apply_entitlement_fenced(text, uuid, text, text, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_entitlement_fenced(text, uuid, text, text, bigint, bigint)
  TO service_role;
