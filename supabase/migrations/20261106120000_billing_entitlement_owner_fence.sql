-- ==========================================
-- Issue #662 security review: fence the entitlement owner.
--
-- `apply_entitlement_fenced` received the owner from the webhook resolver but
-- did not verify it against the locked subscription row. Add a null-safe owner
-- check so a misresolved or crossed owner cannot write another profile's or
-- organization's entitlement.
-- ==========================================

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
  v_user_id uuid;
  v_organization_id uuid;
BEGIN
  IF p_owner_type NOT IN ('user', 'org') THEN
    RAISE EXCEPTION 'owner type must be user or org (got %)', p_owner_type USING ERRCODE = '22023';
  END IF;

  SELECT s.last_event_created, s.snapshot_generation, s.user_id, s.organization_id
    INTO v_last_event_created, v_snapshot_generation, v_user_id, v_organization_id
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

  -- Null-safe: an organization row has no user_id and a user row has no
  -- organization_id, so a crossed owner always differs.
  IF p_owner_type = 'user' THEN
    IF v_user_id IS DISTINCT FROM p_owner_id THEN
      RETURN false;
    END IF;
  ELSE
    IF v_organization_id IS DISTINCT FROM p_owner_id THEN
      RETURN false;
    END IF;
  END IF;

  IF p_owner_type = 'org' THEN
    PERFORM public.apply_org_plan(p_owner_id, p_plan);
  ELSE
    UPDATE public.profiles
    SET personal_plan_key = p_plan
    WHERE id = p_owner_id;
  END IF;

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
