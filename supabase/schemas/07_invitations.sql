-- ==========================================
-- TABLE: invitations
-- Depends on: 03_organizations.sql, 04_profiles.sql, 56_org_roles.sql
-- ==========================================

CREATE TABLE public.invitations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text,
  email             text NOT NULL,
  token             text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  target_org_role_id uuid NOT NULL REFERENCES public.org_roles(id),
  organization_id   uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  inviter_id        uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_accepted       boolean DEFAULT false,
  expires_at        timestamptz NOT NULL
);

-- ==========================================
-- TRIGGER: handle_new_user
-- Fires on auth.users INSERT and creates the profile only.
--
-- Invitations are NOT applied at signup. 20260708000001_fix_handle_new_user
-- removed the old `invite_token` branch (it pre-dated org roles and trusted a
-- client-supplied token with no grant-authority check); joining an organization
-- happens through POST /api/v1/organization/invites/accept, which runs on the
-- service-role client after checking can_assign_org_role(inviter, target role).
-- Keeping the branch out of this trigger is what stops a stale/demoted inviter
-- from minting an org role during signup.
-- ==========================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  acct_type    text;
  plan_key_val text;
BEGIN
  -- Prefer app_meta_data (server-controlled — seed, admin APIs).
  -- Fallback to user_meta_data (client-supplied from signup) with validation.
  acct_type := NEW.raw_app_meta_data->>'account_type';

  IF acct_type IS NULL THEN
    acct_type := NEW.raw_user_meta_data->>'account_type';

    IF acct_type IS NULL OR acct_type NOT IN ('student', 'educator', 'manager') THEN
      RAISE EXCEPTION 'Invalid account_type: %. Allowed: student, educator, manager', acct_type;
    END IF;
  END IF;

  plan_key_val := CASE acct_type
    WHEN 'student'   THEN 'base'
    WHEN 'educator'  THEN 'lite'
    WHEN 'manager'   THEN 'launch'
    ELSE 'base'
  END;

  INSERT INTO public.profiles (id, email, full_name, personal_plan_key)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', plan_key_val);

  -- Set app_metadata.account_type so withAuth() middleware can read it
  -- without needing a service-role API call from the app layer
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('account_type', acct_type)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
