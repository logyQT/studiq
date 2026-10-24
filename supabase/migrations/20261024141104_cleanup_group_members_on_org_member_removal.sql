-- ==========================================
-- Group membership ends when organization membership ends (#249, MGR-MEM-04).
--
-- `OrganizationMemberService.removeMember()` deletes the `org_members` row (and
-- the seat assignment), but nothing removed the user's `group_members` rows:
-- there is no FK or cascade between `group_members` and `org_members`
-- (`group_members.group_id -> groups(id)`, `group_members.user_id ->
-- profiles(id)` only). The stale row then authorised the removed user against
-- org content targeted at that group (`teacher_assignments` /
-- `assignment_targets`), kept the group visible in `/api/v1/me/groups` and left
-- the user in the group roster / member count.
--
-- The invariant belongs in the database, not in one service method: the admin
-- app and any future removal path must not be able to recreate the orphan, and
-- a service-level DELETE on `group_members` could be silently RLS-filtered to 0
-- rows (removal is gated on `member.manage`, the group_members write policy on
-- `group.manage`) leaving the endpoint answering 200 with the rows intact.
-- A SECURITY DEFINER trigger is RLS-proof, runs for every writer (service role
-- included) and is transactional: a failure aborts the removal instead of
-- leaving a half-removed member.
-- ==========================================

-- Backfill: repair users already affected by the bug, so this deploy fixes the
-- existing orphans instead of only future removals. Guarded by NOT EXISTS on
-- the leaving org, so a user who is still a member keeps their groups.
DELETE FROM public.group_members gm
USING public.groups g
WHERE g.id = gm.group_id
  AND NOT EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE om.user_id = gm.user_id
      AND om.organization_id = g.organization_id
  );

-- Only groups of the organization being left are touched, so memberships in
-- another org (a user in two orgs) are preserved.
CREATE OR REPLACE FUNCTION public.cleanup_group_members_on_org_member_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.group_members gm
  USING public.groups g
  WHERE g.id = gm.group_id
    AND g.organization_id = OLD.organization_id
    AND gm.user_id = OLD.user_id;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_group_members_on_org_member_delete() FROM PUBLIC;

CREATE TRIGGER cleanup_group_members_on_org_member_delete
  AFTER DELETE ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_group_members_on_org_member_delete();
