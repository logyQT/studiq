-- =============================================
-- Drop the trigger that syncs organization_id to JWT.
-- Users can belong to multiple orgs, so a single
-- organization_id in the JWT is misleading.
-- Use the active_org_id cookie instead.
-- =============================================

DROP TRIGGER IF EXISTS on_org_id_update ON public.profiles;
DROP FUNCTION IF EXISTS public.sync_profile_org_id_to_auth();
