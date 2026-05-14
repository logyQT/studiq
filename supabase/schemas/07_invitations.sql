-- ==========================================
-- TABLE: invitations
-- Depends on: _enums.sql, universities.sql, profiles.sql
-- ==========================================

CREATE TABLE public.invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL,
  token       text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  target_role user_role NOT NULL,
  university_id uuid REFERENCES public.universities(id) ON DELETE CASCADE,
  inviter_id  uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_accepted boolean DEFAULT false,
  expires_at  timestamptz NOT NULL
);

-- ==========================================
-- TRIGGER: handle_new_user
-- Fires on auth.users INSERT.
-- If the signup carries a valid invite token:
--   - creates a profile with the invited role + university
--   - marks the invitation as accepted (atomically)
-- Otherwise falls back to a standard free-tier profile.
-- ==========================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  passed_token  text   := NEW.raw_user_meta_data->>'invite_token';
  invite_record record;
BEGIN
  IF passed_token IS NOT NULL THEN
    SELECT * INTO invite_record
    FROM public.invitations
    WHERE token      = passed_token
      AND is_accepted = false
      AND expires_at  > now();

    IF FOUND THEN
      INSERT INTO public.profiles (id, email, full_name, role, university_id)
      VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'name',
        invite_record.target_role,
        invite_record.university_id
      );

      UPDATE public.invitations
        SET is_accepted = true
        WHERE id = invite_record.id;

      RETURN NEW;
    END IF;
  END IF;

  -- Fallback: standard free signup
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', 'free');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();