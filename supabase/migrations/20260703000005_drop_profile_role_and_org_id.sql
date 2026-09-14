-- ==========================================
-- Migration: Drop profiles.role + organization_id
-- After Phase 2, role comes from org_members, not profiles.
-- After Phase 3, org membership comes from org_members, not profiles.
-- Clean up the vestigial columns and their supporting infrastructure.
-- ==========================================

-- 1. Drop the trigger that synced profiles.role → auth.users.raw_app_meta_data
DROP TRIGGER IF EXISTS on_profile_role_update ON public.profiles;

-- 2. Drop the function that ran on that trigger
DROP FUNCTION IF EXISTS public.sync_profile_role_to_auth;

-- 3. Drop admin_change_role RPC — it referenced profiles.role and is never called
--    from TypeScript. Org member role management is done via the REST API.
DROP FUNCTION IF EXISTS public.admin_change_role;

-- 4. Update handle_new_user to stop inserting/updating removed columns
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  passed_token     text   := NEW.raw_user_meta_data->>'invite_token';
  invite_record    record;
  personal_org_id  uuid;
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

  -- Create personal org and membership
  INSERT INTO public.organizations (name, slug)
  VALUES ('Personal', 'personal-' || NEW.id::text)
  RETURNING id INTO personal_org_id;

  INSERT INTO public.org_members (organization_id, user_id, role)
  VALUES (personal_org_id, NEW.id, 'free')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Drop the vestigial columns from profiles
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS organization_id;
