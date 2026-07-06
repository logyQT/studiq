-- ==========================================
-- Migration: Clean up user_role enum + handle_new_user
-- After P1 RBAC simplification:
--   - user_role PG enum drops 'free', 'premium', 'university_admin'
--   - handle_new_user no longer creates personal orgs
-- ==========================================

-- 1. Rewrite handle_new_user — no personal org, profile only
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

      INSERT INTO public.org_members (organization_id, user_id, role)
      VALUES (invite_record.organization_id, NEW.id, invite_record.target_role)
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

-- 2. Alter the user_role enum — drop free, premium, university_admin
CREATE TYPE user_role_new AS ENUM ('student', 'teacher', 'sys_admin');

ALTER TABLE public.org_members
  ALTER COLUMN role TYPE user_role_new
  USING role::text::user_role_new;

ALTER TABLE public.org_role_display_names
  ALTER COLUMN role TYPE user_role_new
  USING role::text::user_role_new;

-- role_permissions has old enum values that can't be cast — drop it here
-- (replaced by org_role_permissions in the next migration)
DROP TABLE IF EXISTS public.role_permissions;

ALTER TABLE public.invitations
  ALTER COLUMN target_role TYPE user_role_new
  USING target_role::text::user_role_new;

DROP TYPE IF EXISTS user_role;

ALTER TYPE user_role_new RENAME TO user_role;
