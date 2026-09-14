-- ==========================================
-- Migration: Backfill personal orgs for existing users
-- Phase 2: Every user gets a personal org.
-- Creates an org, links profile.organization_id,
-- and inserts org_members entry for all profiles
-- that don't already have an org_members row.
-- ==========================================

DO $$
DECLARE
  profile_record RECORD;
  personal_org_id uuid;
BEGIN
  FOR profile_record IN
    SELECT p.id, p.email, p.full_name, p.role
    FROM public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.org_members om WHERE om.user_id = p.id
    )
  LOOP
    -- Create personal org
    INSERT INTO public.organizations (name, slug)
    VALUES (
      'Personal',
      'personal-' || profile_record.id::text
    )
    RETURNING id INTO personal_org_id;

    -- Update profile with org link
    UPDATE public.profiles
    SET organization_id = personal_org_id
    WHERE id = profile_record.id;

    -- Create membership with the user's current role
    INSERT INTO public.org_members (organization_id, user_id, role)
    VALUES (personal_org_id, profile_record.id, profile_record.role)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
