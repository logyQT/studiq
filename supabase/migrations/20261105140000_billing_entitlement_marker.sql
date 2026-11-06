-- ==========================================
-- Issue #662 security review: committed-entitlement signal for the success
-- page.
--
-- `billing_subscriptions.plan_key` is written before the entitlement
-- transaction, so the success page could read an active billed mirror while
-- `profiles.personal_plan_key` / `organizations.plan` still held the previous
-- (possibly free) plan. The marker below is written in the same transaction as
-- the entitlement apply, so it is a reliable "this plan was committed" signal.
-- ==========================================

ALTER TABLE public.billing_subscriptions
  ADD COLUMN entitlement_applied_plan_key text;

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
    RETURN false;
  END IF;

  IF v_last_event_created > p_event_created THEN
    RETURN false;
  END IF;

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

  -- Same transaction as the entitlement write: the success page can use this
  -- marker as proof that the purchased plan reached the entitlement column.
  UPDATE public.billing_subscriptions
  SET entitlement_applied_plan_key = p_plan
  WHERE stripe_subscription_id = p_subscription_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_entitlement_fenced(text, uuid, text, text, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_entitlement_fenced(text, uuid, text, text, bigint, bigint)
  TO service_role;
