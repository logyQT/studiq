-- ==========================================
-- apply_org_plan(org, plan)
-- Issue #177 — buying an organization plan only changed the buyer's
-- personal plan; the organization stayed on its original plan.
--
-- `handle_new_organization` copies plan_features / plan_limits into
-- org_role_features / org_limits exactly once, at org creation, and
-- FeatureResolver / LimitsResolver treat those snapshot rows as
-- authoritative. Changing `organizations.plan` alone therefore changes
-- nothing, so a plan change has to re-sync the snapshots. This function
-- does both in one transaction.
--
-- Role rules mirror handle_new_organization (keep them in sync):
--   admin   : every plan feature
--   teacher : every plan feature except member.manage / role.builder
--   member  : flashcards, quiz, ai.chat, documents, branding
--
-- Sync semantics (so customisation survives an upgrade):
--   * missing entitlements are added to the three system roles;
--   * a feature the new plan does not include is removed from EVERY role
--     of the org (system and custom) — a downgrade must really revoke it.
--     Exception: org.manage is a role marker (FeatureResolver uses it to
--     recognise an org admin) that only the launch template lists, so it is
--     never revoked;
--   * rows already present are left alone (an admin's is_enabled toggles
--     and custom-role assignments are kept);
--   * org_limits are overwritten from plan_limits and limits the new plan
--     does not define are removed.
--
-- Only the service role may call it: authorization (the caller must be an
-- admin of the org and the plan must be purchasable) lives in
-- MockStripeService.
-- ==========================================

CREATE OR REPLACE FUNCTION public.apply_org_plan(p_org_id uuid, p_plan text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'organization % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE key = p_plan) THEN
    RAISE EXCEPTION 'plan % not found', p_plan USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.organizations SET plan = p_plan WHERE id = p_org_id;

  -- Revoke features the new plan does not include, from every role.
  DELETE FROM public.org_role_features f
  USING public.org_roles r
  WHERE f.org_role_id = r.id
    AND r.organization_id = p_org_id
    AND f.feature_key <> 'org.manage'
    AND f.feature_key NOT IN (
      SELECT feature_key FROM public.plan_features WHERE plan_key = p_plan
    );

  -- Grant the plan's features to the system roles.
  INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
  SELECT r.id, pf.feature_key, true
  FROM public.org_roles r
  JOIN public.plan_features pf ON pf.plan_key = p_plan
  WHERE r.organization_id = p_org_id
    AND r.is_system
    AND (
      r.name = 'admin'
      OR (r.name = 'teacher' AND pf.feature_key NOT IN ('member.manage', 'role.builder'))
      OR (r.name = 'member'
          AND pf.feature_key IN ('flashcards', 'quiz', 'ai.chat', 'documents', 'branding'))
    )
  ON CONFLICT (org_role_id, feature_key) DO NOTHING;

  -- Limits: replace the snapshot with the new plan's template.
  DELETE FROM public.org_limits
  WHERE organization_id = p_org_id
    AND limit_key NOT IN (
      SELECT limit_key FROM public.plan_limits WHERE plan_key = p_plan
    );

  INSERT INTO public.org_limits (organization_id, limit_key, max_value)
  SELECT p_org_id, limit_key, limit_value
  FROM public.plan_limits
  WHERE plan_key = p_plan
  ON CONFLICT (organization_id, limit_key) DO UPDATE SET max_value = EXCLUDED.max_value;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_org_plan(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_org_plan(uuid, text) TO service_role;
