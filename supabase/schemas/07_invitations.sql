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
-- Fires on auth.users INSERT.
-- If the signup carries a valid invite token:
--   - creates a profile
--   - creates an org_members entry
--   - marks the invitation as accepted
-- Otherwise creates a profile only. The account type is set by the
-- application code via admin.updateUserById() during signup.
-- ==========================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  passed_token     text   := NEW.raw_user_meta_data->>'invite_token';
  invite_record    record;
BEGIN
  IF passed_token IS NOT NULL THEN
    SELECT * INTO invite_record
    FROM public.invitations
    WHERE token      = passed_token
      AND is_accepted = false
      AND expires_at  > now();

    IF FOUND THEN
      INSERT INTO public.profiles (id, email, full_name)
      VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'name'
      );

      INSERT INTO public.org_members (organization_id, user_id, org_role_id)
      VALUES (invite_record.organization_id, NEW.id, invite_record.target_org_role_id)
      ON CONFLICT DO NOTHING;

      UPDATE public.invitations
        SET is_accepted = true
        WHERE id = invite_record.id;

      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
