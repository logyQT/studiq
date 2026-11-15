-- ==========================================
-- accept_org_invitation(token, user) — one transaction for the whole join (#1067)
--
-- Accepting an invitation used to be three statements issued by the service:
-- claim the token (`UPDATE invitations SET is_accepted = true`), upsert
-- `org_members`, upsert the default `group_members`. The claim was deliberately
-- first so two concurrent accepts could not both pass the read check, but with
-- no transaction around the three writes a failure after the claim consumed the
-- token without joining anybody: the accept answered 4xx/5xx, `is_accepted`
-- stayed true, the user was not a member, and every retry answered GONE — the
-- manager had to delete and re-create the invitation.
--
-- This function keeps the claim first (it still wins the race) and makes it the
-- first statement of the same transaction as the two membership writes, so any
-- failure rolls the claim back and the token stays usable.
--
-- Semantics preserved from the service layer:
--   * single use — `SELECT … FOR UPDATE` serialises concurrent accepts on the
--     invitation row; the loser re-reads `is_accepted = true` and gets no rows;
--   * `IS TRUE` — a legacy `is_accepted = NULL` row is claimable exactly once
--     (the predicate is false for NULL), a claimed one never again;
--   * expiry and a cross-organization target role are refused without writing;
--   * re-accepting an existing member updates their `org_role_id` instead of
--     failing on `UNIQUE(organization_id, user_id)`;
--   * an existing `group_members` row is left alone (`DO NOTHING`), so a
--     re-accept cannot downgrade a member's group role.
--
-- Authorization (invite still live, inviter may still grant the role, seat
-- limit) stays in `InvitationService.acceptInvitationForUser`; the service-role
-- client is the only caller. Zero rows back means "not accepted".
-- ==========================================

CREATE OR REPLACE FUNCTION public.accept_org_invitation(p_token text, p_user_id uuid)
RETURNS TABLE (organization_id uuid, organization_name text, org_role_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite   public.invitations%ROWTYPE;
  v_org_name text;
  v_group_id uuid;
BEGIN
  SELECT i.* INTO v_invite
  FROM public.invitations i
  WHERE i.token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- `IS TRUE` (not `<> false`) is null-safe: a legacy NULL row is still claimable
  -- and a claimed one is not.
  IF v_invite.is_accepted IS TRUE THEN
    RETURN;
  END IF;

  IF v_invite.expires_at < now() THEN
    RETURN;
  END IF;

  IF v_invite.organization_id IS NULL THEN
    RETURN;
  END IF;

  -- A target role from another organization would grant that tenant's scopes.
  IF NOT EXISTS (
    SELECT 1
    FROM public.org_roles r
    WHERE r.id = v_invite.target_org_role_id
      AND r.organization_id = v_invite.organization_id
  ) THEN
    RETURN;
  END IF;

  SELECT o.name INTO v_org_name
  FROM public.organizations o
  WHERE o.id = v_invite.organization_id;

  IF v_org_name IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.invitations
  SET is_accepted = true
  WHERE id = v_invite.id;

  INSERT INTO public.org_members (organization_id, user_id, org_role_id)
  VALUES (v_invite.organization_id, p_user_id, v_invite.target_org_role_id)
  -- Named constraint (not a column list): the OUT parameter `organization_id`
  -- makes the bare conflict target ambiguous inside plpgsql.
  ON CONFLICT ON CONSTRAINT org_members_organization_id_user_id_key
  DO UPDATE SET org_role_id = EXCLUDED.org_role_id;

  SELECT g.id INTO v_group_id
  FROM public.groups g
  WHERE g.organization_id = v_invite.organization_id
    AND g.is_default;

  IF v_group_id IS NOT NULL THEN
    INSERT INTO public.group_members (group_id, user_id, role)
    VALUES (v_group_id, p_user_id, 'member')
    ON CONFLICT ON CONSTRAINT group_members_group_id_user_id_key DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_invite.organization_id, v_org_name, v_invite.target_org_role_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_org_invitation(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_org_invitation(text, uuid) TO service_role;
